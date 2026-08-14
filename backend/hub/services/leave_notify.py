"""Leave-only notification copy and hooks."""

from __future__ import annotations

import logging
from datetime import date

from hub.models import HubFormSubmission, HubLeaveApproval, HubUser
from hub.services.leave_request import parse_leave_submission
from hub.services.notify import event_key_for, notify_user

logger = logging.getLogger(__name__)

LEAVE_CALENDAR_PATH = "/admin/calendar"

TYPE_APPROVED = "leave_approved"
TYPE_REJECTED = "leave_rejected"
TYPE_SUBMITTED = "leave_submitted"


def format_leave_dates(start: date | None, end: date | None) -> str:
    if not start:
        return ""
    end = end or start
    if start == end:
        return f"{start.strftime('%b')} {start.day}"
    if start.year == end.year and start.month == end.month:
        return f"{start.strftime('%b')} {start.day}–{end.day}"
    return f"{start.strftime('%b')} {start.day}–{end.strftime('%b')} {end.day}"


def _kind_and_dates(parsed: dict) -> tuple[str, str]:
    kind = (parsed.get("leave_type") or "leave").strip() or "leave"
    dates = format_leave_dates(parsed.get("start"), parsed.get("end"))
    return kind, dates


def _request_phrase(kind: str, dates: str) -> str:
    if dates:
        return f"{kind} request ({dates})"
    return f"{kind} request"


def _payload(submission: HubFormSubmission, parsed: dict) -> dict:
    start = parsed.get("start")
    end = parsed.get("end")
    user = parsed.get("user")
    return {
        "submission_id": str(submission.id),
        "leave_type": parsed.get("leave_type") or "",
        "start": start.isoformat() if start else parsed.get("start_raw") or "",
        "end": end.isoformat() if end else parsed.get("end_raw") or "",
        "employee_id": str(user.id) if user else "",
        "employee_name": parsed.get("display_name") or "",
    }


def notify_leave_submitted(submission: HubFormSubmission) -> None:
    try:
        parsed = parse_leave_submission(submission)
        kind, dates = _kind_and_dates(parsed)
        name = parsed.get("display_name") or "Someone"
        body = f"{name} submitted a {_request_phrase(kind, dates)}."
        payload = _payload(submission, parsed)
        admins = HubUser.objects.filter(
            role=HubUser.Role.ADMIN,
            status=HubUser.Status.ACTIVE,
        )
        for admin in admins:
            notify_user(
                admin,
                type=TYPE_SUBMITTED,
                title="New leave request",
                body=body,
                link=LEAVE_CALENDAR_PATH,
                payload=payload,
                event_key=event_key_for(
                    TYPE_SUBMITTED, submission.id, admin.id
                ),
            )
    except Exception:
        logger.exception(
            "Leave submitted notify failed for submission %s",
            getattr(submission, "id", None),
        )


def notify_leave_decision(approval: HubLeaveApproval, previous_status: str) -> None:
    try:
        new_status = approval.status
        if previous_status == new_status:
            return
        if new_status == HubLeaveApproval.Status.APPROVED:
            ntype = TYPE_APPROVED
            verb = "approved"
            title = "Leave approved"
        elif new_status == HubLeaveApproval.Status.REJECTED:
            ntype = TYPE_REJECTED
            verb = "rejected"
            title = "Leave rejected"
        else:
            return

        parsed = parse_leave_submission(approval.submission)
        employee = parsed.get("user")
        if not employee:
            logger.warning(
                "Leave %s %s but no HubUser matched; skip notify",
                approval.submission_id,
                new_status,
            )
            return

        kind, dates = _kind_and_dates(parsed)
        body = f"Your {_request_phrase(kind, dates)} was {verb}."
        notify_user(
            employee,
            type=ntype,
            title=title,
            body=body,
            link=LEAVE_CALENDAR_PATH,
            payload=_payload(approval.submission, parsed),
            event_key=event_key_for(
                ntype, approval.submission_id, previous_status, new_status
            ),
        )
    except Exception:
        logger.exception(
            "Leave decision notify failed for submission %s",
            getattr(approval, "submission_id", None),
        )
