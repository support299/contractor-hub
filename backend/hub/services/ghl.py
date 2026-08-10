"""Slim GoHighLevel client for phone OTP (Private Integration Token)."""

from __future__ import annotations

import logging
from typing import Any

import requests
from django.conf import settings

from hub.models import HubUser

logger = logging.getLogger(__name__)

LOGIN_OTP_FIELD_NAME = "Login Otp"


class GHLConfigError(Exception):
    pass


class GHLApiError(Exception):
    pass


def _base_url() -> str:
    return getattr(
        settings, "GHL_BASE_URL", "https://services.leadconnectorhq.com"
    ).rstrip("/")


def _headers() -> dict[str, str]:
    token = (getattr(settings, "GHL_PRIVATE_TOKEN", "") or "").strip()
    if not token:
        raise GHLConfigError("GHL_PRIVATE_TOKEN is not configured")
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "Version": getattr(settings, "GHL_API_VERSION", "2021-07-28"),
    }


def _location_id() -> str:
    loc = (getattr(settings, "GHL_LOCATION_ID", "") or "").strip()
    if not loc:
        raise GHLConfigError("GHL_LOCATION_ID is not configured")
    return loc


def ensure_login_otp_field(location_id: str | None = None) -> str | None:
    """Return custom field id for Login Otp, creating the field if missing."""
    loc = location_id or _location_id()
    headers = _headers()
    base = f"{_base_url()}/locations/{loc}/customFields"

    try:
        resp = requests.get(f"{base}?model=contact", headers=headers, timeout=30)
        fields: list[dict[str, Any]] = []
        if resp.status_code == 200:
            fields = resp.json().get("customFields") or []
            for field in fields:
                if field.get("name") == LOGIN_OTP_FIELD_NAME:
                    return field.get("id")

        create_resp = requests.post(
            base,
            json={
                "name": LOGIN_OTP_FIELD_NAME,
                "dataType": "TEXT",
                "placeholder": "login_otp",
                "model": "contact",
            },
            headers=headers,
            timeout=30,
        )
        if create_resp.status_code in (200, 201):
            data = create_resp.json()
            field_id = (data.get("customField") or {}).get("id") or data.get("id")
            if field_id:
                return field_id

        # Already exists under different casing
        if create_resp.status_code == 400 or "already exists" in create_resp.text.lower():
            for field in fields:
                name = (field.get("name") or "").lower()
                if "login" in name and "otp" in name:
                    return field.get("id")
            # Refresh list
            resp2 = requests.get(f"{base}?model=contact", headers=headers, timeout=30)
            if resp2.status_code == 200:
                for field in resp2.json().get("customFields") or []:
                    name = (field.get("name") or "").lower()
                    if "login" in name and "otp" in name:
                        return field.get("id")

        logger.error(
            "Failed to ensure Login Otp field: %s %s",
            create_resp.status_code,
            create_resp.text[:500],
        )
        return None
    except requests.RequestException as exc:
        logger.error("GHL custom field error: %s", exc)
        return None


def search_contact_by_phone(phone: str, location_id: str | None = None) -> str | None:
    loc = location_id or _location_id()
    headers = _headers()
    try:
        resp = requests.post(
            f"{_base_url()}/contacts/search",
            json={"query": {"locationId": loc, "phone": phone}},
            headers=headers,
            timeout=30,
        )
        if resp.status_code != 200:
            logger.warning("GHL contact search failed: %s %s", resp.status_code, resp.text[:300])
            return None
        contacts = resp.json().get("contacts") or []
        if contacts:
            return contacts[0].get("id")
        return None
    except requests.RequestException as exc:
        logger.error("GHL contact search error: %s", exc)
        return None


def upsert_contact_by_phone(
    phone: str,
    *,
    email: str = "",
    name: str = "",
    location_id: str | None = None,
) -> str | None:
    """Create or find contact by phone; return contact id."""
    loc = location_id or _location_id()
    headers = _headers()
    payload: dict[str, Any] = {
        "phone": phone,
        "source": "contractor-hub",
        "locationId": loc,
    }
    if email:
        payload["email"] = email
    if name:
        parts = name.strip().split(None, 1)
        payload["firstName"] = parts[0]
        if len(parts) > 1:
            payload["lastName"] = parts[1]
        payload["name"] = name.strip()

    try:
        resp = requests.post(
            f"{_base_url()}/contacts/",
            json=payload,
            headers=headers,
            timeout=30,
        )
        if resp.status_code in (200, 201):
            data = resp.json()
            return (data.get("contact") or {}).get("id") or data.get("id")

        if resp.status_code == 400 and "duplicated contacts" in resp.text.lower():
            contact_id = (resp.json().get("meta") or {}).get("contactId")
            if contact_id:
                update = {k: v for k, v in payload.items() if k != "locationId"}
                requests.put(
                    f"{_base_url()}/contacts/{contact_id}",
                    json=update,
                    headers=headers,
                    timeout=30,
                )
                return contact_id

        # Fallback search
        found = search_contact_by_phone(phone, loc)
        if found:
            return found

        logger.error(
            "GHL upsert contact failed: %s %s", resp.status_code, resp.text[:500]
        )
        return None
    except requests.RequestException as exc:
        logger.error("GHL upsert contact error: %s", exc)
        return None


def set_login_otp(contact_id: str, otp: str, location_id: str | None = None) -> bool:
    loc = location_id or _location_id()
    field_id = ensure_login_otp_field(loc)
    if not field_id:
        raise GHLApiError("Could not resolve Login Otp custom field id")

    headers = _headers()
    url = f"{_base_url()}/contacts/{contact_id}"
    try:
        resp = requests.put(
            url,
            json={"customFields": [{"id": field_id, "value": str(otp)}]},
            headers=headers,
            timeout=30,
        )
        if resp.status_code == 200:
            return True
        logger.error(
            "GHL set Login Otp failed: %s %s", resp.status_code, resp.text[:500]
        )
        return False
    except requests.RequestException as exc:
        logger.error("GHL set Login Otp error: %s", exc)
        return False


def push_otp_to_ghl(hub_user: HubUser, otp: str) -> str | None:
    """
    Upsert contact for hub_user and write Login Otp.
    Returns GHL contact id on success; raises on config/API failure.
    """
    phone = (hub_user.phone or "").strip()
    if not phone:
        raise GHLApiError("Hub user has no phone")

    contact_id = (hub_user.ghl_id or "").strip() or None
    if not contact_id:
        contact_id = upsert_contact_by_phone(
            phone,
            email=(hub_user.email or "").strip(),
            name=(hub_user.name or "").strip(),
        )
    if not contact_id:
        raise GHLApiError("Failed to upsert GHL contact")

    if not set_login_otp(contact_id, otp):
        raise GHLApiError("Failed to set Login Otp on GHL contact")

    if hub_user.ghl_id != contact_id:
        hub_user.ghl_id = contact_id
        hub_user.save(update_fields=["ghl_id", "updated_at"])

    return contact_id
