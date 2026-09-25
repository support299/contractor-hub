"""In-app, email, and SMS when a client complaint is logged.

Office (active admins in-app, Settings contacts by email/SMS) always.
Staff named on the form (Team, Responsible) get their own alerts.
"""

from __future__ import annotations

import logging
import re

from hub.models import HubForm, HubFormSubmission, HubUser
from hub.services.notify import event_key_for, notify_user
from hub.services.notify_email import send_user_notification_email
from hub.services.notify_sms import send_user_notification_sms
from hub.services.tip_confirm import _as_list, resolve_hub_users

logger = logging.getLogger(__name__)

TYPE_COMPLAINT = "client_complaint"
DASHBOARD_PATH = "/admin/dashboard"

COMPLAINT_SLUGS = frozenset(
    {
        "new-complaint",
        "complaint-callback",
        "callback",
    }
)

_SKIP_ROLES = frozenset(
    {
        HubUser.Role.ADMIN,
        HubUser.Role.DISPLAY,
    }
)

_CLIENT_LABEL = re.compile(r"\bclient\b", re.I)
_TYPE_LABEL = re.compile(r"type of complaint|complaint type", re.I)
_RESPONSIBLE_LABEL = re.compile(r"responsible", re.I)


def is_complaint_form(form: HubForm | None) -> bool:
    if form is None:
        return False
    slug = (form.slug or "").strip().lower()
    if slug in COMPLAINT_SLUGS:
        return True
    return "complaint" in (form.name or "").strip().lower()


def _text_answer(form: HubForm, answers: dict, label_rx: re.Pattern) -> str:
    for field in form.fields or []:
        if not isinstance(field, dict) or field.get("type") == "users":
            continue
        if not label_rx.search(field.get("label") or ""):
            continue
        fid = field.get("id")
        if not fid:
            continue
        raw = answers.get(fid)
        if isinstance(raw, list):
            text = ", ".join(str(v).strip() for v in raw if str(v).strip())
        else:
            text = str(raw or "").strip()
        if text:
            return text
    return ""


def _users_on_fields(form: HubForm, answers: dict, label_rx: re.Pattern | None) -> list[HubUser]:
    tokens: list[str] = []
    for field in form.fields or []:
        if not isinstance(field, dict) or field.get("type") != "users":
            continue
        if label_rx and not label_rx.search(field.get("label") or ""):
            continue
        fid = field.get("id")
        if not fid:
            continue
        tokens.extend(_as_list(answers.get(fid)))
    return resolve_hub_users(tokens)


def staff_from_complaint(submission: HubFormSubmission) -> list[HubUser]:
    users = _users_on_fields(submission.form, submission.answers or {}, None)
    return [u for u in users if u.role not in _SKIP_ROLES]


def _submissions_path(form: HubForm) -> str:
    return f"/admin/forms/{form.id}/submissions"


def _office_body(client: str, kind: str, responsible: list[HubUser]) -> str:
    if client and kind:
        body = f"{client}: {kind}."
    elif client:
        body = f"A client complaint was submitted for {client}."
    elif kind:
        body = f"A client complaint was submitted ({kind})."
    else:
        body = "A client complaint was submitted."
    names = ", ".join((u.name or "").strip() for u in responsible if (u.name or "").strip())
    if names:
        body = f"{body} Responsible: {names}."
    return body


def _staff_body(client: str, kind: str) -> str:
    if client and kind:
        return f"A client complaint includes you: {client} — {kind}."
    if client:
        return f"A client complaint for {client} includes you."
    if kind:
        return f"A client complaint includes you ({kind})."
    return "A client complaint includes you."


def _notify_office(submission: HubFormSubmission, form: HubForm, body: str, payload: dict) -> None:
    from hub.services.notify_email import send_designated_notification_emails
    from hub.services.notify_sms import send_designated_notification_sms

    link = _submissions_path(form)
    title = "New client complaint"
    admins = HubUser.objects.filter(
        role=HubUser.Role.ADMIN,
        status=HubUser.Status.ACTIVE,
    )
    for admin in admins:
        notify_user(
            admin,
            type=TYPE_COMPLAINT,
            title=title,
            body=body,
            link=link,
            payload=payload,
            event_key=event_key_for(TYPE_COMPLAINT, submission.id, admin.id),
        )
    send_designated_notification_emails(
        event_key=event_key_for(TYPE_COMPLAINT, submission.id, "email"),
        title=title,
        body=body,
        link=link,
    )
    send_designated_notification_sms(
        event_key=event_key_for(TYPE_COMPLAINT, submission.id, "sms"),
        body=body,
        link=link,
    )


def _notify_staff(
    submission: HubFormSubmission,
    form: HubForm,
    staff: list[HubUser],
    body: str,
    payload: dict,
) -> None:
    title = "Client complaint"
    for user in staff:
        link = f"{DASHBOARD_PATH}?user={user.id}"
        notify_user(
            user,
            type=TYPE_COMPLAINT,
            title=title,
            body=body,
            link=link,
            payload={**payload, "technician_id": str(user.id)},
            event_key=event_key_for(TYPE_COMPLAINT, submission.id, user.id),
        )
        send_user_notification_email(
            user,
            event_key=event_key_for(TYPE_COMPLAINT, submission.id, user.id, "email"),
            title=title,
            body=body,
            link=link,
        )
        send_user_notification_sms(
            user,
            event_key=event_key_for(TYPE_COMPLAINT, submission.id, user.id, "sms"),
            body=body,
            link=link,
        )


def maybe_notify_complaint(submission: HubFormSubmission) -> None:
    try:
        form = getattr(submission, "form", None)
        if form is None:
            submission = HubFormSubmission.objects.select_related("form").get(
                pk=submission.pk
            )
            form = submission.form
        if not is_complaint_form(form):
            return
        answers = submission.answers or {}
        client = _text_answer(form, answers, _CLIENT_LABEL)
        kind = _text_answer(form, answers, _TYPE_LABEL)
        responsible = _users_on_fields(form, answers, _RESPONSIBLE_LABEL)
        payload = {
            "submission_id": str(submission.id),
            "form_slug": form.slug or "",
            "client_name": client,
            "complaint_type": kind,
        }
        _notify_office(
            submission,
            form,
            _office_body(client, kind, responsible),
            payload,
        )
        staff = staff_from_complaint(submission)
        if staff:
            _notify_staff(submission, form, staff, _staff_body(client, kind), payload)
    except Exception:
        logger.exception(
            "Complaint notify failed for submission %s",
            getattr(submission, "id", None),
        )
