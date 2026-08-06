"""Media storage helpers — local disk by default, S3 when USE_S3=True."""

from django.conf import settings
from django.core.files.storage import default_storage


def use_s3() -> bool:
    return bool(getattr(settings, "USE_S3", False))


def save_file(relative_path: str, file_obj) -> str:
    """Save an uploaded file; returns the stored key/path."""
    # default_storage.save returns the final name
    return default_storage.save(relative_path, file_obj)


def delete_file(relative_path: str) -> bool:
    if not relative_path:
        return False
    if default_storage.exists(relative_path):
        default_storage.delete(relative_path)
        return True
    return False


def file_exists(relative_path: str) -> bool:
    if not relative_path:
        return False
    return default_storage.exists(relative_path)


def file_url(relative_path: str, expire_seconds: int = 3600) -> str | None:
    """Public or pre-signed URL for a stored object."""
    if not relative_path:
        return None
    if not default_storage.exists(relative_path):
        return None
    if use_s3():
        # django-storages S3Boto3Storage.url() returns a signed URL when querystring_auth=True
        return default_storage.url(relative_path)
    # Local: caller should build absolute URI from MEDIA_URL + path
    return settings.MEDIA_URL + relative_path.lstrip("/")
