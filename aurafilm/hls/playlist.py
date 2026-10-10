"""Master and media playlist parsing (on top of the ``m3u8`` library)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from urllib.parse import urljoin

import m3u8
import requests

from .. import net

logger = logging.getLogger(__name__)

# ISO 639-2 <-> 639-1 and display names; the video host labels tracks with
# 639-2 codes ("ita", "eng"), sometimes the B variant ("ger", "fre").
LANGS = {
    "ita": ("it", "Italiano"), "eng": ("en", "English"), "fra": ("fr", "Français"),
    "fre": ("fr", "Français"), "spa": ("es", "Español"), "deu": ("de", "Deutsch"),
    "ger": ("de", "Deutsch"), "por": ("pt", "Português"), "jpn": ("ja", "日本語"),
    "kor": ("ko", "한국어"), "zho": ("zh", "中文"), "chi": ("zh", "中文"),
    "rus": ("ru", "Русский"), "ukr": ("uk", "Українська"), "pol": ("pl", "Polski"),
    "nld": ("nl", "Nederlands"), "dut": ("nl", "Nederlands"), "tur": ("tr", "Türkçe"),
    "ara": ("ar", "العربية"), "ell": ("el", "Ελληνικά"), "gre": ("el", "Ελληνικά"),
    "ces": ("cs", "Čeština"), "cze": ("cs", "Čeština"), "ron": ("ro", "Română"),
    "rum": ("ro", "Română"), "swe": ("sv", "Svenska"), "dan": ("da", "Dansk"),
    "nor": ("no", "Norsk"), "fin": ("fi", "Suomi"), "hun": ("hu", "Magyar"),
    "heb": ("he", "עברית"), "hin": ("hi", "हिन्दी"),
}


def base_lang(code: str | None) -> tuple[str, bool]:
    """('ita', forced?) from tokens like 'ita', 'forced-ita', 'it'."""
    code = (code or "und").lower()
    forced = code.startswith("forced-")
    if forced:
        code = code[len("forced-"):]
    if len(code) == 2:
        for k, (short, _) in LANGS.items():
            if short == code:
                return k, forced
    return code or "und", forced


def short_lang(code: str) -> str:
    return LANGS.get(base_lang(code)[0], (code, ""))[0]


@dataclass
class Variant:
    uri: str
    bandwidth: int
    height: int | None


@dataclass
class Rendition:
    kind: str              # AUDIO | SUBTITLES
    language: str          # raw token from the playlist
    name: str
    uri: str
    default: bool = False


@dataclass
class Master:
    url: str
    variants: list[Variant] = field(default_factory=list)
    audio: list[Rendition] = field(default_factory=list)
    subtitles: list[Rendition] = field(default_factory=list)
    is_media: bool = False   # the URL was already a media playlist

    def best_variant(self, max_height: int | None = None) -> Variant | None:
        pool = self.variants
        if max_height:
            capped = [v for v in pool if (v.height or 0) <= max_height]
            pool = capped or pool
        return max(pool, key=lambda v: ((v.height or 0), v.bandwidth), default=None)

    def languages(self) -> dict:
        return {
            "audio": [a.language for a in self.audio if a.language],
            "subtitles": [s.language for s in self.subtitles
                          if s.language and s.language != "auto"],
        }


@dataclass
class Key:
    method: str
    uri: str
    iv: bytes | None


@dataclass
class MediaPlaylist:
    url: str
    segments: list[str]
    sequence_start: int
    key: Key | None


def fetch_text(session: requests.Session, url: str, referer: str | None = None) -> tuple[str, str]:
    """GET a playlist, with the ``b=1`` quirk some edges require on 403."""
    headers = {"Referer": referer} if referer else {}
    r = net.get_with_retry(session, url, headers=headers, what="playlist")
    if r.status_code == 403 and "b=1" not in url:
        url = url + ("&" if "?" in url else "?") + "b=1"
        r = net.get_with_retry(session, url, headers=headers, what="playlist (b=1)")
    if not r.ok:
        raise RuntimeError(f"playlist answered HTTP {r.status_code}")
    return r.text, url


def parse_master(session: requests.Session, url: str, referer: str | None = None) -> Master:
    text, url = fetch_text(session, url, referer)
    pl = m3u8.loads(text, uri=url)
    master = Master(url=url)
    if not pl.is_variant:
        master.is_media = True
        return master
    for p in pl.playlists:
        res = p.stream_info.resolution
        master.variants.append(Variant(uri=urljoin(url, p.uri), bandwidth=p.stream_info.bandwidth or 0,
                                       height=res[1] if res else None))
    for media in pl.media:
        if not media.uri:
            continue
        r = Rendition(kind=media.type, language=media.language or "", name=media.name or "",
                      uri=urljoin(url, media.uri), default=(media.default or "").upper() == "YES")
        (master.subtitles if media.type == "SUBTITLES" else master.audio).append(r)
    return master


def parse_media(session: requests.Session, url: str, referer: str | None = None) -> MediaPlaylist:
    text, url = fetch_text(session, url, referer)
    pl = m3u8.loads(text, uri=url)
    key = None
    for k in pl.keys:
        if k and k.method and k.method.upper() != "NONE":
            iv = bytes.fromhex(k.iv[2:] if k.iv.lower().startswith("0x") else k.iv) if k.iv else None
            key = Key(method=k.method.upper(), uri=urljoin(url, k.uri), iv=iv)
            break
    segments = [urljoin(url, s.uri) for s in pl.segments]
    return MediaPlaylist(url=url, segments=segments, sequence_start=pl.media_sequence or 0, key=key)


def pick_audio(master: Master, wanted: list[str], strict: bool = False) -> list[Rendition]:
    """The audio renditions for ``wanted`` languages, in order.

    When none of them exists, the stream's default track is used instead of
    producing a silent file (unless ``strict``).
    """
    if not master.audio:
        return []
    chosen: list[Rendition] = []
    for lang in wanted:
        target = base_lang(lang)[0]
        for a in master.audio:
            if base_lang(a.language)[0] == target or a.name.lower() == LANGS.get(target, ("", ""))[1].lower():
                if a not in chosen:
                    chosen.append(a)
                break
    if not chosen:
        if strict:
            raise RuntimeError(f"audio {wanted} not available (has {[a.language for a in master.audio]})")
        fallback = next((a for a in master.audio if a.default), master.audio[0])
        logger.warning("Requested audio %s not found; using default track %s", wanted, fallback.language)
        chosen = [fallback]
    return chosen


def pick_subtitles(master: Master, wanted: list[str]) -> list[Rendition]:
    chosen = []
    for lang in wanted:
        for s in master.subtitles:
            if s.language == lang or (base_lang(s.language) == (base_lang(lang)[0], False)
                                      and not s.language.startswith("forced-")):
                if s not in chosen:
                    chosen.append(s)
                break
    return chosen
