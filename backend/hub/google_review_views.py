"""Company-wide Google review counts from GHL Reputation."""

from __future__ import annotations

import logging

from django.utils.dateparse import parse_datetime
from rest_framework.response import Response
from rest_framework.views import APIView

from hub.permissions import IsScoreboardReader
from hub.services.ghl_internal import (
    GhlInternalApiError,
    GhlInternalConfigError,
    count_five_star,
    sync_google_reviews,
)

logger = logging.getLogger(__name__)


def _bound(raw: str | None):
    value = (raw or "").strip()
    if not value:
        return None
    return parse_datetime(value)


class GoogleReviewSummaryView(APIView):
    permission_classes = [IsScoreboardReader]

    def get(self, request):
        start = _bound(request.query_params.get("start_at_after"))
        end = _bound(request.query_params.get("start_at_before"))
        try:
            sync_google_reviews()
        except (GhlInternalConfigError, GhlInternalApiError) as exc:
            logger.warning("Google review sync skipped: %s", exc)
            return Response({"five_star": 0})
        return Response({"five_star": count_five_star(start=start, end=end)})
