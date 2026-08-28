"""Aggregate hub data into a dashboard-ready analytics payload."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timezone as dt_timezone
from decimal import Decimal
from typing import Any

from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from hub.models import (
    HubAlert,
    HubDocument,
    HubForm,
    HubFormSubmission,
    HubLeaveApproval,
    HubNotification,
    HubTrainingMaterial,
    HubUser,
    HubVisit,
    LockInBonus,
    PendingLockIn,
)
from hub.services.leave_request import parse_leave_submission


def _dec(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return format(value, "f")
    return str(value)


def _iso(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if timezone.is_naive(value):
            value = timezone.make_aware(value, dt_timezone.utc)
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _parse_date(raw: str | None) -> date | None:
    if not raw:
        return None
    try:
        return date.fromisoformat(str(raw).strip()[:10])
    except ValueError:
        return None


def _day_bounds(from_date: date | None, to_date: date | None):
    start_dt = None
    end_dt = None
    if from_date:
        start_dt = timezone.make_aware(datetime.combine(from_date, time.min))
    if to_date:
        end_dt = timezone.make_aware(datetime.combine(to_date, time.max))
    return start_dt, end_dt


def _unavailable(domain: str, reason: str) -> dict:
    return {
        "available": False,
        "domain": domain,
        "reason": reason,
        "records": [],
        "summary": {},
    }


def _employee_snapshot(user: HubUser) -> dict:
    return {
        "id": str(user.id),
        "name": user.name,
        "email": user.email or "",
        "phone": user.phone or "",
        "role": user.role,
        "status": user.status,
        "position": user.position or "",
        "sectors": user.sectors or [],
        "work_days": _dec(user.work_days),
        "hire_date": _iso(user.hire_date),
        "available_vacation_days": _dec(user.available_vacation_days),
        "vacation_balance_reset_on": _iso(user.vacation_balance_reset_on),
        "jobber_id": user.jobber_id or "",
        "ghl_id": user.ghl_id or "",
        "rates": {
            "regular": _dec(user.regular_rate),
            "drive_time": _dec(user.drive_time_rate),
            "fc": _dec(user.fc_rate),
            "tr": _dec(user.tr_rate),
            "supplies_deduction": _dec(user.supplies_deduction),
        },
        "created_at": _iso(user.created_at),
        "updated_at": _iso(user.updated_at),
    }


def build_employees_section() -> dict:
    users = list(HubUser.objects.all().order_by("name"))
    by_role: dict[str, int] = defaultdict(int)
    by_status: dict[str, int] = defaultdict(int)
    by_position: dict[str, int] = defaultdict(int)
    vacation_total = Decimal("0")
    with_hire = 0
    for u in users:
        by_role[u.role] += 1
        by_status[u.status] += 1
        pos = (u.position or "").strip() or "Unspecified"
        by_position[pos] += 1
        vacation_total += u.available_vacation_days or Decimal("0")
        if u.hire_date:
            with_hire += 1
    active = by_status.get(HubUser.Status.ACTIVE, 0)
    return {
        "available": True,
        "summary": {
            "total": len(users),
            "active": active,
            "inactive": by_status.get(HubUser.Status.INACTIVE, 0),
            "by_role": dict(by_role),
            "by_status": dict(by_status),
            "by_position": dict(by_position),
            "total_vacation_days_available": _dec(vacation_total),
            "avg_vacation_days_available": _dec(
                (vacation_total / len(users)) if users else Decimal("0")
            ),
            "with_hire_date": with_hire,
        },
        "employees": [_employee_snapshot(u) for u in users],
    }


def build_leave_section(from_date: date | None, to_date: date | None) -> dict:
    qs = HubLeaveApproval.objects.select_related("submission", "submission__form").all()
    start_dt, end_dt = _day_bounds(from_date, to_date)
    if start_dt:
        qs = qs.filter(created_at__gte=start_dt)
    if end_dt:
        qs = qs.filter(created_at__lte=end_dt)

    by_status: dict[str, int] = defaultdict(int)
    by_type: dict[str, int] = defaultdict(int)
    vacation_days_deducted = Decimal("0")
    absences: list[dict] = []
    vacations: list[dict] = []
    late_proxy: list[dict] = []
    all_requests: list[dict] = []
    by_employee: dict[str, dict] = {}

    for approval in qs:
        parsed = parse_leave_submission(approval.submission)
        leave_type = parsed.get("leave_type") or "Unknown"
        by_status[approval.status] += 1
        by_type[leave_type] += 1
        deducted = approval.vacation_days_deducted
        if deducted:
            vacation_days_deducted += deducted

        user = parsed.get("user")
        emp_id = str(user.id) if user else None
        emp_name = parsed.get("display_name") or ""

        record = {
            "submission_id": str(approval.submission_id),
            "status": approval.status,
            "leave_type": leave_type,
            "leave_type_raw": parsed.get("leave_type_raw") or "",
            "employee_id": emp_id,
            "employee_name": emp_name,
            "start_date": _iso(parsed.get("start")),
            "end_date": _iso(parsed.get("end")),
            "weekday_count": parsed.get("weekday_count") or 0,
            "vacation_days_deducted": _dec(deducted),
            "jobber_task_id": approval.jobber_task_id or "",
            "jobber_sync_error": approval.jobber_sync_error or "",
            "decided_at": _iso(approval.decided_at),
            "created_at": _iso(approval.created_at),
            "updated_at": _iso(approval.updated_at),
        }
        all_requests.append(record)

        if emp_id:
            bucket = by_employee.setdefault(
                emp_id,
                {
                    "employee_id": emp_id,
                    "employee_name": emp_name,
                    "total_requests": 0,
                    "approved": 0,
                    "pending": 0,
                    "rejected": 0,
                    "vacation_requests": 0,
                    "absence_requests": 0,
                    "vacation_days_deducted": Decimal("0"),
                },
            )
            bucket["total_requests"] += 1
            bucket[approval.status] = bucket.get(approval.status, 0) + 1
            if leave_type == "Vacation":
                bucket["vacation_requests"] += 1
            elif leave_type == "Absent":
                bucket["absence_requests"] += 1
            if deducted:
                bucket["vacation_days_deducted"] += deducted

        low = leave_type.lower()
        if low == "vacation":
            vacations.append(record)
        elif low in ("absent", "absence"):
            absences.append(record)
        elif "late" in low:
            late_proxy.append(record)

    employee_breakdown = []
    for row in by_employee.values():
        row["vacation_days_deducted"] = _dec(row["vacation_days_deducted"])
        employee_breakdown.append(row)

    total = len(all_requests)
    approved = by_status.get(HubLeaveApproval.Status.APPROVED, 0)
    return {
        "available": True,
        "summary": {
            "total_requests": total,
            "by_status": dict(by_status),
            "by_type": dict(by_type),
            "approval_rate": round((approved / total), 4) if total else 0,
            "vacation_request_count": len(vacations),
            "absence_request_count": len(absences),
            "vacation_days_deducted_total": _dec(vacation_days_deducted),
        },
        "vacation": {
            "count": len(vacations),
            "records": vacations,
        },
        "absences": {
            "count": len(absences),
            "records": absences,
        },
        "by_employee": employee_breakdown,
        "all_requests": all_requests,
        # Leave types that mention "late" if configured in forms
        "late_related_leave": {
            "count": len(late_proxy),
            "records": late_proxy,
            "note": (
                "True late-arrival clock data is not stored in this app. "
                "This list only includes leave requests whose type label contains 'late'."
            ),
        },
    }


def build_lock_in_section(from_date: date | None, to_date: date | None) -> dict:
    start_dt, end_dt = _day_bounds(from_date, to_date)

    pending_qs = PendingLockIn.objects.prefetch_related("technicians", "bonuses").all()
    bonus_qs = LockInBonus.objects.select_related("technician", "pending").all()
    visit_qs = HubVisit.objects.prefetch_related("technicians").all()

    if start_dt:
        pending_qs = pending_qs.filter(created_at__gte=start_dt)
        bonus_qs = bonus_qs.filter(created_at__gte=start_dt)
        visit_qs = visit_qs.filter(created_at__gte=start_dt)
    if end_dt:
        pending_qs = pending_qs.filter(created_at__lte=end_dt)
        bonus_qs = bonus_qs.filter(created_at__lte=end_dt)
        visit_qs = visit_qs.filter(created_at__lte=end_dt)

    pending_by_status = dict(
        pending_qs.values("status").annotate(c=Count("id")).values_list("status", "c")
    )
    bonus_by_status = dict(
        bonus_qs.values("status").annotate(c=Count("id")).values_list("status", "c")
    )
    amount_agg = bonus_qs.aggregate(
        total_amount=Coalesce(Sum("amount"), Decimal("0")),
        paid_amount=Coalesce(Sum("amount", filter=Q(bonus_paid=True)), Decimal("0")),
        confirmed_amount=Coalesce(
            Sum(
                "amount",
                filter=Q(status=LockInBonus.Status.CONFIRMED)
                | Q(status=LockInBonus.Status.PAID),
            ),
            Decimal("0"),
        ),
    )

    pending_total = sum(pending_by_status.values()) if pending_by_status else 0
    confirmed_pending = pending_by_status.get(PendingLockIn.Status.CONFIRMED, 0)
    conversion = round(confirmed_pending / pending_total, 4) if pending_total else 0

    bonuses_by_tech: dict[str, dict] = {}
    bonus_records = []
    for b in bonus_qs:
        tech = b.technician
        tid = str(tech.id)
        bucket = bonuses_by_tech.setdefault(
            tid,
            {
                "employee_id": tid,
                "employee_name": tech.name,
                "position": tech.position or "",
                "bonus_count": 0,
                "total_amount": Decimal("0"),
                "paid_amount": Decimal("0"),
                "by_status": defaultdict(int),
            },
        )
        bucket["bonus_count"] += 1
        bucket["total_amount"] += b.amount or Decimal("0")
        if b.bonus_paid:
            bucket["paid_amount"] += b.amount or Decimal("0")
        bucket["by_status"][b.status] += 1
        bonus_records.append(
            {
                "id": str(b.id),
                "status": b.status,
                "bonus_type": b.bonus_type,
                "amount": _dec(b.amount),
                "position_snapshot": b.position_snapshot or "",
                "bonus_confirmed": b.bonus_confirmed,
                "bonus_paid": b.bonus_paid,
                "paid_date": _iso(b.paid_date),
                "confirmed_date": _iso(b.confirmed_date),
                "in_process_date": _iso(b.in_process_date),
                "payroll_reference": b.payroll_reference or "",
                "technician": {
                    "id": tid,
                    "name": tech.name,
                    "email": tech.email or "",
                    "position": tech.position or "",
                },
                "pending": {
                    "id": str(b.pending_id),
                    "quote_id": b.pending.quote_id,
                    "client_name": b.pending.client_name,
                    "client_jobber_id": b.pending.client_jobber_id,
                    "status": b.pending.status,
                    "locked_in": b.pending.locked_in,
                },
                "created_at": _iso(b.created_at),
            }
        )

    tech_breakdown = []
    for row in bonuses_by_tech.values():
        tech_breakdown.append(
            {
                **row,
                "total_amount": _dec(row["total_amount"]),
                "paid_amount": _dec(row["paid_amount"]),
                "by_status": dict(row["by_status"]),
            }
        )

    pending_records = []
    for p in pending_qs:
        pending_records.append(
            {
                "id": str(p.id),
                "quote_id": p.quote_id,
                "client_name": p.client_name,
                "client_jobber_id": p.client_jobber_id,
                "status": p.status,
                "locked_in": p.locked_in,
                "locked_at": _iso(p.locked_at),
                "frequency": p.frequency or "",
                "quote_sent_at": _iso(p.quote_sent_at),
                "quote_approved_at": _iso(p.quote_approved_at),
                "eligibility_expires_at": _iso(p.eligibility_expires_at),
                "expected_first_visit_at": _iso(p.expected_first_visit_at),
                "first_recurring_visit_id": p.first_recurring_visit_id or "",
                "first_recurring_visit_at": _iso(p.first_recurring_visit_at),
                "expired_reason": p.expired_reason or "",
                "technician_ids": [str(t.id) for t in p.technicians.all()],
                "technician_names": [t.name for t in p.technicians.all()],
                "created_at": _iso(p.created_at),
            }
        )

    visit_records = []
    visits_by_tech: dict[str, int] = defaultdict(int)
    for v in visit_qs:
        techs = list(v.technicians.all())
        for t in techs:
            visits_by_tech[str(t.id)] += 1
        visit_records.append(
            {
                "id": str(v.id),
                "jobber_visit_id": v.jobber_visit_id,
                "title": v.title or "",
                "client_name": v.client_name or "",
                "client_jobber_id": v.client_jobber_id or "",
                "job_type": v.job_type or "",
                "start_at": _iso(v.start_at),
                "technician_ids": [str(t.id) for t in techs],
                "technician_names": [t.name for t in techs],
                "created_at": _iso(v.created_at),
            }
        )

    return {
        "available": True,
        "summary": {
            "pending_lock_ins_total": pending_total,
            "pending_by_status": pending_by_status,
            "lock_in_conversion_rate": conversion,
            "bonuses_total": bonus_qs.count(),
            "bonuses_by_status": bonus_by_status,
            "bonus_amount_total": _dec(amount_agg["total_amount"]),
            "bonus_amount_paid": _dec(amount_agg["paid_amount"]),
            "bonus_amount_confirmed_or_paid": _dec(amount_agg["confirmed_amount"]),
            "visits_total": visit_qs.count(),
        },
        "pending_lock_ins": pending_records,
        "bonuses": bonus_records,
        "bonuses_by_employee": tech_breakdown,
        "visits": visit_records,
        "visits_by_employee": [
            {"employee_id": eid, "visit_count": count}
            for eid, count in sorted(visits_by_tech.items(), key=lambda x: -x[1])
        ],
    }


def build_workflows_section(from_date: date | None, to_date: date | None) -> dict:
    start_dt, end_dt = _day_bounds(from_date, to_date)

    forms = list(HubForm.objects.all())
    form_rows = []
    for f in forms:
        sub_qs = f.submissions.all()
        if start_dt:
            sub_qs = sub_qs.filter(created_at__gte=start_dt)
        if end_dt:
            sub_qs = sub_qs.filter(created_at__lte=end_dt)
        form_rows.append(
            {
                "id": str(f.id),
                "name": f.name,
                "slug": f.slug,
                "status": f.status,
                "submission_count": sub_qs.count(),
                "created_at": _iso(f.created_at),
            }
        )

    sub_qs = HubFormSubmission.objects.select_related("form").all()
    if start_dt:
        sub_qs = sub_qs.filter(created_at__gte=start_dt)
    if end_dt:
        sub_qs = sub_qs.filter(created_at__lte=end_dt)

    notif_qs = HubNotification.objects.all()
    if start_dt:
        notif_qs = notif_qs.filter(created_at__gte=start_dt)
    if end_dt:
        notif_qs = notif_qs.filter(created_at__lte=end_dt)
    notif_by_type = dict(
        notif_qs.values("type").annotate(c=Count("id")).values_list("type", "c")
    )
    unread = notif_qs.filter(read_at__isnull=True).count()

    return {
        "available": True,
        "forms": {
            "total": len(forms),
            "active": sum(1 for f in forms if f.status == HubForm.Status.ACTIVE),
            "items": form_rows,
            "submissions_in_range": sub_qs.count(),
        },
        "training": {
            "materials_total": HubTrainingMaterial.objects.count(),
            "note": "Completion / view tracking is not stored; catalog counts only.",
        },
        "documents": {
            "documents_total": HubDocument.objects.count(),
            "note": "Download / view analytics are not stored; catalog counts only.",
        },
        "alerts": {
            "active": HubAlert.objects.filter(active=True).count(),
            "total": HubAlert.objects.count(),
            "items": [
                {
                    "id": str(a.id),
                    "message": a.message,
                    "active": a.active,
                    "sort_order": a.sort_order,
                    "created_at": _iso(a.created_at),
                }
                for a in HubAlert.objects.all()[:50]
            ],
        },
        "notifications": {
            "total_in_range": notif_qs.count(),
            "unread_in_range": unread,
            "by_type": notif_by_type,
        },
    }


def build_computed_kpis(
    employees: dict, leave: dict, lock_in: dict, workflows: dict
) -> dict:
    """KPIs derived from existing hub data (not a separate KPI product)."""
    emp_summary = employees.get("summary") or {}
    leave_summary = leave.get("summary") or {}
    lock_summary = lock_in.get("summary") or {}
    active = emp_summary.get("active") or 0
    absence_count = leave_summary.get("absence_request_count") or 0
    vacation_count = leave_summary.get("vacation_request_count") or 0

    return {
        "available": True,
        "source": "computed_from_hub_data",
        "note": (
            "These KPIs are calculated from employee, leave, and lock-in data. "
            "Custom KPI definitions / ratings modules are not implemented in this app yet."
        ),
        "kpis": {
            "headcount_active": active,
            "headcount_total": emp_summary.get("total") or 0,
            "vacation_balance_pool_days": emp_summary.get("total_vacation_days_available"),
            "leave_requests_total": leave_summary.get("total_requests") or 0,
            "leave_approval_rate": leave_summary.get("approval_rate") or 0,
            "absences_per_active_employee": round(absence_count / active, 4)
            if active
            else 0,
            "vacation_requests_per_active_employee": round(vacation_count / active, 4)
            if active
            else 0,
            "vacation_days_deducted_total": leave_summary.get(
                "vacation_days_deducted_total"
            ),
            "lock_in_conversion_rate": lock_summary.get("lock_in_conversion_rate") or 0,
            "lock_in_bonus_amount_total": lock_summary.get("bonus_amount_total"),
            "lock_in_bonus_amount_paid": lock_summary.get("bonus_amount_paid"),
            "visits_total": lock_summary.get("visits_total") or 0,
            "form_submissions_in_range": (workflows.get("forms") or {}).get(
                "submissions_in_range"
            )
            or 0,
        },
    }


def build_performance_proxy(lock_in: dict, leave: dict) -> dict:
    """Employee performance proxies until a dedicated ratings module exists."""
    by_emp: dict[str, dict] = {}

    for row in lock_in.get("bonuses_by_employee") or []:
        eid = row["employee_id"]
        by_emp[eid] = {
            "employee_id": eid,
            "employee_name": row.get("employee_name") or "",
            "position": row.get("position") or "",
            "lock_in_bonus_count": row.get("bonus_count") or 0,
            "lock_in_bonus_amount_total": row.get("total_amount"),
            "lock_in_bonus_amount_paid": row.get("paid_amount"),
            "visits": 0,
            "leave_requests": 0,
            "absences": 0,
            "vacations": 0,
        }

    for row in lock_in.get("visits_by_employee") or []:
        eid = row["employee_id"]
        bucket = by_emp.setdefault(
            eid,
            {
                "employee_id": eid,
                "employee_name": "",
                "position": "",
                "lock_in_bonus_count": 0,
                "lock_in_bonus_amount_total": "0",
                "lock_in_bonus_amount_paid": "0",
                "visits": 0,
                "leave_requests": 0,
                "absences": 0,
                "vacations": 0,
            },
        )
        bucket["visits"] = row.get("visit_count") or 0

    for row in leave.get("by_employee") or []:
        eid = row["employee_id"]
        bucket = by_emp.setdefault(
            eid,
            {
                "employee_id": eid,
                "employee_name": row.get("employee_name") or "",
                "position": "",
                "lock_in_bonus_count": 0,
                "lock_in_bonus_amount_total": "0",
                "lock_in_bonus_amount_paid": "0",
                "visits": 0,
                "leave_requests": 0,
                "absences": 0,
                "vacations": 0,
            },
        )
        if not bucket["employee_name"]:
            bucket["employee_name"] = row.get("employee_name") or ""
        bucket["leave_requests"] = row.get("total_requests") or 0
        bucket["absences"] = row.get("absence_requests") or 0
        bucket["vacations"] = row.get("vacation_requests") or 0

    return {
        "available": True,
        "source": "proxy_metrics",
        "note": (
            "No dedicated performance / ratings tables exist. "
            "This section combines lock-in bonuses, visits, and leave activity per employee."
        ),
        "employees": list(by_emp.values()),
    }


def build_analytics_payload(
    *,
    from_date: date | None = None,
    to_date: date | None = None,
) -> dict[str, Any]:
    employees = build_employees_section()
    leave = build_leave_section(from_date, to_date)
    lock_in = build_lock_in_section(from_date, to_date)
    workflows = build_workflows_section(from_date, to_date)
    performance = build_performance_proxy(lock_in, leave)
    kpis = build_computed_kpis(employees, leave, lock_in, workflows)

    return {
        "meta": {
            "generated_at": timezone.now().isoformat(),
            "from": _iso(from_date),
            "to": _iso(to_date),
            "source": "contractor-hub",
            "api_version": "1.0",
            "coverage_notes": {
                "employee_attendance": (
                    "Not tracked as clock-in/out. Use leave absences + visits as proxies."
                ),
                "late_arrivals": (
                    "No late-clock model. See leave.late_related_leave if form types include Late."
                ),
                "internal_ratings_feedback": "Not implemented in this app yet.",
                "custom_kpis": "Computed KPIs from existing data; no custom KPI builder yet.",
            },
        },
        "employees": employees,
        "leave": leave,
        "absences": leave.get("absences"),
        "vacation": leave.get("vacation"),
        "attendance": _unavailable(
            "employee_attendance",
            "This app does not store daily attendance / clock-in records. "
            "Dashboard can use leave.absences and lock_in_bonuses.visits as proxies.",
        ),
        "late_arrivals": {
            "available": False,
            "domain": "late_arrivals",
            "reason": "No late-arrival clock data is stored.",
            "proxy_from_leave": leave.get("late_related_leave"),
        },
        "lock_in_bonuses": lock_in,
        "employee_performance": performance,
        "internal_ratings_feedback": _unavailable(
            "internal_ratings_feedback",
            "Ratings / feedback module is not present in this codebase.",
        ),
        "custom_kpis": kpis,
        "internal_workflows": workflows,
    }
