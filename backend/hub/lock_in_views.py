"""Internal lock-in APIs for service-creator + admin debug lists."""

from django.db.models import Count, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import HubUser, HubVisit, LockInBonus, PendingLockIn
from .permissions import HubAccess, IsAdminRole, user_can_read_scoreboard, user_is_hub_admin
from .serializers import HubVisitSerializer, LockInBonusSerializer, PendingLockInSerializer
from .services import lock_in as svc


class InternalLockInAPIView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]


class InternalVisitUpsertView(InternalLockInAPIView):
    def post(self, request):
        try:
            visit = svc.upsert_visit(request.data if isinstance(request.data, dict) else {})
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(svc.serialize_visit(visit))


class InternalVisitListView(InternalLockInAPIView):
    def get(self, request):
        ids = (request.query_params.get("jobber_visit_ids") or "").strip()
        client_id = (request.query_params.get("client_id") or "").strip()
        qs = HubVisit.objects.prefetch_related("technicians").all()
        if ids:
            qs = qs.filter(jobber_visit_id__in=[x.strip() for x in ids.split(",") if x.strip()])
        elif client_id:
            qs = qs.filter(client_jobber_id=client_id)
        else:
            return Response(
                {"detail": "Provide jobber_visit_ids or client_id"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response([svc.serialize_visit(v) for v in qs[:100]])


class InternalPendingCreateView(InternalLockInAPIView):
    def post(self, request):
        try:
            pending, created = svc.create_pending_stage1(
                request.data if isinstance(request.data, dict) else {}
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"created": created, "pending": svc.serialize_pending(pending)},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class InternalPendingLookupView(InternalLockInAPIView):
    def get(self, request):
        client_id = (request.query_params.get("client_id") or "").strip()
        if not client_id:
            return Response({"detail": "client_id required"}, status=status.HTTP_400_BAD_REQUEST)
        job_id = (request.query_params.get("job_id") or "").strip() or None
        pending = svc.find_open_pending_for_client(client_id, job_id)
        if not pending:
            return Response({"pending": None})
        return Response({"pending": svc.serialize_pending(pending)})


class InternalPendingConfirmView(InternalLockInAPIView):
    def post(self, request, pk):
        try:
            pending = PendingLockIn.objects.get(pk=pk)
        except PendingLockIn.DoesNotExist:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        data = request.data if isinstance(request.data, dict) else {}
        pending = svc.confirm_pending(
            pending,
            visit_id=str(data.get("visit_id") or data.get("first_recurring_visit_id") or ""),
            visit_at=data.get("visit_at") or data.get("first_recurring_visit_at"),
        )
        return Response({"pending": svc.serialize_pending(pending)})


class InternalPendingPatchView(InternalLockInAPIView):
    def patch(self, request, pk):
        try:
            pending = PendingLockIn.objects.get(pk=pk)
        except PendingLockIn.DoesNotExist:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        pending = svc.patch_pending_stage1(
            pending, request.data if isinstance(request.data, dict) else {}
        )
        return Response({"pending": svc.serialize_pending(pending)})


class InternalPendingExpireView(InternalLockInAPIView):
    def post(self, request, pk):
        try:
            pending = PendingLockIn.objects.get(pk=pk)
        except PendingLockIn.DoesNotExist:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        data = request.data if isinstance(request.data, dict) else {}
        pending = svc.expire_pending(
            pending, reason=str(data.get("reason") or "Eligibility Period Exceeded")
        )
        return Response({"pending": svc.serialize_pending(pending)})


class InternalBonusSmsFlagsView(InternalLockInAPIView):
    def patch(self, request, pk):
        try:
            bonus = LockInBonus.objects.select_related("technician", "pending").get(pk=pk)
        except LockInBonus.DoesNotExist:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        data = request.data if isinstance(request.data, dict) else {}
        fields = []
        if "potential_sms_sent" in data:
            bonus.potential_sms_sent = bool(data.get("potential_sms_sent"))
            fields.append("potential_sms_sent")
        if "confirmation_sms_sent" in data:
            bonus.confirmation_sms_sent = bool(data.get("confirmation_sms_sent"))
            fields.append("confirmation_sms_sent")
        if fields:
            bonus.save(update_fields=fields + ["updated_at"])
        return Response({"bonus": svc.serialize_bonus(bonus)})


class InternalUserByJobberView(InternalLockInAPIView):
    def get(self, request):
        jobber_id = (request.query_params.get("jobber_id") or "").strip()
        if not jobber_id:
            return Response({"detail": "jobber_id required"}, status=status.HTTP_400_BAD_REQUEST)
        user = HubUser.objects.filter(jobber_id=jobber_id).first()
        if not user:
            return Response({"user": None})
        return Response({"user": svc.serialize_user(user)})


class InternalUserGhlIdView(InternalLockInAPIView):
    def patch(self, request, pk):
        try:
            user = HubUser.objects.get(pk=pk)
        except HubUser.DoesNotExist:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        ghl_id = str((request.data or {}).get("ghl_id") or "").strip()
        if not ghl_id:
            return Response({"detail": "ghl_id required"}, status=status.HTTP_400_BAD_REQUEST)
        user.ghl_id = ghl_id[:128]
        user.save(update_fields=["ghl_id", "updated_at"])
        return Response({"user": svc.serialize_user(user)})


class HubVisitViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = HubVisit.objects.prefetch_related("technicians").all()
    serializer_class = HubVisitSerializer
    permission_classes = [HubAccess]
    filterset_fields = ["client_jobber_id", "jobber_job_id", "job_type", "technicians"]
    search_fields = ["jobber_visit_id", "client_name", "title"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user_can_read_scoreboard(user):
            return qs
        profile = getattr(user, "hub_profile", None)
        if profile is None:
            return qs.none()
        return qs.filter(technicians=profile)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        qs = self.get_queryset()
        start = (request.query_params.get("start_at_after") or "").strip()
        end = (request.query_params.get("start_at_before") or "").strip()
        if start:
            qs = qs.filter(Q(start_at__gte=start) | Q(start_at__isnull=True, created_at__gte=start))
        if end:
            qs = qs.filter(Q(start_at__lte=end) | Q(start_at__isnull=True, created_at__lte=end))

        total = qs.count()
        by_technician = {}
        rows = qs.values("technicians").annotate(c=Count("id", distinct=True))
        for row in rows:
            tid = row.get("technicians")
            if tid:
                by_technician[str(tid)] = row["c"]
        return Response({"total": total, "by_technician": by_technician})


class PendingLockInViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = PendingLockIn.objects.prefetch_related("technicians", "bonuses__technician").all()
    serializer_class = PendingLockInSerializer
    permission_classes = [IsAdminRole]
    filterset_fields = ["client_jobber_id", "locked_in", "status", "quote_id"]
    search_fields = ["quote_id", "client_name", "client_jobber_id"]


class LockInBonusViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = LockInBonus.objects.select_related("technician", "pending").all()
    serializer_class = LockInBonusSerializer
    permission_classes = [HubAccess]
    pagination_class = None
    filterset_fields = ["status", "bonus_type", "technician"]
    search_fields = ["pending__client_name", "technician__name"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user_can_read_scoreboard(user):
            return qs
        profile = getattr(user, "hub_profile", None)
        if profile is None:
            return qs.none()
        return qs.filter(technician_id=profile.id)
