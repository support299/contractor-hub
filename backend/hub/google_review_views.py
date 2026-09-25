"""Company-wide Google review counts from GHL Reputation."""

from __future__ import annotations

import logging
import uuid

from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from hub.permissions import HubAccess, IsAdminRole, user_can_read_scoreboard
from hub.services.ghl_internal import (
    GhlInternalApiError,
    GhlInternalConfigError,
    count_five_star,
    serialize_google_reviews,
    serialize_one_google_review,
    set_review_cleaners,
    sync_google_reviews,
)

logger = logging.getLogger(__name__)


def _bound(raw: str | None):
    value = (raw or "").strip()
    if not value:
        return None
    return parse_datetime(value)


def _hub_profile(user):
    return getattr(user, "hub_profile", None)


def _may_read_technician(user, technician: str) -> bool:
    if user_can_read_scoreboard(user):
        return True
    profile = _hub_profile(user)
    return bool(profile and str(profile.id) == technician)


class GoogleReviewSummaryView(APIView):
    """Full list for the scoreboard. Staff may read only their own tagged reviews."""

    permission_classes = [HubAccess]

    def get(self, request):
        technician = (request.query_params.get("technician") or "").strip()
        cleaner_id = None
        if technician:
            try:
                cleaner_id = uuid.UUID(technician)
            except ValueError:
                return Response(
                    {"detail": "Invalid technician."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not _may_read_technician(request.user, str(cleaner_id)):
                return Response(status=status.HTTP_403_FORBIDDEN)
        elif not user_can_read_scoreboard(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)

        start = _bound(request.query_params.get("start_at_after"))
        end = _bound(request.query_params.get("start_at_before"))
        try:
            sync_google_reviews()
        except (GhlInternalConfigError, GhlInternalApiError) as exc:
            logger.warning("Google review sync skipped: %s", exc)
        return Response(
            {
                "five_star": count_five_star(start=start, end=end, cleaner_id=cleaner_id),
                "reviews": serialize_google_reviews(
                    start=start, end=end, cleaner_id=cleaner_id
                ),
            }
        )


class GoogleReviewCleanersView(APIView):
    permission_classes = [IsAdminRole]

    def patch(self, request, ghl_id):
        raw = request.data.get("cleaner_ids", request.data.get("cleanerIds"))
        if not isinstance(raw, list):
            return Response(
                {"detail": "cleaner_ids must be a list."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        review = set_review_cleaners(ghl_id, raw)
        if review is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(serialize_one_google_review(review))
