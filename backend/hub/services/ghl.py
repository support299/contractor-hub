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


def phone_from_contact(contact: dict[str, Any] | None) -> str:
    if not contact:
        return ""
    phone = str(contact.get("phone") or "").strip()
    if phone:
        return phone
    for extra in contact.get("additionalPhones") or []:
        if isinstance(extra, dict):
            candidate = str(extra.get("phone") or extra.get("number") or "").strip()
        else:
            candidate = str(extra or "").strip()
        if candidate:
            return candidate
    return ""


def search_contact_by_email(
    email: str, location_id: str | None = None
) -> dict[str, Any] | None:
    """Return the GHL contact whose email matches, or None."""
    loc = location_id or _location_id()
    email_norm = (email or "").strip()
    if not email_norm:
        return None
    headers = _headers()
    email_lower = email_norm.lower()

    def _pick(contacts: list[Any]) -> dict[str, Any] | None:
        matches: list[dict[str, Any]] = []
        for raw in contacts:
            if not isinstance(raw, dict):
                continue
            if (raw.get("email") or "").strip().lower() == email_lower:
                matches.append(raw)
        return matches[0] if matches else None

    try:
        resp = requests.post(
            f"{_base_url()}/contacts/search",
            json={"locationId": loc, "query": email_norm, "pageLimit": 10},
            headers=headers,
            timeout=30,
        )
        contacts: list[Any] = []
        if resp.status_code == 200:
            contacts = resp.json().get("contacts") or []
        else:
            logger.warning(
                "GHL contact email search failed: %s %s",
                resp.status_code,
                resp.text[:300],
            )

        picked = _pick(contacts)
        if picked:
            return picked

        resp = requests.get(
            f"{_base_url()}/contacts/",
            params={"locationId": loc, "query": email_norm, "limit": 10},
            headers=headers,
            timeout=30,
        )
        if resp.status_code != 200:
            logger.warning(
                "GHL contact email query failed: %s %s",
                resp.status_code,
                resp.text[:300],
            )
            return None
        return _pick(resp.json().get("contacts") or [])
    except requests.RequestException as exc:
        logger.error("GHL contact email search error: %s", exc)
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


def send_conversation_sms(hub_user: HubUser, message: str) -> bool:
    """Send an SMS via GHL Conversations. Returns True on HTTP 200/201."""
    text = (message or "").strip()
    if not text:
        logger.warning("GHL SMS skip: empty message for user %s", hub_user.id)
        return False

    contact_id = (hub_user.ghl_id or "").strip() or None
    phone = (hub_user.phone or "").strip()
    if not contact_id and not phone:
        logger.warning(
            "GHL SMS skip: user %s has no phone or ghl_id", hub_user.id
        )
        return False

    try:
        if not contact_id:
            contact_id = upsert_contact_by_phone(
                phone,
                email=(hub_user.email or "").strip(),
                name=(hub_user.name or "").strip(),
            )
            if contact_id and hub_user.ghl_id != contact_id:
                hub_user.ghl_id = contact_id
                hub_user.save(update_fields=["ghl_id", "updated_at"])
        if not contact_id:
            logger.error("GHL SMS: no contact id for user %s", hub_user.id)
            return False

        headers = _headers()
        headers["Version"] = getattr(
            settings, "GHL_CONVERSATIONS_API_VERSION", "2021-04-15"
        )
        resp = requests.post(
            f"{_base_url()}/conversations/messages",
            json={"type": "SMS", "contactId": contact_id, "message": text},
            headers=headers,
            timeout=30,
        )
        if resp.status_code in (200, 201):
            return True
        logger.error(
            "GHL Conversations SMS failed for user %s: %s %s",
            hub_user.id,
            resp.status_code,
            resp.text[:500],
        )
        return False
    except GHLConfigError:
        logger.exception("GHL SMS config error for user %s", hub_user.id)
        return False
    except requests.RequestException as exc:
        logger.error("GHL SMS request error for user %s: %s", hub_user.id, exc)
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
