"""AES-128 decryption and key retrieval for HLS segments."""

from __future__ import annotations

import logging
from urllib.parse import urlparse

import requests
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from .. import net

logger = logging.getLogger(__name__)

ALLOWED_KEY_HOSTS = ("vixcloud.co",)


class DecryptionError(RuntimeError):
    pass


def fetch_key(session: requests.Session, key_url: str, referer: str | None = None) -> bytes:
    """Fetch the 16-byte AES key from an allowed key host."""
    parsed = urlparse(key_url)
    host = (parsed.hostname or "").lower()
    if not any(host == allowed or host.endswith("." + allowed) for allowed in ALLOWED_KEY_HOSTS):
        raise DecryptionError(f"Key host '{host}' is not in allowed hosts")

    headers = {"Referer": referer} if referer else {}
    resp = net.get_with_retry(session, key_url, headers=headers, what="AES key")
    if not resp.ok:
        raise DecryptionError(f"Failed to fetch AES key: HTTP {resp.status_code}")
    key_bytes = resp.content
    if len(key_bytes) != 16:
        raise DecryptionError(f"Unexpected key length: {len(key_bytes)} bytes (expected 16)")
    return key_bytes


def sequence_iv(sequence_number: int) -> bytes:
    """Generate default 16-byte IV from media sequence number per HLS spec."""
    return sequence_number.to_bytes(16, byteorder="big")


class SegmentDecryptor:
    def __init__(self, key: bytes, default_iv: bytes | None = None):
        self.key = key
        self.default_iv = default_iv

    def decrypt(self, data: bytes, iv: bytes | None = None) -> bytes:
        used_iv = iv or self.default_iv
        if not used_iv:
            raise DecryptionError("Missing IV for decryption")
        cipher = Cipher(algorithms.AES(self.key), modes.CBC(used_iv), backend=default_backend())
        decryptor = cipher.decryptor()
        return decryptor.update(data) + decryptor.finalize()
