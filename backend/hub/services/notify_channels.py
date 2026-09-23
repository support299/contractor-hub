"""Whether staff/office GHL alerts go out as email, SMS, or both. In-app always."""

from __future__ import annotations

import logging

from hub.models import HubNotifyPrefs

logger = logging.getLogger(__name__)


def get_notify_channel() -> str:
    try:
        channel = HubNotifyPrefs.load().channel
    except Exception:
        logger.exception("Failed to load notify prefs")
        return HubNotifyPrefs.Channel.BOTH
    if channel not in HubNotifyPrefs.Channel.values:
        return HubNotifyPrefs.Channel.BOTH
    return channel


def wants_email() -> bool:
    return get_notify_channel() in (
        HubNotifyPrefs.Channel.EMAIL,
        HubNotifyPrefs.Channel.BOTH,
    )


def wants_sms() -> bool:
    return get_notify_channel() in (
        HubNotifyPrefs.Channel.SMS,
        HubNotifyPrefs.Channel.BOTH,
    )
