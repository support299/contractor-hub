"""GHL internal API client (same auth pattern as rd-triplewhale/core)."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

import requests
from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from hub.models import GhlGoogleReview, GhlInternalAuth

logger = logging.getLogger(__name__)

INTERNAL_BASE = "https://backend.leadconnectorhq.com"
OAUTH_REFRESH_URL = "https://services.leadconnectorhq.com/oauth/2/login/signin/refresh"
GOOGLE_REVIEW_SOURCE = 247
SYNC_TTL = timedelta(minutes=15)
PAGE_SIZE = 50
MAX_PAGES = 80
HTTP_TIMEOUT = 30


class GhlInternalConfigError(Exception):
    pass


class GhlInternalApiError(Exception):
    pass


def _location_id() -> str:
    loc = (getattr(settings, "GHL_LOCATION_ID", "") or "").strip()
    if not loc:
        raise GhlInternalConfigError("GHL_LOCATION_ID is not configured")
    return loc


def _ensure_auth_row() -> GhlInternalAuth:
    loc = _location_id()
    obj, _ = GhlInternalAuth.objects.get_or_create(location_id=loc)
    api_key = (getattr(settings, "GHL_FIREBASE_API_KEY", "") or "").strip()
    refresh = (getattr(settings, "GHL_FIREBASE_REFRESH_TOKEN", "") or "").strip()
    if api_key and not obj.firebase_api_key:
        obj.firebase_api_key = api_key
    if refresh and not obj.firebase_refresh_token:
        obj.firebase_refresh_token = refresh
    if api_key or refresh:
        obj.save()
    return obj


def _token_expired(obj: GhlInternalAuth) -> bool:
    if not obj.access_token:
        return True
    if obj.expires_at is None:
        return False
    return timezone.now() >= obj.expires_at - timedelta(minutes=2)


def _firebase_refresh(api_key: str, refresh_token: str) -> dict[str, Any]:
    url = f"https://securetoken.googleapis.com/v1/token?key={api_key}"
    resp = requests.post(
        url,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "origin": "https://app.gohighlevel.com",
            "referer": "https://app.gohighlevel.com/",
        },
        data={"refresh_token": refresh_token, "grant_type": "refresh_token"},
        timeout=HTTP_TIMEOUT,
    )
    if resp.status_code >= 400:
        raise GhlInternalApiError(f"Firebase token refresh failed: {resp.status_code} {resp.text[:300]}")
    return resp.json()


def _leadconnector_signin_refresh(location_id: str, bearer: str, token_id: str) -> dict[str, Any]:
    auth = bearer if bearer.lower().startswith("bearer ") else f"Bearer {bearer}"
    url = f"{OAUTH_REFRESH_URL}?version=2&location_id={location_id}"
    resp = requests.post(
        url,
        headers={
            "accept": "application/json, text/plain, */*",
            "authorization": auth,
            "channel": "APP",
            "content-type": "application/json;charset=UTF-8",
            "origin": "https://app.gohighlevel.com",
            "referer": "https://app.gohighlevel.com/",
            "source": "WEB_USER",
            "token-id": token_id,
            "version": "2021-07-28",
        },
        json={},
        timeout=HTTP_TIMEOUT,
    )
    if resp.status_code >= 400:
        raise GhlInternalApiError(
            f"LeadConnector signin refresh failed: {resp.status_code} {resp.text[:300]}"
        )
    return resp.json()


def _sign_in_custom_token(api_key: str, custom_token: str) -> dict[str, Any]:
    url = (
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken"
        f"?key={api_key}"
    )
    resp = requests.post(
        url,
        headers={
            "content-type": "application/json",
            "origin": "https://app.gohighlevel.com",
            "referer": "https://app.gohighlevel.com/",
        },
        json={"token": custom_token, "returnSecureToken": True},
        timeout=HTTP_TIMEOUT,
    )
    if resp.status_code >= 400:
        raise GhlInternalApiError(f"Firebase custom token sign-in failed: {resp.status_code} {resp.text[:300]}")
    return resp.json()


def refresh_internal_token(location_id: str | None = None) -> GhlInternalAuth:
    loc = (location_id or "").strip() or _location_id()
    obj = GhlInternalAuth.objects.filter(location_id=loc).first()
    if obj is None:
        obj = _ensure_auth_row()
    if not obj.firebase_api_key or not obj.firebase_refresh_token:
        raise GhlInternalConfigError(
            "GHL Firebase API key and refresh token are not set (admin or GHL_FIREBASE_* env)."
        )

    fb = _firebase_refresh(obj.firebase_api_key, obj.firebase_refresh_token)
    if fb.get("refresh_token"):
        obj.firebase_refresh_token = fb["refresh_token"]
    if fb.get("access_token"):
        obj.firebase_access_token = fb["access_token"]
        obj.leadconnector_bearer_token = fb["access_token"]
    if fb.get("id_token"):
        obj.firebase_id_token = fb["id_token"]
    obj.save()

    lc = _leadconnector_signin_refresh(
        obj.location_id,
        obj.leadconnector_bearer_token,
        obj.firebase_id_token,
    )
    custom = lc.get("token") or ""
    if not custom:
        raise GhlInternalApiError("LeadConnector refresh returned no custom token")
    obj.firebase_custom_token = custom
    obj.save(update_fields=["firebase_custom_token", "updated_at"])

    signed = _sign_in_custom_token(obj.firebase_api_key, custom)
    id_token = signed.get("idToken") or ""
    if not id_token:
        raise GhlInternalApiError("Firebase signInWithCustomToken returned no idToken")
    obj.access_token = id_token
    if signed.get("refreshToken"):
        obj.firebase_refresh_token = signed["refreshToken"]
    expires_in = signed.get("expiresIn")
    if expires_in:
        obj.expires_at = timezone.now() + timedelta(seconds=int(expires_in))
    obj.save()
    return obj


def _valid_token() -> str:
    obj = _ensure_auth_row()
    if _token_expired(obj):
        obj = refresh_internal_token(obj.location_id)
    if not obj.access_token:
        raise GhlInternalConfigError("No GHL internal access token")
    return obj.access_token


def _internal_headers(token: str) -> dict[str, str]:
    return {
        "accept": "application/json, text/plain, */*",
        "channel": "APP",
        "source": "WEB_USER",
        "version": "2021-07-28",
        "Token-Id": token,
    }


def _get_json(url: str, params: dict[str, Any], token: str) -> dict[str, Any]:
    resp = requests.get(
        url,
        headers=_internal_headers(token),
        params=params,
        timeout=HTTP_TIMEOUT,
    )
    if resp.status_code == 401:
        obj = refresh_internal_token()
        resp = requests.get(
            url,
            headers=_internal_headers(obj.access_token),
            params=params,
            timeout=HTTP_TIMEOUT,
        )
    if resp.status_code >= 400:
        raise GhlInternalApiError(f"GHL internal GET failed: {resp.status_code} {resp.text[:400]}")
    data = resp.json()
    if not isinstance(data, dict):
        raise GhlInternalApiError("GHL internal GET returned non-object JSON")
    return data


def _parse_dt(value: Any):
    if not value:
        return None
    if hasattr(value, "year"):
        return value
    parsed = parse_datetime(str(value))
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.utc)
    return parsed


def fetch_google_review_pages() -> list[dict[str, Any]]:
    loc = _location_id()
    token = _valid_token()
    url = f"{INTERNAL_BASE}/reputation/reviews"
    rows: list[dict[str, Any]] = []
    for page in range(1, MAX_PAGES + 1):
        params = {
            "filterParams[locationId][0][value]": loc,
            "filterParams[locationId][0][condition]": "eq",
            "filterParams[deleted][0][value]": "false",
            "filterParams[deleted][0][condition]": "eq",
            "filterParams[source][0][value]": str(GOOGLE_REVIEW_SOURCE),
            "filterParams[source][0][condition]": "eq",
            "sortParams[dateAdded]": "-1",
            "pageNumber": str(page),
            "pageSize": str(PAGE_SIZE),
        }
        data = _get_json(url, params, token)
        batch = data.get("reviews") or []
        if not isinstance(batch, list) or not batch:
            break
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
    return rows


def upsert_google_reviews(payloads: list[dict[str, Any]]) -> int:
    count = 0
    for raw in payloads:
        rid = str(raw.get("id") or "").strip()
        if not rid:
            continue
        GhlGoogleReview.objects.update_or_create(
            ghl_id=rid,
            defaults={
                "reviewer_name": str(raw.get("reviewerName") or "")[:255],
                "comment": str(raw.get("comment") or ""),
                "star_rating": int(raw.get("starRating") or 0),
                "source": int(raw.get("source") or GOOGLE_REVIEW_SOURCE),
                "deleted": bool(raw.get("deleted")),
                "date_added": _parse_dt(raw.get("dateAdded")),
            },
        )
        count += 1
    return count


def sync_google_reviews(*, force: bool = False) -> int:
    obj = _ensure_auth_row()
    if (
        not force
        and obj.last_reviews_synced_at
        and timezone.now() - obj.last_reviews_synced_at < SYNC_TTL
    ):
        return GhlGoogleReview.objects.filter(source=GOOGLE_REVIEW_SOURCE, deleted=False).count()
    payloads = fetch_google_review_pages()
    n = upsert_google_reviews(payloads)
    obj.last_reviews_synced_at = timezone.now()
    obj.save(update_fields=["last_reviews_synced_at", "updated_at"])
    logger.info("Synced %s Google reviews from GHL", n)
    return n


def count_five_star(*, start=None, end=None) -> int:
    qs = GhlGoogleReview.objects.filter(
        source=GOOGLE_REVIEW_SOURCE,
        deleted=False,
        star_rating=5,
    )
    if start:
        qs = qs.filter(date_added__gte=start)
    if end:
        qs = qs.filter(date_added__lte=end)
    return qs.count()
