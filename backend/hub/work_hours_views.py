"""Internal endpoint service-creator calls nightly to push Jobber timesheet totals."""

import hmac
from datetime import date
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import HubUser, HubWorkHours

MAX_ENTRIES_PER_REQUEST = 1000
MAX_HOURS_PER_DAY = Decimal("24")


def _secret_ok(request) -> bool:
    expected = getattr(settings, "HUB_INTERNAL_SECRET", "") or ""
    if not expected:
        return False
    given = request.headers.get("X-Internal-Secret", "")
    return hmac.compare_digest(given.encode(), expected.encode())


def _hours(value) -> Decimal:
    try:
        d = Decimal(str(value if value not in (None, "") else "0").strip())
    except InvalidOperation:
        raise ValueError("hours must be a number")
    if not d.is_finite() or d < 0 or d > MAX_HOURS_PER_DAY:
        raise ValueError("hours must be between 0 and 24")
    return d.quantize(Decimal("0.01"))


class InternalWorkHoursUpsertView(APIView):
    """
    POST /api/internal/work-hours/upsert/
    Header: X-Internal-Secret: <HUB_INTERNAL_SECRET>

    Body: {"entries": [{"jobber_user_id", "date", "regular_hours",
                        "drive_time_hours", "source"}]}

    Each employee-day is overwritten with what is sent, zeros included (a day deleted
    in Jobber is re-sent as 0.00). Unknown Jobber user ids are reported, not fatal.
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

        wanted = {
            str(e.get("jobber_user_id") or "").strip()
            for e in entries
            if isinstance(e, dict)
        } - {""}
        users = {
            u.jobber_id: u for u in HubUser.objects.filter(jobber_id__in=wanted) if u.jobber_id
        }

        saved, skipped_ids, invalid = 0, [], []
        with transaction.atomic():
            for index, entry in enumerate(entries):
                try:
                    if not isinstance(entry, dict):
                        raise ValueError("entry must be an object")
                    jobber_id = str(entry.get("jobber_user_id") or "").strip()
                    if not jobber_id:
                        raise ValueError("jobber_user_id is required")
                    work_date = date.fromisoformat(str(entry.get("date") or "").strip()[:10])
                    regular = _hours(entry.get("regular_hours"))
                    drive = _hours(entry.get("drive_time_hours"))
                except ValueError as exc:
                    invalid.append({"index": index, "error": str(exc)})
                    continue
                user = users.get(jobber_id)
                if user is None:
                    if jobber_id not in skipped_ids:
                        skipped_ids.append(jobber_id)
                    continue
                HubWorkHours.objects.update_or_create(
                    employee=user,
                    work_date=work_date,
                    defaults={
                        "regular_hours": regular,
                        "drive_time_hours": drive,
                        "source": HubWorkHours.Source.JOBBER,
                    },
                )
                saved += 1

        return Response(
            {
                "saved": saved,
                "skipped": len(skipped_ids),
                "skipped_ids": skipped_ids,
                "invalid": invalid,
            }
        )
