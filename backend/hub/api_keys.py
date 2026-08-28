"""API key generation, hashing, and DRF authentication for analytics."""

from __future__ import annotations

import hashlib
import secrets

from django.utils import timezone
from rest_framework import authentication, exceptions
from rest_framework.permissions import BasePermission

from hub.models import HubApiKey

KEY_PREFIX = "chub_"
HEADER_NAME = "HTTP_X_API_KEY"


def hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    """
    Return (raw_key, prefix, key_hash).
    raw_key is shown once at creation; only hash is stored.
    """
    secret = secrets.token_urlsafe(32)
    raw = f"{KEY_PREFIX}{secret}"
    prefix = raw[:12]
    return raw, prefix, hash_api_key(raw)


def extract_raw_key(request) -> str:
    header = (request.META.get(HEADER_NAME) or "").strip()
    if header:
        return header
    auth = (request.META.get("HTTP_AUTHORIZATION") or "").strip()
    if auth.lower().startswith("api-key "):
        return auth[8:].strip()
    if auth.lower().startswith("bearer ") and auth[7:].strip().startswith(KEY_PREFIX):
        return auth[7:].strip()
    return ""


class AnalyticsApiKeyAuthentication(authentication.BaseAuthentication):
    """Authenticate with X-API-Key or Authorization: Api-Key <key>."""

    def authenticate(self, request):
        raw = extract_raw_key(request)
        if not raw:
            return None
        key_hash = hash_api_key(raw)
        try:
            api_key = HubApiKey.objects.get(key_hash=key_hash, is_active=True)
        except HubApiKey.DoesNotExist:
            raise exceptions.AuthenticationFailed("Invalid or inactive API key")
        HubApiKey.objects.filter(pk=api_key.pk).update(last_used_at=timezone.now())
        return (api_key, raw)


class IsAnalyticsApiKey(BasePermission):
    """Allow only requests authenticated via HubApiKey."""

    def has_permission(self, request, view):
        return isinstance(getattr(request, "user", None), HubApiKey)
