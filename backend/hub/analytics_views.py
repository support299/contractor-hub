"""Analytics API for external dashboard consumers (API-key auth only)."""

from rest_framework.response import Response
from rest_framework.views import APIView

from hub.api_keys import AnalyticsApiKeyAuthentication, IsAnalyticsApiKey
from hub.services.analytics import _parse_date, build_analytics_payload


class AnalyticsOverviewView(APIView):
    """
    GET /api/admin-internal-app/analytics/

    Full analytics payload for the all-in-one dashboard.
    Auth: X-API-Key: <key>  OR  Authorization: Api-Key <key>

    Query params (optional):
      from=YYYY-MM-DD  — filter time-bounded sections from this date (inclusive)
      to=YYYY-MM-DD    — filter time-bounded sections to this date (inclusive)
    """

    authentication_classes = [AnalyticsApiKeyAuthentication]
    permission_classes = [IsAnalyticsApiKey]

    def get(self, request):
        from_date = _parse_date(request.query_params.get("from"))
        to_date = _parse_date(request.query_params.get("to"))
        if from_date and to_date and from_date > to_date:
            return Response(
                {"detail": "`from` must be on or before `to`."},
                status=400,
            )
        payload = build_analytics_payload(from_date=from_date, to_date=to_date)
        return Response(payload)
