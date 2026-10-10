"""Smart discovery of the source's current domain.

The source moves to a new domain every few weeks. Instead of trusting any
single place that claims to know the new address, this module collects
candidates from several *independent* signals, proves each one actually serves
the source, and ranks the survivors by how much evidence points at them.

Signals (each one is a "witness"):

==============  ======  =========================================================
witness         weight  how it works
==============  ======  =========================================================
canonical          6    a host that still serves the source announces its own
                        ``app_url``; if that names another host, it moved there
redirect           5    the old domains (current + history) are requested and
                        their HTTP redirects followed to wherever they land
telegram           3    the site's own Telegram channel, read through the public
                        ``t.me/s/`` preview, newest posts first
link_pages         3    public "updated link" pages (telegra.ph, configurable)
wikidata           2    the "official website" property on Wikidata
tld_sweep          1    every known name stem tried against a list of TLDs the
                        source has used or is likely to use; DNS first, so only
                        names that exist cost an HTTP request
==============  ======  =========================================================

Verification (every candidate, whatever its witnesses say):

1. **Shape** – a second-level domain whose name matches the source's naming
   pattern. ``streamingcommunity.evil.com`` fails: the part that decides where
   traffic goes must be the source's name, not a subdomain of someone else's.
2. **Public address** – every DNS answer is a public IP, so a malicious page
   cannot point the app at the local network.
3. **Fingerprint** – the host serves the source's Inertia payload with its own
   props (``scws_url``, ``sliders``, a build ``version``). Parked domains,
   landers and clones fail here.
4. **Function** – a real search returns titles.

The best verified candidate is applied automatically (``domain_auto_apply``,
on by default) or proposed in the UI. Every decision is kept in
``last_report`` so the user can see what was tried and why it was rejected.
"""

from __future__ import annotations

import ipaddress
import logging
import os
import re
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from urllib.parse import urlparse

import requests

from .. import config, events, net
from . import site

logger = logging.getLogger(__name__)

# ── Tunables ──────────────────────────────────────────────────────────────────

NAME_PATTERN = re.compile(os.getenv("SH_DOMAIN_PATTERN",
                                    r"^streaming(community|unity)[a-z0-9-]{0,12}$"))

DEFAULT_STEMS = ("streamingcommunity", "streamingcommunityz", "streamingunity")

# TLDs the source has used, plus cheap/new gTLDs of the kind it tends to pick.
# Order does not matter: they are resolved concurrently.
TLDS = (
    "rip", "lu", "to", "tv", "xyz", "one", "video", "art", "cz", "icu", "agency",
    "bike", "boston", "cafe", "codes", "credit", "fans", "family", "forum", "golf",
    "help", "host", "ink", "life", "live", "lol", "men", "monster", "moe", "ooo",
    "photos", "run", "space", "spa", "studio", "tech", "tips", "top", "uno", "vip",
    "website", "wiki", "zip", "bet", "blue", "black", "club", "computer", "paris",
    "prof", "garden", "ws", "cx", "bz", "co", "cc", "is", "io", "me", "lat", "pro",
    "day", "buzz", "rodeo", "esq", "network", "city", "click", "digital", "media",
    "site", "online", "store", "fun", "world", "best", "ninja", "party", "watch",
    "stream", "movie", "film", "app", "dev", "ac", "gg", "li", "nu", "su", "eu",
    "it", "im", "la", "st", "sx", "pw", "mov", "foo", "lgbt", "giving", "page",
)

LINK_PAGES = tuple(filter(None, os.getenv(
    "SH_DOMAIN_LINK_PAGES",
    "https://telegra.ph/Link-Aggiornato-StreamingCommunity-09-29",
).split(",")))

WEIGHTS = {"canonical": 6, "redirect": 5, "telegram": 3, "link_pages": 3,
           "wikidata": 2, "tld_sweep": 1, "manual": 10}

REACTIVE_COOLDOWN = 120        # seconds between discoveries triggered by failures
HOST_IN_TEXT = re.compile(
    r"(?<![a-z0-9-])((?:www\.)?streaming(?:community|unity)[a-z0-9-]{0,12}\.[a-z]{2,24})(?![a-z0-9-])",
    re.I,
)
_HOST_RE = re.compile(r"^[a-z0-9.-]{4,253}$")
_LOCAL_SUFFIXES = (".local", ".internal", ".localhost", ".home", ".lan", ".arpa")


# ── State ─────────────────────────────────────────────────────────────────────

@dataclass
class Candidate:
    host: str
    witnesses: set[str] = field(default_factory=set)
    status: str = "pending"          # pending | verified | rejected
    reason: str = ""
    latency_ms: int | None = None
    version: str | None = None

    @property
    def score(self) -> int:
        return sum(WEIGHTS.get(w, 0) for w in self.witnesses)

    def as_dict(self) -> dict:
        return {"host": self.host, "witnesses": sorted(self.witnesses), "score": self.score,
                "status": self.status, "reason": self.reason,
                "latency_ms": self.latency_ms, "version": self.version}


_lock = threading.Lock()
_running = threading.Lock()
_last_report: dict = {}
_pending: dict | None = None
_last_reactive = 0.0


def current() -> str:
    return (config.value("domain") or "").strip().lower()


def last_report() -> dict:
    with _lock:
        return dict(_last_report)


def pending() -> dict | None:
    with _lock:
        return dict(_pending) if _pending else None


def is_running() -> bool:
    return _running.locked()


# ── Guards ────────────────────────────────────────────────────────────────────

def normalize_host(raw: str) -> str:
    raw = (raw or "").strip().lower()
    if "://" not in raw:
        raw = "https://" + raw
    host = (urlparse(raw).hostname or "").strip(".")
    return host[4:] if host.startswith("www.") else host


def stem_of(host: str) -> str:
    return host.split(".")[0]


def check_shape(host: str) -> str | None:
    """Why this host cannot be the source, or None if it is shaped like it."""
    if not host or not _HOST_RE.match(host):
        return "invalid_host"
    if host == "localhost" or host.endswith(_LOCAL_SUFFIXES):
        return "local_name"
    try:
        ipaddress.ip_address(host)
        return "ip_address"
    except ValueError:
        pass
    labels = host.split(".")
    if len(labels) != 2:
        return "not_second_level"
    if not NAME_PATTERN.match(labels[0]):
        return "name_mismatch"
    return None


def resolve_public(host: str) -> tuple[bool, str]:
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except OSError:
        return False, "no_dns"
    if not infos:
        return False, "no_dns"
    for info in infos:
        try:
            addr = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False, "bad_address"
        if (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved
                or addr.is_multicast or addr.is_unspecified):
            return False, "private_address"
    return True, ""


def verify(host: str, *, functional: bool = True) -> tuple[site.SiteInfo | None, str, int | None]:
    """Prove ``host`` serves the source. Returns (info, reject_reason, latency_ms)."""
    reason = check_shape(host)
    if reason:
        return None, reason, None
    ok, reason = resolve_public(host)
    if not ok:
        return None, reason, None
    started = time.monotonic()
    try:
        info = site.site_info(host, timeout=8)
    except site.SourceError:
        return None, "not_the_source", None
    except Exception as exc:  # noqa: BLE001 - any failure here is a rejection
        logger.debug("verify %s: %s", host, exc)
        return None, "unreachable", None
    latency = int((time.monotonic() - started) * 1000)
    if functional:
        try:
            if not site.search(host, "the"):
                return None, "search_empty", latency
        except Exception:  # noqa: BLE001
            return None, "search_failed", latency
    return info, "", latency


# ── Witnesses ─────────────────────────────────────────────────────────────────

def _hosts_in(text: str) -> list[str]:
    seen: list[str] = []
    for match in HOST_IN_TEXT.findall(text or ""):
        host = normalize_host(match)
        if host and host not in seen:
            seen.append(host)
    return seen


def _known_hosts() -> list[str]:
    hosts = [current()] + [h.get("host", "") for h in config.value("domain_history") or []]
    return [h for h in dict.fromkeys(hosts) if h]


def witness_canonical_and_redirect(session: requests.Session) -> dict[str, set[str]]:
    """Ask every host we have known where it lives now."""
    found: dict[str, set[str]] = {}
    for old in _known_hosts()[:8]:
        for url in (f"https://{old}/", f"https://www.{old}/"):
            try:
                r = session.get(url, timeout=8, allow_redirects=True)
            except requests.RequestException:
                continue
            final = normalize_host(r.url)
            if final and final != old:
                found.setdefault(final, set()).add("redirect")
            try:
                page = site._data_page(r.text)
                app_url = normalize_host((page.get("props") or {}).get("app_url") or "")
                if app_url:
                    found.setdefault(app_url, set()).add("canonical")
            except site.SourceError:
                pass
            break
    return found


def _telegram_channel(session: requests.Session) -> str | None:
    link = config.value("telegram_link") or ""
    if not link:
        return None
    try:
        r = session.get(link, timeout=8, allow_redirects=True)
    except requests.RequestException:
        return None
    for candidate in [r.url] + re.findall(r"https?://t\.me/([A-Za-z0-9_+/]+)", r.text):
        m = re.search(r"t\.me/(?:s/)?([A-Za-z0-9_]{4,})", candidate) if "t.me" in candidate else \
            re.match(r"([A-Za-z0-9_]{4,})", candidate)
        if m and m.group(1).lower() not in ("share", "joinchat", "s"):
            return m.group(1)
    return None


def witness_telegram(session: requests.Session) -> dict[str, set[str]]:
    channel = _telegram_channel(session)
    if not channel:
        return {}
    try:
        r = session.get(f"https://t.me/s/{channel}", timeout=10)
    except requests.RequestException:
        return {}
    hosts = list(reversed(_hosts_in(r.text)))[:6]  # newest posts are at the bottom
    return {h: {"telegram"} for h in hosts}


def witness_link_pages(session: requests.Session) -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for url in LINK_PAGES:
        try:
            r = session.get(url.strip(), timeout=10)
        except requests.RequestException:
            continue
        if r.ok:
            for h in _hosts_in(r.text)[:6]:
                found.setdefault(h, set()).add("link_pages")
    return found


def witness_wikidata(session: requests.Session) -> dict[str, set[str]]:
    api = "https://www.wikidata.org/w/api.php"
    try:
        r = session.get(api, params={"action": "wbsearchentities", "search": "StreamingCommunity",
                                     "language": "it", "format": "json", "limit": 3}, timeout=8)
        ids = [e["id"] for e in r.json().get("search", [])]
        if not ids:
            return {}
        r = session.get(api, params={"action": "wbgetentities", "ids": "|".join(ids),
                                     "props": "claims", "format": "json"}, timeout=8)
        found: dict[str, set[str]] = {}
        for ent in r.json().get("entities", {}).values():
            for claim in ent.get("claims", {}).get("P856", []):
                url = claim.get("mainsnak", {}).get("datavalue", {}).get("value", "")
                host = normalize_host(url)
                if host:
                    found.setdefault(host, set()).add("wikidata")
        return found
    except Exception:  # noqa: BLE001
        return {}


def witness_tld_sweep(_session: requests.Session) -> dict[str, set[str]]:
    stems = list(dict.fromkeys([stem_of(h) for h in _known_hosts()] + list(DEFAULT_STEMS)))
    stems = [s for s in stems if NAME_PATTERN.match(s)][:5]
    names = [f"{s}.{tld}" for s in stems for tld in TLDS]
    found: dict[str, set[str]] = {}

    def resolves(name: str) -> bool:
        try:
            socket.getaddrinfo(name, 443, proto=socket.IPPROTO_TCP)
            return True
        except OSError:
            return False

    with ThreadPoolExecutor(max_workers=48) as pool:
        for name, ok in zip(names, pool.map(resolves, names)):
            if ok:
                found[name] = {"tld_sweep"}
    return found


WITNESSES = (
    ("redirect", witness_canonical_and_redirect),
    ("telegram", witness_telegram),
    ("link_pages", witness_link_pages),
    ("wikidata", witness_wikidata),
    ("tld_sweep", witness_tld_sweep),
)


# ── Discovery ─────────────────────────────────────────────────────────────────

def discover(*, include_sweep: bool = True, progress=None) -> dict:
    """Run every witness, verify every candidate, return a ranked report."""
    session = net.new_session(pool_size=16)
    candidates: dict[str, Candidate] = {}
    started = time.time()

    def note(stage: str, **extra) -> None:
        if progress:
            progress({"stage": stage, **extra})

    with ThreadPoolExecutor(max_workers=len(WITNESSES)) as pool:
        futures = {pool.submit(fn, session): name for name, fn in WITNESSES
                   if include_sweep or name != "tld_sweep"}
        for fut in as_completed(futures):
            name = futures[fut]
            try:
                result = fut.result()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Domain witness %s failed: %s", name, exc)
                result = {}
            for host, tags in result.items():
                cand = candidates.setdefault(host, Candidate(host))
                cand.witnesses |= tags
            note("witness", witness=name, found=len(result))

    # The current host is always re-checked, so a report can say "still fine".
    cur = current()
    if cur:
        candidates.setdefault(cur, Candidate(cur))

    note("verify", total=len(candidates))

    def check(cand: Candidate) -> Candidate:
        info, reason, latency = verify(cand.host, functional=cand.score > 1 or cand.host == cur)
        cand.latency_ms = latency
        if info is None:
            cand.status, cand.reason = "rejected", reason
            return cand
        cand.status, cand.version = "verified", info.version
        # A verified host that names another canonical host is a strong lead.
        canon = normalize_host(info.app_url or "")
        if canon and canon != cand.host and canon not in candidates and not check_shape(canon):
            extra = Candidate(canon, {"canonical"})
            info2, reason2, lat2 = verify(canon)
            extra.status = "verified" if info2 else "rejected"
            extra.reason, extra.latency_ms = reason2, lat2
            extra.version = info2.version if info2 else None
            candidates[canon] = extra
        if info.telegram_link and info.telegram_link != config.value("telegram_link"):
            config.update({"telegram_link": info.telegram_link})
        return cand

    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(check, list(candidates.values())))

    verified = [c for c in candidates.values() if c.status == "verified"]
    # A host that verified but has no witness (e.g. only the current host) still
    # counts; ties are broken by speed.
    verified.sort(key=lambda c: (-c.score, c.host != cur, c.latency_ms or 99999))
    best = verified[0] if verified else None

    report = {
        "checked_at": started,
        "duration_ms": int((time.time() - started) * 1000),
        "current": cur,
        "current_ok": any(c.host == cur for c in verified),
        "best": best.as_dict() if best else None,
        "candidates": sorted((c.as_dict() for c in candidates.values()),
                             key=lambda d: (d["status"] != "verified", -d["score"], d["host"])),
    }
    with _lock:
        _last_report.clear()
        _last_report.update(report)
    note("done", best=report["best"])
    return report


# ── Applying ──────────────────────────────────────────────────────────────────

def _remember(host: str) -> None:
    history = [h for h in (config.value("domain_history") or []) if h.get("host") != host]
    history.insert(0, {"host": host, "last_ok": time.time()})
    config.update({"domain_history": history[:12]})


def apply(host: str, *, verified: bool = False) -> dict:
    """Make ``host`` the configured domain. Re-verifies unless told it just was."""
    global _pending
    host = normalize_host(host)
    if not verified:
        info, reason, _ = verify(host)
        if info is None:
            raise ValueError(reason or "not_the_source")
    old = current()
    config.update({"domain": host})
    _remember(host)
    with _lock:
        _pending = None
    if old != host:
        logger.info("Source domain changed: %s -> %s", old or "(none)", host)
        events.publish({"type": "domain_changed", "old": old, "new": host})
    return {"domain": host, "previous": old}


def check_and_heal(*, force: bool = False, include_sweep: bool = True) -> dict:
    """The full cycle: is the current domain alive? If not, find and adopt a new one."""
    global _pending
    if not _running.acquire(blocking=False):
        return {"busy": True, **last_report()}
    try:
        cur = current()
        if cur and not force:
            info, reason, _ = verify(cur, functional=False)
            if info is not None:
                _remember(cur)
                if info.telegram_link:
                    config.update({"telegram_link": info.telegram_link})
                canon = normalize_host(info.app_url or "")
                if not canon or canon == cur:
                    return {"current": cur, "current_ok": True, "best": None, "applied": False}
                logger.info("Current domain %s announces a new canonical host %s", cur, canon)

        events.publish({"type": "domain_search", "state": "started"})
        report = discover(include_sweep=include_sweep,
                          progress=lambda p: events.publish({"type": "domain_search", **p}))
        best = report.get("best")
        report["applied"] = False
        if best and best["host"] != cur:
            if config.value("domain_auto_apply") or not cur:
                apply(best["host"], verified=True)
                report["applied"] = True
            else:
                with _lock:
                    _pending = {"host": best["host"], "found_at": time.time()}
                events.publish({"type": "domain_candidate", "host": best["host"]})
        elif best and best["host"] == cur:
            _remember(cur)
        events.publish({"type": "domain_search", "state": "finished",
                        "applied": report["applied"], "best": best})
        return report
    finally:
        _running.release()


def on_source_failure() -> str | None:
    """Called when a request to the source fails. Heals at most once per cooldown.

    Returns the new host if the domain changed, so the caller can retry.
    """
    global _last_reactive
    now = time.monotonic()
    if now - _last_reactive < REACTIVE_COOLDOWN or is_running():
        return None
    _last_reactive = now
    before = current()
    check_and_heal()
    after = current()
    return after if after and after != before else None


def watch_loop(stop: threading.Event) -> None:
    """Background thread: periodic health check, discovery when it fails."""
    stop.wait(20)
    while not stop.is_set():
        if config.value("setup_done"):
            try:
                check_and_heal()
            except Exception:  # noqa: BLE001
                logger.exception("Domain check failed")
        minutes = max(5, int(config.value("domain_check_minutes") or 30))
        stop.wait(minutes * 60)
