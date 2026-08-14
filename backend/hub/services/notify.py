"""Persist a notification and push it over WebSocket. Never raise to callers."""

from __future__ import annotations

import logging
import uuid

from asgiref.sync import async_to_sync
from django.db import IntegrityError

from hub.models import HubNotification, HubUser

logger = logging.getLogger(__name__)


def hub_user_group(user_id) -> str:
    return f"hub_user_{user_id}"


def serialize_notification(n: HubNotification) -> dict:
    return {
        "id": str(n.id),
        "type": n.type,
        "title": n.title,
        "body": n.body,
        "link": n.link or "",
        "payload": n.payload or {},
        "readAt": n.read_at.isoformat() if n.read_at else None,
        "createdAt": n.created_at.isoformat() if n.created_at else None,
    }


def _push_ws(notification: HubNotification) -> None:
    from channels.layers import get_channel_layer

    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)(
        hub_user_group(notification.recipient_id),
        {
            "type": "notification.created",
            "notification": serialize_notification(notification),
        },
    )


def notify_user(
    recipient: HubUser,
    *,
    type: str,
    title: str,
    body: str,
    link: str = "",
    payload: dict | None = None,
    event_key: str | None = None,
) -> HubNotification | None:
    """Create a row, then push. Logs and returns None on failure."""
    try:
        defaults = {
            "type": type,
            "title": title,
            "body": body,
            "link": link or "",
            "payload": payload or {},
        }
        if event_key:
            try:
                obj, created = HubNotification.objects.get_or_create(
                    event_key=event_key,
                    defaults={**defaults, "recipient": recipient},
                )
            except IntegrityError:
                obj = HubNotification.objects.filter(event_key=event_key).first()
                created = False
            if not created:
                return obj
        else:
            obj = HubNotification.objects.create(
                recipient=recipient,
                event_key=None,
                **defaults,
            )
    except Exception:
        logger.exception(
            "Failed to persist notification type=%s recipient=%s",
            type,
            getattr(recipient, "id", None),
        )
        return None

    try:
        _push_ws(obj)
    except Exception:
        logger.exception(
            "Failed to push notification %s to user %s",
            obj.id,
            obj.recipient_id,
        )
    return obj


def event_key_for(*parts) -> str:
    bits = [str(p) if not isinstance(p, uuid.UUID) else str(p) for p in parts if p is not None]
    return ":".join(bits)[:191]
