"""Lock-in bonus persistence: visits, pending quotes, per-tech bonuses."""

from __future__ import annotations

import calendar
import logging
from datetime import datetime, timedelta, timezone as dt_timezone

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from hub.models import (
    HubUser,
    HubVisit,
    LockInBonus,
    PendingLockIn,
    lock_in_bonus_amount,
)

logger = logging.getLogger(__name__)

ELIGIBILITY_MONTHS = 3


def add_months(dt, months: int):
    if dt is None:
        return None
    month = dt.month - 1 + months
    year = dt.year + month // 12
    month = month % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def parse_ts(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        dt = parse_datetime(str(value))
        if dt is None:
            return None
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, dt_timezone.utc)
    return dt


def users_by_jobber_ids(jobber_ids):
    ids = [str(i).strip() for i in (jobber_ids or []) if str(i).strip()]
    if not ids:
        return []
    found = list(HubUser.objects.filter(jobber_id__in=ids))
    by_id = {u.jobber_id: u for u in found if u.jobber_id}
    missing = [i for i in ids if i not in by_id]
    if missing:
        logger.warning("Lock-in: no HubUser for jobber_id=%s", missing)
    return [by_id[i] for i in ids if i in by_id]


def upsert_visit(payload: dict) -> HubVisit:
    visit_id = str(payload.get("jobber_visit_id") or "").strip()
    if not visit_id:
        raise ValueError("jobber_visit_id is required")

    defaults = {
        "title": str(payload.get("title") or "")[:512],
        "client_jobber_id": str(payload.get("client_id") or payload.get("client_jobber_id") or ""),
        "client_name": str(payload.get("client_name") or "")[:255],
        "jobber_job_id": str(payload.get("job_id") or payload.get("jobber_job_id") or ""),
        "job_type": str(payload.get("job_type") or "")[:64],
        "start_at": parse_ts(payload.get("start_at")),
    }
    visit, _created = HubVisit.objects.update_or_create(
        jobber_visit_id=visit_id, defaults=defaults
    )
    assignees = payload.get("assignee_jobber_ids") or payload.get("technician_jobber_ids") or []
    users = users_by_jobber_ids(assignees)
    visit.technicians.set(users)
    return visit


def _visit_id_overlap(existing_ids, incoming_ids) -> bool:
    a = {str(x) for x in (existing_ids or []) if x}
    b = {str(x) for x in (incoming_ids or []) if x}
    return bool(a and b and a & b)


def create_pending_stage1(payload: dict) -> tuple[PendingLockIn, bool]:
    """
    Create pending + bonuses. Returns (pending, created).
    Duplicate quote_id → existing row, created=False.
    Duplicate original first-clean visits (Rule 1) → existing in-process/confirmed, created=False.
    """
    quote_id = str(payload.get("quote_id") or "").strip()
    if not quote_id:
        raise ValueError("quote_id is required")
    client_id = str(payload.get("client_id") or payload.get("client_jobber_id") or "").strip()
    if not client_id:
        raise ValueError("client_id is required")

    original_visit_ids = [
        str(v) for v in (payload.get("original_visit_ids") or []) if str(v).strip()
    ]

    existing = PendingLockIn.objects.filter(quote_id=quote_id).first()
    if existing:
        return existing, False

    if original_visit_ids:
        candidates = PendingLockIn.objects.filter(client_jobber_id=client_id).exclude(
            status=PendingLockIn.Status.EXPIRED
        )
        for row in candidates:
            if _visit_id_overlap(row.original_visit_ids, original_visit_ids):
                logger.info(
                    "Lock-in Rule 1: quote %s skipped; first-clean visits already used by %s",
                    quote_id,
                    row.quote_id,
                )
                return row, False

    quote_sent_at = parse_ts(payload.get("quote_sent_at")) or timezone.now()
    quote_approved_at = parse_ts(payload.get("quote_approved_at")) or timezone.now()
    expires = add_months(quote_sent_at, ELIGIBILITY_MONTHS)

    tech_ids = payload.get("technician_ids") or []
    jobber_ids = payload.get("technician_jobber_ids") or []
    if tech_ids:
        technicians = list(HubUser.objects.filter(id__in=tech_ids))
    else:
        technicians = users_by_jobber_ids(jobber_ids)

    with transaction.atomic():
        pending = PendingLockIn.objects.create(
            quote_id=quote_id,
            client_jobber_id=client_id,
            client_name=str(payload.get("client_name") or "")[:255],
            recurring_jobber_job_id=str(
                payload.get("job_id")
                or payload.get("recurring_jobber_job_id")
                or ""
            ),
            original_visit_ids=original_visit_ids,
            quote_accepted=bool(payload.get("quote_accepted", True)),
            quote_sent_at=quote_sent_at,
            quote_approved_at=quote_approved_at,
            frequency=str(payload.get("frequency") or "")[:64],
            eligibility_expires_at=expires,
            expected_first_visit_at=parse_ts(payload.get("expected_first_visit_at")),
            status=PendingLockIn.Status.IN_PROCESS,
        )
        pending.technicians.set(technicians)
        now = timezone.now()
        for tech in technicians:
            position, amount = lock_in_bonus_amount(tech.position)
            if amount == 0:
                logger.warning(
                    "Lock-in: unknown/unmapped position %r for user %s; amount=0",
                    tech.position,
                    tech.id,
                )
            LockInBonus.objects.create(
                pending=pending,
                technician=tech,
                status=LockInBonus.Status.IN_PROCESS,
                amount=amount,
                position_snapshot=position or (tech.position or ""),
                in_process_date=now,
            )
    from hub.services.lock_in_notify import notify_lock_in_potential

    notify_lock_in_potential(pending)
    return pending, True


def find_open_pending_for_client(client_id: str, job_id: str | None = None):
    """Make: search by client_id, first unlocked. Prefer matching recurring job_id when set."""
    qs = PendingLockIn.objects.filter(
        client_jobber_id=str(client_id),
        locked_in=False,
        status=PendingLockIn.Status.IN_PROCESS,
    ).order_by("created_at")
    rows = list(qs)
    if not rows:
        return None
    if job_id:
        match = [r for r in rows if r.recurring_jobber_job_id and r.recurring_jobber_job_id == str(job_id)]
        if match:
            return match[0]
    return rows[0]


def eligibility_cutoff(pending: PendingLockIn):
    if pending.eligibility_expires_at:
        return pending.eligibility_expires_at
    base = pending.quote_sent_at or pending.created_at
    return add_months(base, ELIGIBILITY_MONTHS) if base else timezone.now() - timedelta(days=1)


def confirm_pending(pending: PendingLockIn, *, visit_id: str, visit_at) -> PendingLockIn:
    visit_at = parse_ts(visit_at) or timezone.now()
    now = timezone.now()
    newly_confirmed = False
    with transaction.atomic():
        pending = PendingLockIn.objects.select_for_update().get(pk=pending.pk)
        if pending.locked_in or pending.status != PendingLockIn.Status.IN_PROCESS:
            return pending
        pending.locked_in = True
        pending.locked_at = now
        pending.status = PendingLockIn.Status.CONFIRMED
        pending.first_recurring_visit_id = str(visit_id or "")
        pending.first_recurring_visit_at = visit_at
        pending.save(
            update_fields=[
                "locked_in",
                "locked_at",
                "status",
                "first_recurring_visit_id",
                "first_recurring_visit_at",
                "updated_at",
            ]
        )
        pending.bonuses.filter(status=LockInBonus.Status.IN_PROCESS).update(
            status=LockInBonus.Status.CONFIRMED,
            bonus_confirmed=True,
            confirmed_date=now,
        )
        newly_confirmed = True
    if newly_confirmed:
        from hub.services.lock_in_notify import notify_lock_in_confirmed

        notify_lock_in_confirmed(pending)
    return pending


def patch_pending_stage1(pending: PendingLockIn, payload: dict) -> PendingLockIn:
    """Attach recurring job / expected visit after Convert to Job. No extra SMS."""
    if pending.locked_in or pending.status != PendingLockIn.Status.IN_PROCESS:
        return pending
    fields = []
    job_id = str(payload.get("job_id") or payload.get("recurring_jobber_job_id") or "").strip()
    if job_id:
        pending.recurring_jobber_job_id = job_id
        fields.append("recurring_jobber_job_id")
    frequency = payload.get("frequency")
    if frequency is not None and str(frequency).strip():
        pending.frequency = str(frequency).strip()[:64]
        fields.append("frequency")
    if "expected_first_visit_at" in payload:
        pending.expected_first_visit_at = parse_ts(payload.get("expected_first_visit_at"))
        fields.append("expected_first_visit_at")
    if fields:
        pending.save(update_fields=fields + ["updated_at"])
    return pending


def expire_pending(pending: PendingLockIn, reason: str = "Eligibility Period Exceeded") -> PendingLockIn:
    with transaction.atomic():
        pending = PendingLockIn.objects.select_for_update().get(pk=pending.pk)
        if pending.locked_in or pending.status == PendingLockIn.Status.CONFIRMED:
            return pending
        pending.status = PendingLockIn.Status.EXPIRED
        pending.expired_reason = reason[:255]
        pending.save(update_fields=["status", "expired_reason", "updated_at"])
        pending.bonuses.filter(status=LockInBonus.Status.IN_PROCESS).update(
            status=LockInBonus.Status.EXPIRED,
        )
    return pending


def serialize_user(user: HubUser) -> dict:
    return {
        "id": str(user.id),
        "name": user.name,
        "phone": user.phone or "",
        "position": user.position or "",
        "jobber_id": user.jobber_id or "",
        "ghl_id": user.ghl_id or "",
    }


def serialize_visit(visit: HubVisit) -> dict:
    return {
        "id": str(visit.id),
        "jobber_visit_id": visit.jobber_visit_id,
        "title": visit.title,
        "client_id": visit.client_jobber_id,
        "client_name": visit.client_name,
        "job_id": visit.jobber_job_id,
        "job_type": visit.job_type,
        "start_at": visit.start_at.isoformat() if visit.start_at else None,
        "technicians": [serialize_user(u) for u in visit.technicians.all()],
    }


def serialize_bonus(bonus: LockInBonus) -> dict:
    return {
        "id": str(bonus.id),
        "technician": serialize_user(bonus.technician),
        "status": bonus.status,
        "amount": str(bonus.amount),
        "position_snapshot": bonus.position_snapshot,
        "in_process_date": bonus.in_process_date.isoformat() if bonus.in_process_date else None,
        "confirmed_date": bonus.confirmed_date.isoformat() if bonus.confirmed_date else None,
        "bonus_confirmed": bonus.bonus_confirmed,
        "bonus_paid": bonus.bonus_paid,
        "potential_sms_sent": bonus.potential_sms_sent,
        "confirmation_sms_sent": bonus.confirmation_sms_sent,
    }


def serialize_pending(pending: PendingLockIn) -> dict:
    bonuses = list(pending.bonuses.select_related("technician").all())
    return {
        "id": str(pending.id),
        "quote_id": pending.quote_id,
        "client_id": pending.client_jobber_id,
        "client_name": pending.client_name,
        "job_id": pending.recurring_jobber_job_id,
        "original_visit_ids": pending.original_visit_ids or [],
        "quote_accepted": pending.quote_accepted,
        "locked_in": pending.locked_in,
        "locked_at": pending.locked_at.isoformat() if pending.locked_at else None,
        "quote_sent_at": pending.quote_sent_at.isoformat() if pending.quote_sent_at else None,
        "quote_approved_at": pending.quote_approved_at.isoformat() if pending.quote_approved_at else None,
        "frequency": pending.frequency,
        "eligibility_expires_at": (
            pending.eligibility_expires_at.isoformat() if pending.eligibility_expires_at else None
        ),
        "expected_first_visit_at": (
            pending.expected_first_visit_at.isoformat() if pending.expected_first_visit_at else None
        ),
        "first_recurring_visit_id": pending.first_recurring_visit_id,
        "first_recurring_visit_at": (
            pending.first_recurring_visit_at.isoformat() if pending.first_recurring_visit_at else None
        ),
        "status": pending.status,
        "expired_reason": pending.expired_reason,
        "created_at": pending.created_at.isoformat() if pending.created_at else None,
        "technicians": [serialize_user(u) for u in pending.technicians.all()],
        "bonuses": [serialize_bonus(b) for b in bonuses],
    }
