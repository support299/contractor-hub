"""In-app + email when a client feedback form names Hub staff."""

from __future__ import annotations

import logging

from hub.models import HubForm, HubFormSubmission, HubUser
from hub.services.notify import event_key_for, notify_user
from hub.services.notify_email import send_user_notification_email
from hub.services.tip_confirm import _as_list, resolve_hub_users

logger = logging.getLogger(__name__)

TYPE_FEEDBACK = "client_feedback"
DASHBOARD_PATH = "/admin/dashboard"

FEEDBACK_SLUGS = frozenset(
    {
        "review-your-recent-experience",
        "how-are-we-doing",
        "evaluez-votre-experience",
        "comment-tu-nous-trouve",
    }
)

_SKIP_ROLES = frozenset(
    {
        HubUser.Role.ADMIN,
        HubUser.Role.DISPLAY,
    }
)


def is_feedback_form(form: HubForm | None) -> bool:
    if form is None:
        return False
    return (form.slug or "").strip().lower() in FEEDBACK_SLUGS


def staff_from_feedback(submission: HubFormSubmission) -> list[HubUser]:
    form = submission.form
    answers = submission.answers or {}
    tokens: list[str] = []
    for field in form.fields or []:
        if not isinstance(field, dict) or field.get("type") != "users":
            continue
        fid = field.get("id")
        if not fid:
            continue
        tokens.extend(_as_list(answers.get(fid)))
    users = resolve_hub_users(tokens)
    return [u for u in users if u.role not in _SKIP_ROLES]


def maybe_notify_feedback(submission: HubFormSubmission) -> None:
    try:
        form = getattr(submission, "form", None)
        if form is None:
            submission = HubFormSubmission.objects.select_related("form").get(
                pk=submission.pk
            )
            form = submission.form
        if not is_feedback_form(form):
            return
        staff = staff_from_feedback(submission)
        if not staff:
            return
        title = "New client feedback"
        body = "A client submitted feedback that includes you."
        for user in staff:
            event_key = event_key_for(TYPE_FEEDBACK, submission.id, user.id)
            notify_user(
                user,
                type=TYPE_FEEDBACK,
                title=title,
                body=body,
                link=DASHBOARD_PATH,
                payload={
                    "submission_id": str(submission.id),
                    "form_slug": form.slug or "",
                    "technician_id": str(user.id),
                },
                event_key=event_key,
            )
            send_user_notification_email(
                user,
                event_key=event_key_for(TYPE_FEEDBACK, submission.id, user.id, "email"),
                title=title,
                body=body,
                link=DASHBOARD_PATH,
            )
    except Exception:
        logger.exception(
            "Feedback notify failed for submission %s",
            getattr(submission, "id", None),
        )
