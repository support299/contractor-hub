"""Send designated Hub alerts through GHL Conversations SMS. Never raise."""

from __future__ import annotations

import logging

from django.db import IntegrityError

from hub.models import HubNotificationEmail, HubNotificationSmsLog, HubUser
from hub.services.ghl import send_conversation_sms, send_conversation_sms_to_phone
from hub.services.notify_channels import wants_sms
from hub.services.notify_email import public_link

logger = logging.getLogger(__name__)


def _sms_text(body: str, link: str = "", *, append_link: bool = True) -> str:
    text = (body or "").strip()
    if not append_link:
        return text
    url = public_link(link)
    if url:
        return f"{text}\n{url}".strip()
    return text


def _claim(event_key: str, recipient_key: str) -> HubNotificationSmsLog | None:
    key = (recipient_key or "").strip()[:64]
    if not key:
        return None
    try:
        log, created = HubNotificationSmsLog.objects.get_or_create(
            event_key=event_key[:191],
            recipient_key=key,
        )
    except IntegrityError:
        return None
    except Exception:
        logger.exception("SMS log failed for %s", key)
        return None
    if not created:
        return None
    return log


def _drop(log: HubNotificationSmsLog | None) -> None:
    if log is None:
        return
    try:
        log.delete()
    except Exception:
        pass


def send_designated_notification_sms(
    *,
    event_key: str,
    body: str,
    link: str = "",
) -> None:
    """SMS every active designated phone. Deduped by event_key + phone."""
    if not wants_sms():
        return
    try:
        recipients = list(
            HubNotificationEmail.objects.filter(active=True).exclude(phone="")
        )
    except Exception:
        logger.exception("Failed to load notification phones")
        return
    if not recipients:
        return

    text = _sms_text(body, link)
    if not text:
        return

    for row in recipients:
        phone = (row.phone or "").strip()
        log = _claim(event_key, phone)
        if log is None:
            continue
        try:
            ok = send_conversation_sms_to_phone(
                phone,
                text,
                name=(row.label or "").strip(),
                email=(row.email or "").strip(),
            )
            if not ok:
                logger.warning(
                    "GHL SMS not sent type event=%s to=%s", event_key, phone
                )
                _drop(log)
        except Exception:
            logger.exception("GHL SMS crashed for phone %s", phone)
            _drop(log)


def send_user_notification_sms(
    user: HubUser | None,
    *,
    event_key: str,
    body: str,
    link: str = "",
    append_link: bool = True,
) -> None:
    """SMS a Hub user. No-op if missing phone/ghl_id. Deduped by event_key + recipient."""
    if user is None or not wants_sms():
        return
    phone = (user.phone or "").strip()
    if not phone and not (user.ghl_id or "").strip():
        return
    text = _sms_text(body, link, append_link=append_link)
    if not text:
        return
    recipient_key = phone or str(user.id)
    log = _claim(event_key, recipient_key)
    if log is None:
        return
    try:
        ok = send_conversation_sms(user, text)
        if not ok:
            logger.warning(
                "GHL SMS not sent type event=%s user=%s", event_key, user.id
            )
            _drop(log)
    except Exception:
        logger.exception("GHL SMS crashed for user %s", user.id)
        _drop(log)
