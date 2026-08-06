import re
import uuid
from pathlib import Path

from django.conf import settings
from django.utils import timezone
from django.contrib.auth import authenticate
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView

from .models import (
    HubAlert,
    HubDocument,
    HubForm,
    HubFormSubmission,
    HubLeaveApproval,
    HubResourceFolder,
    HubTrainingMaterial,
    HubUser,
)
from .permissions import IsAdminRole
from .serializers import (
    FileUploadSerializer,
    HubAlertSerializer,
    HubDocumentSerializer,
    HubFormSerializer,
    HubFormSubmissionSerializer,
    HubLeaveApprovalSerializer,
    HubResourceFolderSerializer,
    HubTrainingMaterialSerializer,
    HubUserSerializer,
    OtpLoginSerializer,
    PasswordLoginSerializer,
)
from .services.auth import find_hub_user, tokens_for_hub_user


# ---------- Auth ----------


class OtpLoginView(APIView):
    """Email/phone + role + OTP → JWT (matches Lovable hub-store scaffolding)."""

    permission_classes = [AllowAny]

    def post(self, request):
        ser = OtpLoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        otp = ser.validated_data["otp"]
        if otp != settings.DEFAULT_OTP:
            return Response({"detail": "Invalid OTP"}, status=status.HTTP_401_UNAUTHORIZED)

        hub_user = find_hub_user(
            ser.validated_data["identifier"], ser.validated_data["role"]
        )
        if not hub_user:
            return Response({"detail": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        return Response(tokens_for_hub_user(hub_user))


class PasswordLoginView(APIView):
    """Django username/password → JWT (for seeded admin accounts)."""

    permission_classes = [AllowAny]

    def post(self, request):
        ser = PasswordLoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        user = authenticate(
            username=ser.validated_data["username"],
            password=ser.validated_data["password"],
        )
        if not user:
            return Response(
                {"detail": "Invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED
            )
        profile = getattr(user, "hub_profile", None)
        if profile:
            return Response(tokens_for_hub_user(profile))

        from rest_framework_simplejwt.tokens import RefreshToken

        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": {
                    "userId": None,
                    "role": "admin" if user.is_staff else "employee",
                    "identifier": user.username,
                    "name": user.get_full_name() or user.username,
                    "email": user.email,
                },
            }
        )


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = getattr(request.user, "hub_profile", None)
        if profile:
            return Response(
                {
                    "userId": str(profile.id),
                    "role": profile.role,
                    "identifier": profile.email or profile.phone,
                    "name": profile.name,
                    "email": profile.email,
                }
            )
        return Response(
            {
                "userId": None,
                "role": "admin" if request.user.is_staff else "employee",
                "identifier": request.user.username,
                "name": request.user.get_full_name() or request.user.username,
                "email": request.user.email,
            }
        )


# ---------- Users ----------


class HubUserViewSet(viewsets.ModelViewSet):
    queryset = HubUser.objects.all()
    serializer_class = HubUserSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]
    pagination_class = None
    filterset_fields = ["role", "status"]
    search_fields = ["name", "email", "phone"]
    ordering_fields = ["created_at", "name"]

    @action(detail=False, methods=["get"], url_path="sectors")
    def sectors(self, request):
        sectors = set()
        for u in HubUser.objects.all():
            for s in u.sectors or []:
                if s and str(s).strip():
                    sectors.add(str(s).strip())
        return Response(sorted(sectors, key=str.lower))


# ---------- Forms & submissions ----------


class HubFormViewSet(viewsets.ModelViewSet):
    queryset = HubForm.objects.all()
    serializer_class = HubFormSerializer
    lookup_field = "id"
    pagination_class = None
    filterset_fields = ["status", "slug"]
    search_fields = ["name", "slug", "description"]

    def get_permissions(self):
        if self.action in ("list", "retrieve", "by_slug"):
            return [AllowAny()]
        return [IsAuthenticated(), IsAdminRole()]

    def get_queryset(self):
        qs = super().get_queryset()
        # Public list: active only unless authenticated admin
        user = self.request.user
        is_admin = (
            user
            and user.is_authenticated
            and (
                user.is_staff
                or user.is_superuser
                or (
                    getattr(user, "hub_profile", None)
                    and user.hub_profile.role == "admin"
                )
            )
        )
        if not is_admin and self.action in ("list", "retrieve", "by_slug"):
            qs = qs.filter(status=HubForm.Status.ACTIVE)
        return qs

    @action(detail=False, methods=["get"], url_path=r"by-slug/(?P<slug>[^/.]+)")
    def by_slug(self, request, slug=None):
        try:
            form = self.get_queryset().get(slug=slug)
        except HubForm.DoesNotExist:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(self.get_serializer(form).data)


class HubFormSubmissionViewSet(viewsets.ModelViewSet):
    queryset = HubFormSubmission.objects.select_related("form").all()
    serializer_class = HubFormSubmissionSerializer
    pagination_class = None
    filterset_fields = ["form"]
    ordering_fields = ["created_at"]

    def get_permissions(self):
        if self.action == "create":
            return [AllowAny()]
        return [IsAuthenticated(), IsAdminRole()]

    def perform_create(self, serializer):
        submission = serializer.save()
        # Auto-create leave approval for time-off form
        if submission.form.slug == "request-time-off":
            HubLeaveApproval.objects.get_or_create(submission=submission)
        return submission

    @action(detail=False, methods=["get"], url_path="by-form/(?P<form_id>[^/.]+)")
    def by_form(self, request, form_id=None):
        qs = self.get_queryset().filter(form_id=form_id)
        page = self.paginate_queryset(qs)
        ser = self.get_serializer(page or qs, many=True)
        if page is not None:
            return self.get_paginated_response(ser.data)
        return Response(ser.data)

    @action(detail=False, methods=["get"], url_path="open-payrolls")
    def open_payrolls(self, request):
        source_form_id = request.query_params.get("sourceFormId")
        label_field_id = request.query_params.get("labelFieldId")
        status_field_id = request.query_params.get("statusFieldId")
        if not source_form_id:
            return Response([])
        subs = HubFormSubmission.objects.filter(form_id=source_form_id).order_by(
            "-created_at"
        )
        out = []
        for s in subs:
            answers = s.answers or {}
            if status_field_id:
                v = answers.get(status_field_id)
                if not (isinstance(v, str) and "open" in v.lower()):
                    continue
            label = ""
            if label_field_id:
                v = answers.get(label_field_id)
                if v is not None:
                    label = str(v)
            if not label:
                first = next(
                    (
                        str(v)
                        for v in answers.values()
                        if isinstance(v, str) and v.strip()
                    ),
                    f"Submission {str(s.id)[:6]}",
                )
                label = first
            out.append({"id": str(s.id), "label": label})
        return Response(out)


# ---------- Leave approvals ----------


class HubLeaveApprovalViewSet(viewsets.ModelViewSet):
    queryset = HubLeaveApproval.objects.select_related("submission").all()
    serializer_class = HubLeaveApprovalSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]
    pagination_class = None
    lookup_field = "submission_id"

    def perform_update(self, serializer):
        status_val = serializer.validated_data.get("status")
        if status_val and status_val != HubLeaveApproval.Status.PENDING:
            serializer.save(decided_at=timezone.now())
        else:
            serializer.save()

    @action(detail=False, methods=["post"], url_path="ensure")
    def ensure(self, request):
        """Create pending approval for a submission if missing."""
        submission_id = request.data.get("submission_id")
        if not submission_id:
            return Response(
                {"detail": "submission_id required"}, status=status.HTTP_400_BAD_REQUEST
            )
        try:
            sub = HubFormSubmission.objects.get(pk=submission_id)
        except HubFormSubmission.DoesNotExist:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        obj, _ = HubLeaveApproval.objects.get_or_create(submission=sub)
        return Response(self.get_serializer(obj).data)


# ---------- Resources ----------


def _filter_by_position(qs, request):
    """
    Optional ?position= filters items visible to that staff position.
    Empty visible_positions = visible to everyone.
    Portable across SQLite (local) and Postgres (RDS).
    """
    position = (request.query_params.get("position") or "").strip()
    if not position:
        return qs

    from django.db import connection

    if connection.vendor == "postgresql":
        from django.db.models import Q

        return qs.filter(
            Q(visible_positions=[]) | Q(visible_positions__contains=[position])
        )

    # SQLite / others: filter in Python (resource lists are small)
    base = qs.model.objects.all().only("pk", "visible_positions")
    matching_ids = []
    for obj in base:
        positions = obj.visible_positions or []
        if not positions or position in positions:
            matching_ids.append(obj.pk)
    return qs.filter(pk__in=matching_ids)


class HubResourceFolderViewSet(viewsets.ModelViewSet):
    queryset = HubResourceFolder.objects.all()
    serializer_class = HubResourceFolderSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]
    pagination_class = None
    filterset_fields = ["kind"]
    search_fields = ["name"]


class HubTrainingMaterialViewSet(viewsets.ModelViewSet):
    queryset = HubTrainingMaterial.objects.select_related("folder").all()
    serializer_class = HubTrainingMaterialSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]
    pagination_class = None
    search_fields = ["title", "category"]
    filterset_fields = ["folder"]

    def get_queryset(self):
        return _filter_by_position(super().get_queryset(), self.request)


class HubDocumentViewSet(viewsets.ModelViewSet):
    queryset = HubDocument.objects.select_related("folder").all()
    serializer_class = HubDocumentSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]
    pagination_class = None
    search_fields = ["title", "category"]
    filterset_fields = ["folder"]

    def get_queryset(self):
        return _filter_by_position(super().get_queryset(), self.request)


# ---------- Alerts ----------


class HubAlertViewSet(viewsets.ModelViewSet):
    queryset = HubAlert.objects.all()
    serializer_class = HubAlertSerializer
    pagination_class = None

    def get_permissions(self):
        if self.action in ("list", "retrieve", "active"):
            return [AllowAny()]
        return [IsAuthenticated(), IsAdminRole()]

    @action(detail=False, methods=["get"])
    def active(self, request):
        qs = self.get_queryset().filter(active=True)
        return Response(self.get_serializer(qs, many=True).data)


# ---------- Uploads ----------


def _safe_filename(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", name)


class FileUploadView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def get_permissions(self):
        # Public form uploads allowed; document bucket requires admin
        return [AllowAny()]

    def post(self, request):
        from hub.services.storage import file_url, save_file, use_s3

        ser = FileUploadSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        bucket = ser.validated_data.get("bucket", "form-uploads")
        if bucket == "hub-documents":
            if not IsAdminRole().has_permission(request, self):
                return Response(
                    {"detail": "Admin required for document uploads"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        upload = ser.validated_data["file"]
        prefix = ser.validated_data.get("prefix") or "submissions"
        rand = uuid.uuid4().hex[:8]
        safe = _safe_filename(upload.name)
        relative = f"{bucket}/{prefix}/{int(timezone.now().timestamp())}_{rand}_{safe}"

        # Stream via Django storage (local disk or S3)
        stored_path = save_file(relative, upload)
        url = file_url(stored_path)
        if url and not use_s3() and not url.startswith("http"):
            url = request.build_absolute_uri(url)

        return Response(
            {
                "path": stored_path,
                "name": upload.name,
                "size": upload.size,
                "type": upload.content_type or "",
                "url": url,
            },
            status=status.HTTP_201_CREATED,
        )


class SignedUrlView(APIView):
    """Return a media URL (local absolute URL or S3 pre-signed URL)."""

    permission_classes = [AllowAny]

    def get(self, request):
        from hub.services.storage import file_exists, file_url, use_s3

        path = request.query_params.get("path", "").lstrip("/")
        if not path or ".." in path:
            return Response({"detail": "Invalid path"}, status=status.HTTP_400_BAD_REQUEST)
        if not file_exists(path):
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        url = file_url(path)
        if url and not use_s3() and not url.startswith("http"):
            url = request.build_absolute_uri(url)
        return Response({"url": url})


class FileDeleteView(APIView):
    permission_classes = [IsAuthenticated, IsAdminRole]

    def post(self, request):
        from hub.services.storage import delete_file

        path = (request.data.get("path") or "").lstrip("/")
        if not path or ".." in path:
            return Response({"detail": "Invalid path"}, status=status.HTTP_400_BAD_REQUEST)
        delete_file(path)
        return Response({"ok": True})


# Re-export refresh for urls
TokenRefreshView = TokenRefreshView
