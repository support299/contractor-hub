"""Send designated Hub alerts through GHL Conversations email. Never raise."""

from __future__ import annotations

import html
import logging

from django.conf import settings
from django.db import IntegrityError

from hub.models import HubNotificationEmail, HubNotificationEmailLog, HubUser
from hub.services.ghl import send_conversation_email
from hub.services.notify_channels import wants_email

logger = logging.getLogger(__name__)


def public_link(path: str) -> str:
    base = (getattr(settings, "HUB_PUBLIC_URL", "") or "").rstrip("/")
    rel = (path or "").strip()
    if not rel:
        return base
    if rel.startswith("http://") or rel.startswith("https://"):
        return rel
    if not rel.startswith("/"):
        rel = f"/{rel}"
    return f"{base}{rel}" if base else rel


def _html_body(body: str, link: str) -> str:
    safe = html.escape(body or "")
    url = public_link(link)
    extra = ""
    if url:
        extra = (
            f'<p><a href="{html.escape(url, quote=True)}">'
            "Open in Employee Hub</a></p>"
        )
    return f"<p>{safe}</p>{extra}"


def _deliver_email(
    *,
    email: str,
    event_key: str,
    title: str,
    body: str,
    link: str = "",
    name: str = "",
) -> None:
    email = (email or "").strip().lower()
    if not email:
        return
    try:
        log, created = HubNotificationEmailLog.objects.get_or_create(
            event_key=event_key[:191],
            email=email,
        )
    except IntegrityError:
        return
    except Exception:
        logger.exception("Email log failed for %s", email)
        return
    if not created:
        return
    try:
        ok = send_conversation_email(
            email=email,
            subject=title,
            html=_html_body(body, link),
            message=body,
            name=(name or "").strip(),
        )
        if not ok:
            logger.warning(
                "GHL email not sent type event=%s to=%s", event_key, email
            )
            log.delete()
    except Exception:
        logger.exception("GHL email crashed for %s", email)
        try:
            log.delete()
        except Exception:
            pass


def send_designated_notification_emails(
    *,
    event_key: str,
    title: str,
    body: str,
    link: str = "",
) -> None:
    """Email every active designated address. Deduped by event_key + email."""
    if not wants_email():
        return
    try:
        recipients = list(
            HubNotificationEmail.objects.filter(active=True).exclude(email="")
        )
    except Exception:
        logger.exception("Failed to load notification emails")
        return
    if not recipients:
        return

    for row in recipients:
        _deliver_email(
            email=row.email,
            event_key=event_key,
            title=title,
            body=body,
            link=link,
            name=(row.label or "").strip(),
        )


def send_user_notification_email(
    user: HubUser | None,
    *,
    event_key: str,
    title: str,
    body: str,
    link: str = "",
) -> None:
    """Email a Hub user's work address. No-op if missing. Deduped by event_key + email."""
    if user is None or not wants_email():
        return
    email = (user.email or "").strip()
    if not email:
        return
    _deliver_email(
        email=email,
        event_key=event_key,
        title=title,
        body=body,
        link=link,
        name=(user.name or "").strip(),
    )
