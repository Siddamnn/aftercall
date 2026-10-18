"""Uploaded recordings: Cloud Storage in production, a local folder without a bucket.

Vertex AI reads `gs://` URIs directly, so large audio never has to pass through the API process.
"""

import re
import secrets
from datetime import UTC, datetime
from pathlib import Path

from aftercall.config import get_settings

GCS_PREFIX = "gs://"
LOCAL_DIR = Path(".uploads")
UNSAFE_NAME_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


class StorageError(Exception):
    pass


def save_upload(data: bytes, name: str, content_type: str) -> str:
    """Store the bytes and return where they are: a `gs://` URI, or a local path without a bucket."""
    key = f"uploads/{datetime.now(UTC):%Y-%m-%d}/{secrets.token_hex(8)}-{_safe_name(name)}"
    bucket = get_settings().gcs_bucket
    if bucket:
        _bucket(bucket).blob(key).upload_from_string(data, content_type=content_type or "application/octet-stream")
        return f"{GCS_PREFIX}{bucket}/{key}"
    path = LOCAL_DIR / key.removeprefix("uploads/")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return str(path)


def read_upload(uri: str) -> bytes:
    if uri.startswith(GCS_PREFIX):
        bucket, _, key = uri.removeprefix(GCS_PREFIX).partition("/")
        return _bucket(bucket).blob(key).download_as_bytes()
    path = Path(uri).resolve()
    if not path.is_relative_to(LOCAL_DIR.resolve()):
        raise StorageError("not an upload path")
    if not path.is_file():
        raise StorageError(f"upload not found: {uri}")
    return path.read_bytes()


def delete_upload(uri: str) -> None:
    """Remove a recording for good (call or upload deleted). Already gone is fine."""
    if uri.startswith(GCS_PREFIX):
        from google.api_core.exceptions import NotFound

        bucket, _, key = uri.removeprefix(GCS_PREFIX).partition("/")
        try:
            _bucket(bucket).blob(key).delete()
        except NotFound:
            pass
        return
    path = Path(uri).resolve()
    if path.is_relative_to(LOCAL_DIR.resolve()):
        path.unlink(missing_ok=True)


def _safe_name(name: str) -> str:
    """The file name only: no folders, no characters that mean something in a path."""
    base = re.split(r"[\\/]", name)[-1]
    return UNSAFE_NAME_CHARS.sub("_", base).strip("._") or "file"


def _bucket(name: str):
    from google.cloud import storage

    return storage.Client(project=get_settings().gcp_project or None).bucket(name)
