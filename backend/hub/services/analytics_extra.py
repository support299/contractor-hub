"""Insights sections built from Hub forms: reviews, complaints, cancellations, work hours.

Form answers are JSON keyed by field id. Each field is located by its production id
first, then by label, so a rebuilt form still maps as long as the label matches.
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from hub.models import (
    GhlGoogleReview,
    HubForm,
    HubFormSubmission,
    HubUser,
    HubVisit,
    HubWorkHours,
    PendingLockIn,
)
from hub.services.analytics import _day_bounds, _dec, _iso

OVERTIME_THRESHOLD_HOURS = Decimal("40")

# Review forms: English and French variants share field ids.
RATING_ONLY_SLUGS = ("how-are-we-doing", "comment-tu-nous-trouve")
DETAILED_REVIEW_SLUGS = ("review-your-recent-experience", "evaluez-votre-experience")
COMPLAINT_SLUG = "new-complaint"
CANCELLATION_SLUG = "service-cancellation-form"

_EMAIL = re.compile(r"e-?mail|courriel", re.I)
_VISIT_DATE = re.compile(r"visit date|date of (the )?(visit|service)|date de (la )?visite", re.I)
_STATUS = re.compile(r"^\s*status\s*$", re.I)
_RESOLVED_DATE = re.compile(r"resolved\s*date|date resolved|resolution date", re.I)


class _Form:
    """Answer reader for one form definition."""

    def __init__(self, form: HubForm):
        self.fields = [f for f in (form.fields or []) if isinstance(f, dict)]
        self.ids = {f.get("id") for f in self.fields}

    def fid(self, field_id: str | None, label: re.Pattern | None = None) -> str | None:
        if field_id and field_id in self.ids:
            return field_id
        if label is not None:
            for f in self.fields:
                if label.search(f.get("label") or ""):
                    return f.get("id")
        # Field removed from the form later: its old answers are still keyed by id.
        return field_id

    def raw(self, answers: dict, field_id: str | None, label: re.Pattern | None = None):
        fid = self.fid(field_id, label)
        return answers.get(fid) if fid else None

    def text(self, answers: dict, field_id: str | None, label: re.Pattern | None = None) -> str:
        return _text(self.raw(answers, field_id, label))

    def date(self, answers: dict, field_id: str | None, label: re.Pattern | None = None) -> str | None:
        return _iso_date(self.raw(answers, field_id, label))


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(str(v).strip() for v in value if str(v).strip())
    return str(value).strip()


def _list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    s = str(value).strip()
    return [s] if s else []


def _iso_date(value) -> str | None:
    s = _text(value)[:10]
    if not s:
        return None
    try:
        return date.fromisoformat(s).isoformat()
    except ValueError:
        return None


def _int(value) -> int | None:
    s = _text(value)
    if not s:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


class _Staff:
    """Resolve answer tokens (hub user id, name or email) with one query."""

    def __init__(self):
        self.by_id: dict[str, HubUser] = {}
        self.by_name: dict[str, HubUser] = {}
        self.by_email: dict[str, HubUser] = {}
        for u in HubUser.objects.all():
            self.by_id[str(u.id)] = u
            if u.name:
                self.by_name.setdefault(u.name.strip().lower(), u)
            if u.email:
                self.by_email.setdefault(u.email.strip().lower(), u)

    def resolve(self, tokens) -> list[dict]:
        out, seen = [], set()
        for raw in _list(tokens):
            key = raw.lower()
            user = self.by_id.get(raw) or self.by_name.get(key) or self.by_email.get(key)
            if user is None:
                out.append({"id": None, "name": raw, "jobber_user_id": None})
                continue
            if str(user.id) in seen:
                continue
            seen.add(str(user.id))
            out.append(_staff_ref(user))
        return out


def _staff_ref(user: HubUser) -> dict:
    return {
        "id": str(user.id),
        "name": user.name,
        "jobber_user_id": user.jobber_id or None,
    }


class _Clients:
    """Best-effort client name → Jobber client id (only when the name is unambiguous)."""

    def __init__(self):
        found: dict[str, set[str]] = defaultdict(set)
        for name, cid in HubVisit.objects.exclude(client_jobber_id="").values_list(
            "client_name", "client_jobber_id"
        ):
            if name:
                found[name.strip().lower()].add(cid)
        for name, cid in PendingLockIn.objects.exclude(client_jobber_id="").values_list(
            "client_name", "client_jobber_id"
        ):
            if name:
                found[name.strip().lower()].add(cid)
        self.unique = {n: next(iter(ids)) for n, ids in found.items() if len(ids) == 1}

    def jobber_id(self, name: str) -> str | None:
        return self.unique.get((name or "").strip().lower())


def _submissions(slugs, start_dt, end_dt):
    qs = HubFormSubmission.objects.select_related("form").filter(form__slug__in=slugs)
    if start_dt:
        qs = qs.filter(created_at__gte=start_dt)
    if end_dt:
        qs = qs.filter(created_at__lte=end_dt)
    return qs.order_by("-created_at")


def _count_by(records: list[dict], key: str) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for r in records:
        out[str(r.get(key) or "Unspecified")] += 1
    return dict(out)


def build_reviews_section(from_date: date | None, to_date: date | None) -> dict:
    start_dt, end_dt = _day_bounds(from_date, to_date)
    staff, clients = _Staff(), _Clients()
    records: list[dict] = []

    for sub in _submissions(RATING_ONLY_SLUGS + DETAILED_REVIEW_SLUGS, start_dt, end_dt):
        form, a = _Form(sub.form), sub.answers or {}
        detailed = sub.form.slug in DETAILED_REVIEW_SLUGS
        name = form.text(a, "f_ff06eyjn" if detailed else "f_q0oxrx8g")
        comments = (
            [form.text(a, "f_42oed41g"), form.text(a, "f_0cctyrk8")]
            if detailed
            else [form.text(a, "f_t4yt3em7")]
        )
        records.append(
            {
                "id": str(sub.id),
                "source": "review_your_recent_experience" if detailed else "how_are_we_doing",
                "form_slug": sub.form.slug,
                "submitted_at": _iso(sub.created_at),
                "client_name": name,
                "client_email": form.text(a, None, _EMAIL) or None,
                "client_jobber_id": clients.jobber_id(name),
                "rating": _int(form.raw(a, "f_s7corlm2" if detailed else "f_xtxrrtvv")),
                "recommend_rating": _int(form.raw(a, "f_wrkv1t9b")) if detailed else None,
                "rebook_rating": _int(form.raw(a, "f_en17opwc")) if detailed else None,
                "comment": "\n\n".join(c for c in comments if c),
                "improvement_area": form.text(a, "f_g3ipa933") if detailed else "",
                "service_area": form.text(a, "f_8jmgesio") if detailed else "",
                "visit_date": form.date(a, None, _VISIT_DATE),
                "cleaners": staff.resolve(
                    form.raw(a, "f_04r83638" if detailed else "f_1ypy9afk")
                ),
            }
        )

    google = GhlGoogleReview.objects.filter(deleted=False).prefetch_related("cleaners")
    if start_dt:
        google = google.filter(date_added__gte=start_dt)
    if end_dt:
        google = google.filter(date_added__lte=end_dt)
    for g in google:
        records.append(
            {
                "id": f"google-{g.ghl_id}",
                "source": "google",
                "form_slug": None,
                "submitted_at": _iso(g.date_added),
                "client_name": g.reviewer_name,
                "client_email": None,
                "client_jobber_id": clients.jobber_id(g.reviewer_name),
                "rating": g.star_rating or None,
                "recommend_rating": None,
                "rebook_rating": None,
                "comment": g.comment,
                "improvement_area": "",
                "service_area": "",
                "visit_date": None,
                "cleaners": [_staff_ref(u) for u in g.cleaners.all()],
            }
        )

    records.sort(key=lambda r: r["submitted_at"] or "", reverse=True)
    rated = [r["rating"] for r in records if r["rating"]]
    return {
        "available": True,
        "summary": {
            "total": len(records),
            "average_rating": f"{sum(rated) / len(rated):.2f}" if rated else None,
            "by_source": _count_by(records, "source"),
        },
        "records": records,
    }


def build_complaints_section(from_date: date | None, to_date: date | None) -> dict:
    start_dt, end_dt = _day_bounds(from_date, to_date)
    staff, clients = _Staff(), _Clients()
    records: list[dict] = []

    for sub in _submissions((COMPLAINT_SLUG,), start_dt, end_dt):
        form, a = _Form(sub.form), sub.answers or {}
        name = form.text(a, "f_co7nnoro")
        resolved_date = form.date(a, None, _RESOLVED_DATE)
        status = form.text(a, None, _STATUS).lower().replace(" ", "_")
        if not status:
            status = "resolved" if resolved_date else "open"
        records.append(
            {
                "id": str(sub.id),
                "submitted_at": _iso(sub.created_at),
                "client_name": name,
                "client_email": form.text(a, None, _EMAIL) or None,
                "client_jobber_id": clients.jobber_id(name),
                "incident_date": form.date(a, "f_ucnhpg8i"),
                "team": staff.resolve(form.raw(a, "f_bd42zhds")),
                "responsible": staff.resolve(form.raw(a, "f_3cqe7bnp")),
                "type": form.text(a, "f_z1mp4e8g"),
                "what_happened": form.text(a, "f_q82gzpdl"),
                "how_fixed": form.text(a, "f_9ehshl27"),
                "status": status,
                "resolved_date": resolved_date,
            }
        )

    return {
        "available": True,
        "summary": {
            "total": len(records),
            "by_status": _count_by(records, "status"),
            "by_type": _count_by(records, "type"),
        },
        "records": records,
    }


# Conditional sub-reason fields on the cancellation form, keyed by their trigger reason.
_CANCELLATION_SUB_REASON_FIELDS = {
    "not_satisfied": "f_t5ialee1",
    "financial": "f_fazmz5r7",
    "scheduling_conflict": "f_02nxvf9i",
    "found_cheaper_service": "f_1bs9cybz",
    "temporary_pause": "f_2s9gdfyk",
}


def build_cancellations_section(from_date: date | None, to_date: date | None) -> dict:
    start_dt, end_dt = _day_bounds(from_date, to_date)
    clients = _Clients()
    records: list[dict] = []

    for sub in _submissions((CANCELLATION_SLUG,), start_dt, end_dt):
        form, a = _Form(sub.form), sub.answers or {}
        name = form.text(a, "f_on1q7uad")
        by_group = {
            group: _list(form.raw(a, fid))
            for group, fid in _CANCELLATION_SUB_REASON_FIELDS.items()
            if _list(form.raw(a, fid))
        }
        records.append(
            {
                "id": str(sub.id),
                "submitted_at": _iso(sub.created_at),
                "client_name": name,
                "client_email": form.text(a, None, _EMAIL) or None,
                "client_jobber_id": clients.jobber_id(name),
                "frequency": form.text(a, "f_kw8cgftj"),
                "plan_type": form.text(a, "f_t0zdui9y"),
                "reason": form.text(a, "f_3vqldwsx"),
                "sub_reasons": [s for subs in by_group.values() for s in subs],
                "sub_reasons_by_group": by_group,
                "comments": form.text(a, "f_c2b9mrmk"),
            }
        )

    return {
        "available": True,
        "summary": {
            "total": len(records),
            "by_reason": _count_by(records, "reason"),
            "by_frequency": _count_by(records, "frequency"),
        },
        "records": records,
    }


def _hours(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.01")), "f")


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def build_work_hours_section(from_date: date | None, to_date: date | None) -> dict:
    """One record per employee per day.

    hours_worked is regular + drive time. Overtime is whatever pushes an employee's
    ISO week (Mon–Sun) past 40 hours, attributed to the day it was crossed. Weeks are
    read whole, so a `from`/`to` that cuts a week still gets the right overtime.
    """
    qs = HubWorkHours.objects.select_related("employee")
    if from_date:
        qs = qs.filter(work_date__gte=_week_start(from_date))
    if to_date:
        qs = qs.filter(work_date__lte=_week_start(to_date) + timedelta(days=6))

    cumulative: dict[tuple, Decimal] = defaultdict(Decimal)
    records: list[dict] = []
    for row in qs.order_by("employee_id", "work_date"):
        total = (row.regular_hours or Decimal("0")) + (row.drive_time_hours or Decimal("0"))
        key = (row.employee_id, _week_start(row.work_date))
        before = cumulative[key]
        cumulative[key] = before + total
        overtime = max(Decimal("0"), cumulative[key] - OVERTIME_THRESHOLD_HOURS) - max(
            Decimal("0"), before - OVERTIME_THRESHOLD_HOURS
        )
        if (from_date and row.work_date < from_date) or (to_date and row.work_date > to_date):
            continue
        records.append(
            {
                "id": str(row.id),
                "date": _iso(row.work_date),
                "employee_id": str(row.employee_id),
                "employee_name": row.employee.name,
                "jobber_user_id": row.employee.jobber_id or None,
                "hours_worked": _hours(total),
                "regular_hours": _hours(row.regular_hours),
                "drive_time_hours": _hours(row.drive_time_hours),
                "overtime_hours": _hours(overtime),
                "source": row.source,
            }
        )

    def _sum(key: str) -> Decimal:
        return sum((Decimal(r[key]) for r in records), Decimal("0"))

    records.sort(key=lambda r: (r["date"], r["employee_name"]), reverse=True)
    return {
        "available": True,
        "overtime_rule": f"Hours over {OVERTIME_THRESHOLD_HOURS} per ISO week (Mon–Sun), regular + drive time.",
        "summary": {
            "records": len(records),
            "hours_worked": _hours(_sum("hours_worked")),
            "drive_time_hours": _hours(_sum("drive_time_hours")),
            "overtime_hours": _hours(_sum("overtime_hours")),
        },
        "records": records,
    }


def build_extra_sections(from_date: date | None, to_date: date | None) -> dict[str, Any]:
    return {
        "reviews": build_reviews_section(from_date, to_date),
        "complaints": build_complaints_section(from_date, to_date),
        "service_cancellations": build_cancellations_section(from_date, to_date),
        "work_hours": build_work_hours_section(from_date, to_date),
    }
