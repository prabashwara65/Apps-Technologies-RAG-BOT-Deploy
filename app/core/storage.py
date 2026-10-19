"""Store avatars locally under a configurable root, keyed by user email.

No external storage is used. Railway's filesystem is ephemeral: mount a
volume at UPLOADS_ROOT to preserve images across redeploys.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import UploadFile

UPLOADS_ROOT = Path(os.environ.get("UPLOADS_ROOT", "uploads")).resolve()
AVATARS_DIR = UPLOADS_ROOT / "avatars"
ALLOWED_AVATAR_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_AVATAR_BYTES = 2 * 1024 * 1024


class StorageError(Exception):
    pass


def configure_storage(root: str) -> None:
    """Use validated settings, including UPLOADS_ROOT loaded from dotenv."""
    global UPLOADS_ROOT, AVATARS_DIR
    UPLOADS_ROOT = Path(root).resolve()
    AVATARS_DIR = UPLOADS_ROOT / "avatars"


def ensure_avatars_dir() -> None:
    AVATARS_DIR.mkdir(parents=True, exist_ok=True)


def _sanitize_email(email: str) -> str:
    sanitized = re.sub(r"[^a-z0-9._-]", "_", email.lower())
    if not sanitized or sanitized in {".", ".."}:
        raise StorageError("The account email cannot be used as an avatar filename.")
    return sanitized


def _extension_for(filename: str) -> str:
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_AVATAR_EXTENSIONS:
        raise StorageError("Upload a JPEG, PNG, or WebP image.")
    return extension


def _delete_existing_for(email: str) -> None:
    stem = _sanitize_email(email)
    if AVATARS_DIR.is_dir():
        for path in AVATARS_DIR.iterdir():
            if path.stem == stem and (path.is_file() or path.is_symlink()):
                path.unlink()


def save_avatar(email: str, upload: UploadFile) -> str:
    """Write in 64 KiB chunks and remove incomplete files on failure."""
    extension = _extension_for(upload.filename or "")
    stem = _sanitize_email(email)
    if len(stem + extension) > 255:
        raise StorageError("The account email is too long for an avatar filename.")
    if upload.size is not None and upload.size > MAX_AVATAR_BYTES:
        raise StorageError("Choose an image no larger than 2 MB.")
    ensure_avatars_dir()
    # Check signatures before deleting the previous image.
    upload.file.seek(0)
    header = upload.file.read(16)
    valid = (
        (extension in {".jpg", ".jpeg"} and header.startswith(b"\xff\xd8\xff"))
        or (extension == ".png" and header.startswith(b"\x89PNG\r\n\x1a\n"))
        or (extension == ".webp" and header[:4] == b"RIFF" and header[8:12] == b"WEBP")
    )
    if not valid:
        raise StorageError("The file contents must match a JPEG, PNG, or WebP image.")
    upload.file.seek(0)
    _delete_existing_for(email)
    filename = f"{stem}{extension}"
    destination = AVATARS_DIR / filename
    size = 0
    try:
        with destination.open("xb") as output:
            while chunk := upload.file.read(64 * 1024):
                size += len(chunk)
                if size > MAX_AVATAR_BYTES:
                    raise StorageError("Choose an image no larger than 2 MB.")
                output.write(chunk)
    except (OSError, StorageError) as error:
        destination.unlink(missing_ok=True)
        if isinstance(error, StorageError):
            raise
        raise StorageError("The profile image could not be stored.") from error
    return filename


def delete_avatar(email: str) -> None:
    _delete_existing_for(email)


def avatar_path(email: str) -> Path | None:
    stem = _sanitize_email(email)
    for extension in sorted(ALLOWED_AVATAR_EXTENSIONS):
        path = AVATARS_DIR / f"{stem}{extension}"
        if path.is_file() and not path.is_symlink():
            return path
    return None
