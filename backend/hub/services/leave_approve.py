"""Side effects when a leave request is approved: vacation deduct + Jobber task."""

from __future__ import annotations

import logging
from decimal import Decimal

from django.utils import timezone

from hub.models import HubLeaveApproval
from hub.services.jobber_bridge import JobberBridgeError, create_absence_task
from hub.services.leave_request import parse_leave_submission
from hub.services.vacation import ensure_vacation_balance_current, is_vacation_eligible

logger = logging.getLogger(__name__)


def apply_vacation_deduction(approval: HubLeaveApproval, parsed: dict | None = None) -> None:
    if approval.vacation_days_deducted is not None:
        return
    parsed = parsed or parse_leave_submission(approval.submission)
    if parsed.get("leave_type") != "Vacation":
        return
    user = parsed.get("user")
    if not user:
        logger.warning(
            "Leave %s approved as Vacation but no HubUser matched; skip deduction",
            approval.submission_id,
        )
        approval.vacation_days_deducted = Decimal("0")
        approval.save(update_fields=["vacation_days_deducted", "updated_at"])
        return

    ensure_vacation_balance_current(user)
    user.refresh_from_db()
    if not is_vacation_eligible(user.hire_date):
        approval.vacation_days_deducted = Decimal("0")
        approval.save(update_fields=["vacation_days_deducted", "updated_at"])
        logger.info(
            "Leave %s Vacation approve: not eligible, no deduction",
            approval.submission_id,
        )
        return

    days = Decimal(parsed.get("weekday_count") or 0)
    current = Decimal(user.available_vacation_days or 0)
    deducted = min(days, current)
    user.available_vacation_days = current - deducted
    user.save(update_fields=["available_vacation_days", "updated_at"])
    approval.vacation_days_deducted = deducted
    approval.save(update_fields=["vacation_days_deducted", "updated_at"])
    logger.info(
        "Leave %s deducted %s vacation weekday(s) for user %s (remaining %s)",
        approval.submission_id,
        deducted,
        user.id,
        user.available_vacation_days,
    )


def sync_jobber_task(approval: HubLeaveApproval, parsed: dict | None = None) -> None:
    if approval.jobber_task_id:
        return
    parsed = parsed or parse_leave_submission(approval.submission)
    leave_type = parsed.get("leave_type") or "Absent"
    if leave_type not in ("Vacation", "Absent"):
        description = leave_type or "Absent"
    else:
        description = leave_type

    title = f"{parsed.get('display_name') or 'Unknown'} (Absence)"
    start_date = parsed.get("start_raw") or ""
    end_date = parsed.get("end_raw") or start_date
    user = parsed.get("user")
    assignee = (user.jobber_id or "").strip() if user else ""

    if not start_date:
        approval.jobber_sync_error = "Missing start date on leave request; Jobber task not created."
        approval.save(update_fields=["jobber_sync_error", "updated_at"])
        logger.warning("Leave %s Jobber sync skipped: no start date", approval.submission_id)
        return

    try:
        result = create_absence_task(
            title=title,
            description=description,
            start_date=start_date,
            end_date=end_date,
            assignee_jobber_user_id=assignee or None,
            idempotency_key=str(approval.submission_id),
        )
    except JobberBridgeError as exc:
        approval.jobber_sync_error = str(exc)
        approval.save(update_fields=["jobber_sync_error", "updated_at"])
        logger.warning(
            "Leave %s Jobber task create failed: %s",
            approval.submission_id,
            exc,
        )
        return

    approval.jobber_task_id = result["task_id"]
    approval.jobber_task_synced_at = timezone.now()
    approval.jobber_sync_error = ""
    approval.save(
        update_fields=[
            "jobber_task_id",
            "jobber_task_synced_at",
            "jobber_sync_error",
            "updated_at",
        ]
    )
    logger.info(
        "Leave %s Jobber task created id=%s",
        approval.submission_id,
        approval.jobber_task_id,
    )


def on_leave_approved(approval: HubLeaveApproval) -> None:
    parsed = parse_leave_submission(approval.submission)
    apply_vacation_deduction(approval, parsed)
    approval.refresh_from_db()
    sync_jobber_task(approval, parsed)
