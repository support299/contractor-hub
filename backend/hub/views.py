import copy
import re
import uuid
from pathlib import Path

from django.conf import settings
from django.utils import timezone
from django.contrib.auth import authenticate
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.pagination import PageNumberPagination
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
    HubNotification,
    HubResourceFolder,
    HubTrainingMaterial,
    HubUser,
)
from .permissions import (
    HubAccess,
    HubStaffAccess,
    IsAdminRole,
    user_is_hub_admin,
    user_is_hub_display,
)
from .staff_access import (
    SCOREBOARD_READ_SLUGS,
    STAFF_CREATE_BLOCKED_SLUGS,
    filter_leave_approvals_for_staff,
    filter_submissions_for_staff,
)
from .serializers import (
    FileUploadSerializer,
    GhlEmailLoginSerializer,
    HubAlertSerializer,
    HubDocumentSerializer,
    HubFormSerializer,
    HubFormSubmissionSerializer,
    HubLeaveApprovalSerializer,
    HubNotificationSerializer,
    HubResourceFolderSerializer,
    HubTrainingMaterialSerializer,
    HubUserDirectorySerializer,
    HubUserSerializer,
    MeUpdateSerializer,
    PasswordLoginSerializer,
    RequestOtpSerializer,
    SetPasswordSerializer,
    VerifyOtpSerializer,
)
from .services.auth import (
    clear_otp,
    find_hub_user_by_email,
    find_hub_user_by_phone,
    find_hub_user_for_login,
    generate_otp_code,
    otp_cooldown_active,
    otp_is_valid,
    set_hub_user_password,
    store_otp,
    tokens_for_hub_user,
)


# ---------- Auth ----------


class RequestOtpView(APIView):
    """Phone → generate OTP, push to GHL Login Otp field (workflow SMS)."""

    permission_classes = [AllowAny]

    def post(self, request):
        ser = RequestOtpSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        phone = ser.validated_data["phone"]
        hub_user = find_hub_user_by_phone(phone)
        if not hub_user:
            return Response(
                {"detail": "No active staff account found for that phone."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if otp_cooldown_active(hub_user):
            return Response(
                {
                    "detail": "Please wait before requesting another code.",
                    "code": "cooldown",
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        otp = generate_otp_code()
        store_otp(hub_user, otp)

        from .services.ghl import GHLApiError, GHLConfigError, push_otp_to_ghl

        try:
            push_otp_to_ghl(hub_user, otp)
        except GHLConfigError as exc:
            clear_otp(hub_user)
            return Response(
                {"detail": f"SMS gateway not configured: {exc}"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except GHLApiError as exc:
            clear_otp(hub_user)
            return Response(
                {"detail": f"Failed to send OTP: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response({"detail": "OTP sent"})


class VerifyOtpView(APIView):
    """Phone + OTP → JWT (does not require password_configured)."""

    permission_classes = [AllowAny]

    def post(self, request):
        ser = VerifyOtpSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        hub_user = find_hub_user_by_phone(ser.validated_data["phone"])
        if not hub_user:
            return Response(
                {"detail": "No active staff account found for that phone."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if not otp_is_valid(hub_user, ser.validated_data["otp"]):
            return Response(
                {"detail": "Invalid or expired OTP"},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        clear_otp(hub_user)
        return Response(tokens_for_hub_user(hub_user))


class PasswordLoginView(APIView):
    """Email or username + password → JWT."""

    permission_classes = [AllowAny]

    def post(self, request):
        ser = PasswordLoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ident = ser.validated_data["username"]
        password = ser.validated_data["password"]

        hub_user = find_hub_user_for_login(ident)
        if hub_user:
            if hub_user.status != HubUser.Status.ACTIVE:
                return Response(
                    {"detail": "Account inactive"}, status=status.HTTP_403_FORBIDDEN
                )
            if not hub_user.password_configured or not hub_user.auth_user_id:
                return Response(
                    {
                        "detail": "Password not set yet. Use Set password to create one.",
                        "code": "password_not_configured",
                    },
                    status=status.HTTP_401_UNAUTHORIZED,
                )
            user = authenticate(
                username=hub_user.auth_user.username, password=password
            )
            if not user:
                return Response(
                    {"detail": "Invalid credentials"},
                    status=status.HTTP_401_UNAUTHORIZED,
                )
            return Response(tokens_for_hub_user(hub_user))

        # Fallback: Django user without hub profile (legacy staff)
        user = authenticate(username=ident, password=password)
        if not user:
            # Try email as Django username
            from django.contrib.auth.models import User as DjUser

            try:
                dj = DjUser.objects.get(email__iexact=ident)
                user = authenticate(username=dj.username, password=password)
            except DjUser.DoesNotExist:
                user = None
        if not user:
            return Response(
                {"detail": "Invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED
            )
        profile = getattr(user, "hub_profile", None)
        if profile:
            if not profile.password_configured:
                return Response(
                    {
                        "detail": "Password not set yet. Use Set password to create one.",
                        "code": "password_not_configured",
                    },
                    status=status.HTTP_401_UNAUTHORIZED,
                )
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
                    "position": "",
                },
            }
        )


class GhlEmailLoginView(APIView):
    """GHL custom-menu SSO: email of an active hub user → JWT (no password)."""

    permission_classes = [AllowAny]

    def post(self, request):
        if not getattr(settings, "HUB_GHL_EMAIL_LOGIN", True):
            return Response(
                {
                    "detail": "Email auto-login is disabled.",
                    "code": "disabled",
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        ser = GhlEmailLoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        hub_user = find_hub_user_by_email(ser.validated_data["email"])
        if not hub_user:
            return Response(
                {"detail": "No active staff account found for that email."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(tokens_for_hub_user(hub_user))


class SetPasswordView(APIView):
    """First-time password for existing HubUser by email (no public signup)."""

    permission_classes = [AllowAny]

    def post(self, request):
        from django.core.exceptions import ValidationError as DjangoValidationError

        ser = SetPasswordSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        hub_user = find_hub_user_by_email(ser.validated_data["email"])
        if not hub_user:
            return Response(
                {"detail": "No active staff account found for that email."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if hub_user.password_configured:
            return Response(
                {
                    "detail": "Password already set. Sign in instead.",
                    "code": "already_configured",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            set_hub_user_password(hub_user, ser.validated_data["password"])
        except DjangoValidationError as e:
            return Response(
                {"detail": e.messages if hasattr(e, "messages") else [str(e)]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(tokens_for_hub_user(hub_user))


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
                    "phone": profile.phone,
                    "position": profile.position or "",
                }
            )
        return Response(
            {
                "userId": None,
                "role": "admin" if request.user.is_staff else "employee",
                "identifier": request.user.username,
                "name": request.user.get_full_name() or request.user.username,
                "email": request.user.email,
                "phone": "",
                "position": "",
            }
        )

    def patch(self, request):
        profile = getattr(request.user, "hub_profile", None)
        if not profile:
            return Response(
                {"detail": "No hub profile linked"}, status=status.HTTP_400_BAD_REQUEST
            )
        if user_is_hub_display(request.user):
            return Response(
                {"detail": "Display accounts cannot update profile."},
                status=status.HTTP_403_FORBIDDEN,
            )
        ser = MeUpdateSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        if "email" in ser.validated_data:
            profile.email = ser.validated_data["email"] or ""
            if profile.auth_user_id:
                profile.auth_user.email = profile.email
                profile.auth_user.save(update_fields=["email"])
        if "phone" in ser.validated_data:
            profile.phone = ser.validated_data["phone"] or ""
        profile.save()
        return self.get(request)


# ---------- Users ----------


class HubUserViewSet(viewsets.ModelViewSet):
    queryset = HubUser.objects.all()
    serializer_class = HubUserSerializer
    pagination_class = None
    filterset_fields = ["role", "status"]
    search_fields = ["name", "email", "phone"]
    ordering_fields = ["created_at", "name"]

    def get_permissions(self):
        if self.action == "directory":
            return [AllowAny()]
        if self.action in ("list", "retrieve", "sectors", "me"):
            return [HubAccess()]
        return [IsAdminRole()]

    def list(self, request, *args, **kwargs):
        from datetime import date

        from .services.vacation import ensure_vacation_balance_current

        today = date.today()
        for user in list(self.get_queryset()):
            ensure_vacation_balance_current(user, today)
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        from datetime import date

        from .services.vacation import ensure_vacation_balance_current

        user = self.get_object()
        ensure_vacation_balance_current(user, date.today())
        return super().retrieve(request, *args, **kwargs)

    @action(detail=False, methods=["get"], url_path="directory")
    def directory(self, request):
        qs = HubUser.objects.filter(status=HubUser.Status.ACTIVE).order_by("name")
        return Response(HubUserDirectorySerializer(qs, many=True).data)

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
        return [IsAdminRole()]

    def get_queryset(self):
        qs = super().get_queryset()
        # Public list: active only unless hub admin / open-access mode
        if not user_is_hub_admin(self.request.user) and self.action in (
            "list",
            "retrieve",
            "by_slug",
        ):
            qs = qs.filter(status=HubForm.Status.ACTIVE)
        return qs

    @action(detail=False, methods=["get"], url_path=r"by-slug/(?P<slug>[^/.]+)")
    def by_slug(self, request, slug=None):
        try:
            form = self.get_queryset().get(slug=slug)
        except HubForm.DoesNotExist:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(self.get_serializer(form).data)

    @action(detail=True, methods=["post"])
    def duplicate(self, request, id=None):
        original = self.get_object()
        name = f"Copy of {original.name}"[:255]
        base = (original.slug or "form")[:75]
        candidate = f"{base}-copy"[:80]
        n = 2
        while HubForm.objects.filter(slug=candidate).exists():
            suffix = f"-copy-{n}"
            candidate = f"{base[: 80 - len(suffix)]}{suffix}"
            n += 1
        clone = HubForm.objects.create(
            name=name,
            description=original.description,
            url="",
            slug=candidate,
            status=original.status,
            fields=copy.deepcopy(original.fields),
            extra_fields=copy.deepcopy(original.extra_fields),
        )
        return Response(
            self.get_serializer(clone).data,
            status=status.HTTP_201_CREATED,
        )


class HubFormSubmissionViewSet(viewsets.ModelViewSet):
    queryset = HubFormSubmission.objects.select_related("form").all()
    serializer_class = HubFormSubmissionSerializer
    pagination_class = None
    filterset_fields = ["form"]
    ordering_fields = ["created_at"]

    def get_permissions(self):
        if self.action == "create":
            return [AllowAny()]
        if self.action in ("update", "partial_update", "destroy"):
            return [IsAdminRole()]
        return [HubAccess()]

    def get_queryset(self):
        qs = super().get_queryset()
        if user_is_hub_admin(self.request.user):
            return qs
        if user_is_hub_display(self.request.user):
            return qs.filter(form__slug__in=SCOREBOARD_READ_SLUGS)
        profile = getattr(self.request.user, "hub_profile", None)
        if not profile:
            return qs.none()
        return filter_submissions_for_staff(qs, profile)

    def create(self, request, *args, **kwargs):
        form_id = request.data.get("formId") or request.data.get("form_id")
        if form_id:
            form = HubForm.objects.filter(pk=form_id).first()
            if form and form.slug in STAFF_CREATE_BLOCKED_SLUGS:
                if not user_is_hub_admin(request.user):
                    return Response(
                        {"detail": "Only admins can add these records."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        submission = serializer.save()
        # Auto-create leave approval for time-off form
        if submission.form.slug == "request-time-off":
            HubLeaveApproval.objects.get_or_create(submission=submission)
            from .services.leave_notify import notify_leave_submitted

            notify_leave_submitted(submission)
        from .services.tip_confirm import maybe_run_tip_confirm

        maybe_run_tip_confirm(submission)
        return submission

    def perform_update(self, serializer):
        submission = serializer.save()
        from .services.tip_confirm import maybe_run_tip_confirm

        maybe_run_tip_confirm(submission)
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
    queryset = HubLeaveApproval.objects.select_related(
        "submission", "submission__form"
    ).all()
    serializer_class = HubLeaveApprovalSerializer
    pagination_class = None
    lookup_field = "submission_id"

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [HubStaffAccess()]
        return [IsAdminRole()]

    def get_queryset(self):
        qs = super().get_queryset()
        if user_is_hub_admin(self.request.user):
            return qs
        profile = getattr(self.request.user, "hub_profile", None)
        if not profile:
            return qs.none()
        return filter_leave_approvals_for_staff(qs, profile)

    def perform_update(self, serializer):
        previous_status = serializer.instance.status
        status_val = serializer.validated_data.get("status")
        if status_val and status_val != HubLeaveApproval.Status.PENDING:
            approval = serializer.save(decided_at=timezone.now())
        else:
            approval = serializer.save()
        if approval.status == HubLeaveApproval.Status.APPROVED:
            from .services.leave_approve import on_leave_approved

            on_leave_approved(approval)
        if previous_status != approval.status:
            from .services.leave_notify import notify_leave_decision

            notify_leave_decision(approval, previous_status)

    @action(detail=True, methods=["post"], url_path="retry-jobber-sync")
    def retry_jobber_sync(self, request, submission_id=None):
        approval = self.get_object()
        if approval.status != HubLeaveApproval.Status.APPROVED:
            return Response(
                {"detail": "Only approved leave can sync to Jobber."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if approval.jobber_task_id:
            return Response(self.get_serializer(approval).data)
        from .services.leave_approve import sync_jobber_task

        sync_jobber_task(approval)
        approval.refresh_from_db()
        return Response(self.get_serializer(approval).data)

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


# ---------- Notifications ----------


class NotificationPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


class HubNotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = HubNotificationSerializer
    permission_classes = [HubStaffAccess]
    pagination_class = NotificationPagination

    def get_queryset(self):
        profile = getattr(self.request.user, "hub_profile", None)
        if not profile:
            return HubNotification.objects.none()
        qs = HubNotification.objects.filter(recipient=profile)
        unread = (self.request.query_params.get("unread") or "").lower()
        if unread in ("1", "true", "yes"):
            qs = qs.filter(read_at__isnull=True)
        return qs

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        profile = getattr(request.user, "hub_profile", None)
        unread_count = 0
        if profile:
            unread_count = HubNotification.objects.filter(
                recipient=profile, read_at__isnull=True
            ).count()
        if isinstance(response.data, dict):
            response.data["unreadCount"] = unread_count
        return response

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        profile = getattr(request.user, "hub_profile", None)
        if not profile:
            return Response({"unreadCount": 0})
        count = HubNotification.objects.filter(
            recipient=profile, read_at__isnull=True
        ).count()
        return Response({"unreadCount": count})

    @action(detail=True, methods=["post"], url_path="read")
    def mark_read(self, request, pk=None):
        n = self.get_object()
        if n.read_at is None:
            n.read_at = timezone.now()
            n.save(update_fields=["read_at"])
        return Response(self.get_serializer(n).data)

    @action(detail=False, methods=["post"], url_path="read-all")
    def mark_all_read(self, request):
        profile = getattr(request.user, "hub_profile", None)
        updated = 0
        if profile:
            updated = HubNotification.objects.filter(
                recipient=profile, read_at__isnull=True
            ).update(read_at=timezone.now())
        return Response({"updated": updated})

    @action(detail=False, methods=["post"], url_path="clear-all")
    def clear_all(self, request):
        profile = getattr(request.user, "hub_profile", None)
        deleted = 0
        if profile:
            deleted, _ = HubNotification.objects.filter(recipient=profile).delete()
        return Response({"deleted": deleted})


# ---------- Resources ----------


def _filter_by_position(qs, request):
    """
    Restrict training/documents to the requester's team position.

    Empty visible_positions = visible to everyone.
    Hub admins (and open-access mode) see all items.
    Staff are filtered by HubUser.position from their auth profile —
    client ?position= is ignored so it cannot be spoofed.
    Staff with no position only see unrestricted items.
    Portable across SQLite (local) and Postgres (RDS).
    """
    if user_is_hub_admin(request.user):
        return qs

    profile = getattr(request.user, "hub_profile", None)
    position = (getattr(profile, "position", None) or "").strip()

    from django.db import connection

    if connection.vendor == "postgresql":
        from django.db.models import Q

        if not position:
            return qs.filter(Q(visible_positions=[]) | Q(visible_positions__isnull=True))
        return qs.filter(
            Q(visible_positions=[])
            | Q(visible_positions__isnull=True)
            | Q(visible_positions__contains=[position])
        )

    # SQLite / others: filter in Python within the existing queryset
    matching_ids = []
    for pk, positions in qs.values_list("pk", "visible_positions"):
        positions = positions or []
        if not positions:
            matching_ids.append(pk)
        elif position and position in positions:
            matching_ids.append(pk)
    return qs.filter(pk__in=matching_ids)


class HubResourceFolderViewSet(viewsets.ModelViewSet):
    queryset = HubResourceFolder.objects.all()
    serializer_class = HubResourceFolderSerializer
    pagination_class = None
    filterset_fields = ["kind"]
    search_fields = ["name"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [HubStaffAccess()]
        return [IsAdminRole()]


class HubTrainingMaterialViewSet(viewsets.ModelViewSet):
    queryset = HubTrainingMaterial.objects.select_related("folder").all()
    serializer_class = HubTrainingMaterialSerializer
    pagination_class = None
    search_fields = ["title", "category"]
    filterset_fields = ["folder"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [HubStaffAccess()]
        return [IsAdminRole()]

    def get_queryset(self):
        return _filter_by_position(super().get_queryset(), self.request)


class HubDocumentViewSet(viewsets.ModelViewSet):
    queryset = HubDocument.objects.select_related("folder").all()
    serializer_class = HubDocumentSerializer
    pagination_class = None
    search_fields = ["title", "category"]
    filterset_fields = ["folder"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [HubStaffAccess()]
        return [IsAdminRole()]

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
        return [IsAdminRole()]

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
    """Return a media URL (local absolute URL or S3 pre-signed URL).

    Form-upload paths stay publicly fetchable (public forms).
    Hub document paths require auth and respect position visibility.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        from hub.services.storage import file_exists, file_url, use_s3

        path = request.query_params.get("path", "").lstrip("/")
        err = _authorize_media_path(path, request)
        if err is not None:
            return err
        if not file_exists(path):
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

        url = file_url(path)
        if url and not use_s3() and not url.startswith("http"):
            url = request.build_absolute_uri(url)
        return Response({"url": url})


def _authorize_media_path(path: str, request):
    """Return an error Response, or None if access is allowed."""
    if not path or ".." in path:
        return Response({"detail": "Invalid path"}, status=status.HTTP_400_BAD_REQUEST)

    is_hub_doc = path.startswith("hub-documents/") or "/hub-documents/" in path
    if not is_hub_doc:
        return None

    if not HubAccess().has_permission(request, None):
        return Response(
            {"detail": "Authentication required"},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    docs = HubDocument.objects.filter(file_path=path)
    if docs.exists():
        visible = _filter_by_position(docs, request)
        if not visible.exists():
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
    return None


class MediaContentView(APIView):
    """
    Stream file bytes through the API (same-origin).

    Needed so pdf.js can load hub documents without S3 CORS errors.
    Form-upload paths remain publicly readable; hub-documents require auth.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        import mimetypes
        from pathlib import PurePosixPath

        from django.http import FileResponse

        from hub.services.storage import open_file

        path = request.query_params.get("path", "").lstrip("/")
        err = _authorize_media_path(path, request)
        if err is not None:
            return err

        handle = open_file(path)
        if handle is None:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        filename = PurePosixPath(path).name or "file"
        response = FileResponse(handle, content_type=content_type)
        response["Content-Disposition"] = f'inline; filename="{filename}"'
        # Allow pdf.js / canvas on the SPA origin when this is ever fetched cross-origin
        origin = request.headers.get("Origin")
        if origin:
            response["Access-Control-Allow-Origin"] = origin
            response["Access-Control-Allow-Credentials"] = "true"
            response["Vary"] = "Origin"
        return response


class FileDeleteView(APIView):
    permission_classes = [IsAdminRole]

    def post(self, request):
        from hub.services.storage import delete_file

        path = (request.data.get("path") or "").lstrip("/")
        if not path or ".." in path:
            return Response({"detail": "Invalid path"}, status=status.HTTP_400_BAD_REQUEST)
        delete_file(path)
        return Response({"ok": True})


# Re-export refresh for urls
TokenRefreshView = TokenRefreshView
