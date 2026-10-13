"""In-app + email + SMS when an admin tags a cleaner on a 5-star Google review."""

from __future__ import annotations

import logging
from typing import Iterable

from hub.models import GhlGoogleReview, HubUser
from hub.services.notify import event_key_for, notify_user
from hub.services.notify_email import send_user_notification_email
from hub.services.notify_sms import send_user_notification_sms

logger = logging.getLogger(__name__)

TYPE_GOOGLE_REVIEW = "google_review_five_star"
DASHBOARD_PATH = "/admin/dashboard"
FIVE_STAR = 5


def is_five_star(review: GhlGoogleReview) -> bool:
    """Same rule the scoreboard uses for its 5-star count."""
    return int(review.star_rating or 0) == FIVE_STAR


def notify_cleaners_tagged(review: GhlGoogleReview, cleaners: Iterable[HubUser]) -> None:
    """
    Notify newly tagged cleaners about a 5-star review. Never raises.

    Deduped per (review, cleaner), so removing and re-adding someone does not
    notify them twice.
    """
    try:
        if not is_five_star(review) or review.deleted:
            return
        reviewer = (review.reviewer_name or "").strip() or "A client"
        title = "New 5-star Google review!"
        body = f"{reviewer} left a 5-star Google review that mentions you. Great work!"
        for user in cleaners:
            if user.role == HubUser.Role.DISPLAY:
                continue
            link = f"{DASHBOARD_PATH}?user={user.id}"
            notify_user(
                user,
                type=TYPE_GOOGLE_REVIEW,
                title=title,
                body=body,
                link=link,
                payload={
                    "review_id": review.ghl_id,
                    "reviewer_name": review.reviewer_name or "",
                    "star_rating": review.star_rating,
                    "technician_id": str(user.id),
                },
                event_key=event_key_for(TYPE_GOOGLE_REVIEW, review.ghl_id, user.id),
            )
            send_user_notification_email(
                user,
                event_key=event_key_for(TYPE_GOOGLE_REVIEW, review.ghl_id, user.id, "email"),
                title=title,
                body=body,
                link=link,
            )
            send_user_notification_sms(
                user,
                event_key=event_key_for(TYPE_GOOGLE_REVIEW, review.ghl_id, user.id, "sms"),
                body=body,
                link=link,
            )
    except Exception:
        logger.exception(
            "Google review notify failed for review %s",
            getattr(review, "ghl_id", None),
        )
