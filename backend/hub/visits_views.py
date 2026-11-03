"""Internal endpoint service-creator calls nightly to push Jobber visits and their amounts."""

from datetime import date
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import HubUser, HubPayVisit
from .services.contractor_pay import record_late_changes_safely
from .work_hours_views import MAX_ENTRIES_PER_REQUEST, _secret_ok

MAX_AMOUNT = Decimal("1000000")
VISIT_STATUSES = frozenset(
    {"COMPLETED", "LATE", "UPCOMING", "TODAY", "ACTIVE", "UNSCHEDULED", "DELETED"}
)
AMOUNT_RULES = frozenset(HubPayVisit.AmountRule.values)


def _money(value, field: str, *, optional: bool = False) -> Decimal | None:
    if value in (None, ""):
        if optional:
            return None
        value = "0"
    try:
        d = Decimal(str(value).strip())
    except InvalidOperation:
        raise ValueError(f"{field} must be a number")
    if not d.is_finite() or d < 0 or d >= MAX_AMOUNT:
        raise ValueError(f"{field} must be between 0 and {MAX_AMOUNT}")
    return d.quantize(Decimal("0.01"))


def _flag(value, field: str) -> bool:
    if value in (None, ""):
        return False
    if isinstance(value, bool):
        return value
    raise ValueError(f"{field} must be true or false")


def _text(entry: dict, field: str, limit: int) -> str:
    return str(entry.get(field) or "").strip()[:limit]


def _parse(entry) -> dict:
    if not isinstance(entry, dict):
        raise ValueError("entry must be an object")
    visit_id = _text(entry, "jobber_visit_id", 128)
    if not visit_id:
        raise ValueError("jobber_visit_id is required")
    visit_date = date.fromisoformat(str(entry.get("date") or "").strip()[:10])
    visit_status = _text(entry, "status", 16).upper()
    if visit_status not in VISIT_STATUSES:
        raise ValueError(f"unknown status {entry.get('status')!r}")
    completed_at = None
    if entry.get("completed_at"):
        completed_at = parse_datetime(str(entry["completed_at"]).strip())
        if completed_at is None:
            raise ValueError("completed_at must be an ISO datetime")
    amount_rule = _text(entry, "amount_rule", 16).lower()
    if amount_rule not in AMOUNT_RULES:
        raise ValueError(f"unknown amount_rule {entry.get('amount_rule')!r}")
    user_ids = entry.get("assigned_user_ids") or []
    if not isinstance(user_ids, list):
        raise ValueError("assigned_user_ids must be a list")
    user_ids = list(dict.fromkeys(str(u).strip() for u in user_ids if str(u or "").strip()))
    return {
        "jobber_visit_id": visit_id,
        "defaults": {
            "jobber_job_id": _text(entry, "jobber_job_id", 128),
            "job_number": _text(entry, "job_number", 32),
            "job_title": _text(entry, "job_title", 255),
            "client_jobber_id": _text(entry, "client_jobber_id", 128),
            "client_name": _text(entry, "client_name", 255),
            "visit_date": visit_date,
            "status": visit_status,
            "completed_at": completed_at,
            "assigned_user_ids": user_ids,
            "visit_amount": _money(entry.get("visit_amount"), "visit_amount"),
            "discount_share": _money(entry.get("discount_share"), "discount_share"),
            "tip_share": _money(entry.get("tip_share"), "tip_share"),
            "line_items_total": _money(
                entry.get("line_items_total"), "line_items_total", optional=True
            ),
            "invoice_id": _text(entry, "invoice_id", 128),
            "invoice_subtotal": _money(
                entry.get("invoice_subtotal"), "invoice_subtotal", optional=True
            ),
            "invoice_discount": _money(
                entry.get("invoice_discount"), "invoice_discount", optional=True
            ),
            "invoice_tips": _money(entry.get("invoice_tips"), "invoice_tips", optional=True),
            "amount_rule": amount_rule,
            "amount_is_estimate": _flag(entry.get("amount_is_estimate"), "amount_is_estimate"),
            "amount_needs_review": _flag(
                entry.get("amount_needs_review"), "amount_needs_review"
            ),
            "internal": _flag(entry.get("internal"), "internal"),
        },
    }


class InternalVisitsUpsertView(APIView):
    """
    POST /api/internal/visits/upsert/
    Header: X-Internal-Secret: <HUB_INTERNAL_SECRET>

    Body: {"entries": [{"jobber_visit_id", "date", "status", "assigned_user_ids",
                        "visit_amount", "discount_share", "tip_share", "amount_rule", ...}]}

    Each visit is overwritten with what is sent (a deleted visit is re-sent with status
    "deleted" and 0.00 amounts). Assigned Jobber user ids the Hub doesn't know are
    reported, not fatal: the visit is still saved and they still count in its headcount.
    """

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        if not (getattr(settings, "HUB_INTERNAL_SECRET", "") or ""):
            return Response(
                {"detail": "HUB_INTERNAL_SECRET is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        if not _secret_ok(request):
            return Response({"detail": "Invalid secret."}, status=status.HTTP_401_UNAUTHORIZED)

        data = request.data if isinstance(request.data, dict) else {}
        entries = data.get("entries")
        if not isinstance(entries, list):
            return Response(
                {"detail": "`entries` must be a list."}, status=status.HTTP_400_BAD_REQUEST
            )
        if len(entries) > MAX_ENTRIES_PER_REQUEST:
            return Response(
                {"detail": f"At most {MAX_ENTRIES_PER_REQUEST} entries per request."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        parsed, invalid = [], []
        for index, entry in enumerate(entries):
            try:
                parsed.append(_parse(entry))
            except ValueError as exc:
                invalid.append({"index": index, "error": str(exc)})

        wanted = {uid for p in parsed for uid in p["defaults"]["assigned_user_ids"]}
        users = {
            u.jobber_id: u for u in HubUser.objects.filter(jobber_id__in=wanted) if u.jobber_id
        }
        unknown_ids = sorted(wanted - users.keys())

        with transaction.atomic():
            for p in parsed:
                visit, _ = HubPayVisit.objects.update_or_create(
                    jobber_visit_id=p["jobber_visit_id"], defaults=p["defaults"]
                )
                visit.assignees.set(
                    [users[uid] for uid in p["defaults"]["assigned_user_ids"] if uid in users]
                )
        # Tips and invoices that change after a week is paid become adjustments.
        record_late_changes_safely()

        return Response(
            {
                "saved": len(parsed),
                "unknown_user_ids": unknown_ids,
                "invalid": invalid,
            }
        )
