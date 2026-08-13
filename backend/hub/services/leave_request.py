"""Parse request-time-off submission answers (same heuristics as CalendarPage detectFields)."""

from __future__ import annotations

import re
import uuid
from datetime import date
from decimal import Decimal

from hub.models import HubForm, HubFormSubmission, HubUser
from hub.services.vacation import (
    count_weekdays,
    eligibility_date,
    preview_vacation_balance,
)


def _fields(form: HubForm) -> dict:
    fields = form.fields or []

    def by_label(pattern, type_name=None):
        rx = re.compile(pattern, re.I)
        for f in fields:
            if not isinstance(f, dict):
                continue
            if type_name and f.get("type") != type_name:
                continue
            if rx.search(f.get("label") or ""):
                return f
        return None

    start_field = by_label(r"start", "date") or next(
        (f for f in fields if isinstance(f, dict) and f.get("type") == "date"), None
    )
    date_fields = [f for f in fields if isinstance(f, dict) and f.get("type") == "date"]
    end_field = by_label(r"end", "date") or (date_fields[1] if len(date_fields) > 1 else None)
    user_field = next(
        (f for f in fields if isinstance(f, dict) and f.get("type") == "users"), None
    ) or by_label(r"name|staff|user")
    type_field = by_label(r"leave\s*type|type", "dropdown") or next(
        (f for f in fields if isinstance(f, dict) and f.get("type") == "dropdown"), None
    )
    return {
        "start": start_field,
        "end": end_field,
        "user": user_field,
        "type": type_field,
    }


def _fid(field) -> str | None:
    if not field or not isinstance(field, dict):
        return None
    return field.get("id")


def _as_str(value) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(str(v) for v in value if v is not None)
    return str(value)


def _as_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    s = str(value).strip()
    return [s] if s else []


def _parse_ymd(raw: str) -> date | None:
    s = (raw or "").strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def normalize_leave_type(raw: str) -> str:
    s = (raw or "").strip()
    low = s.lower()
    if low == "vacation":
        return "Vacation"
    if low in ("absent", "absence"):
        return "Absent"
    return s


def resolve_hub_user(staff_values: list[str]) -> HubUser | None:
    for raw in staff_values:
        token = (raw or "").strip()
        if not token:
            continue
        try:
            uid = uuid.UUID(token)
            user = HubUser.objects.filter(pk=uid).first()
            if user:
                return user
        except ValueError:
            pass
        user = HubUser.objects.filter(name__iexact=token).first()
        if user:
            return user
        user = HubUser.objects.filter(email__iexact=token).first()
        if user:
            return user
    return None


def parse_leave_submission(submission: HubFormSubmission) -> dict:
    form = submission.form
    answers = submission.answers or {}
    detected = _fields(form)
    start_id = _fid(detected["start"])
    end_id = _fid(detected["end"])
    user_id = _fid(detected["user"])
    type_id = _fid(detected["type"])

    start_raw = _as_str(answers.get(start_id)) if start_id else ""
    end_raw = _as_str(answers.get(end_id)) if end_id else start_raw
    staff = _as_list(answers.get(user_id)) if user_id else []
    leave_type_raw = _as_str(answers.get(type_id)) if type_id else ""
    leave_type = normalize_leave_type(leave_type_raw)
    start = _parse_ymd(start_raw)
    end = _parse_ymd(end_raw) or start
    user = resolve_hub_user(staff)
    display_name = (user.name if user else (staff[0] if staff else "")).strip() or "Unknown"
    return {
        "start": start,
        "end": end,
        "start_raw": start.isoformat() if start else start_raw[:10],
        "end_raw": end.isoformat() if end else (end_raw[:10] or start_raw[:10]),
        "staff": staff,
        "user": user,
        "display_name": display_name,
        "leave_type": leave_type,
        "leave_type_raw": leave_type_raw,
        "weekday_count": count_weekdays(start, end) if start and end else 0,
    }


def vacation_summary_for_parsed(parsed: dict, on_date: date | None = None) -> dict:
    leave_type = parsed.get("leave_type") or ""
    weekdays = parsed.get("weekday_count") or 0
    user = parsed.get("user")
    summary = {
        "leave_type": leave_type,
        "weekday_count": weekdays,
        "eligible": None,
        "eligibility_date": None,
        "available_vacation_days": None,
        "employee_name": parsed.get("display_name") or "",
        "warning": None,
    }
    if leave_type != "Vacation":
        return summary
    if not user:
        summary["warning"] = "Could not match this request to a Hub user for vacation balance."
        return summary
    preview = preview_vacation_balance(user, on_date)
    available = preview["available"]
    summary["eligible"] = preview["eligible"]
    summary["eligibility_date"] = (
        preview["eligibility_date"].isoformat() if preview["eligibility_date"] else None
    )
    summary["available_vacation_days"] = str(available)
    if not preview["eligible"]:
        elig = preview["eligibility_date"]
        when = elig.isoformat() if elig else "their 1-year hire anniversary"
        summary["warning"] = (
            f"Not eligible for vacation yet (eligibility date {when}). Approve still allowed."
        )
    elif Decimal(weekdays) > available:
        summary["warning"] = (
            f"This request uses {weekdays} weekdays; "
            f"{parsed.get('display_name')} has {available} vacation day(s) remaining. "
            "Approve still allowed; balance will not go below 0."
        )
    return summary
