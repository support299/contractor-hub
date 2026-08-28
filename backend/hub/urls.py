from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from . import lock_in_views, views

router = DefaultRouter()
router.register(r"users", views.HubUserViewSet, basename="hub-users")
router.register(r"forms", views.HubFormViewSet, basename="hub-forms")
router.register(
    r"submissions", views.HubFormSubmissionViewSet, basename="hub-submissions"
)
router.register(
    r"leave-approvals", views.HubLeaveApprovalViewSet, basename="hub-leave-approvals"
)
router.register(
    r"notifications", views.HubNotificationViewSet, basename="hub-notifications"
)
router.register(
    r"resource-folders", views.HubResourceFolderViewSet, basename="hub-resource-folders"
)
router.register(
    r"training", views.HubTrainingMaterialViewSet, basename="hub-training"
)
router.register(r"documents", views.HubDocumentViewSet, basename="hub-documents")
router.register(r"alerts", views.HubAlertViewSet, basename="hub-alerts")
router.register(r"visits", lock_in_views.HubVisitViewSet, basename="hub-visits")
router.register(
    r"pending-lock-ins", lock_in_views.PendingLockInViewSet, basename="pending-lock-ins"
)
router.register(
    r"lock-in-bonuses", lock_in_views.LockInBonusViewSet, basename="lock-in-bonuses"
)

urlpatterns = [
    path("auth/request-otp/", views.RequestOtpView.as_view(), name="request-otp"),
    path("auth/verify-otp/", views.VerifyOtpView.as_view(), name="verify-otp"),
    path("auth/login/", views.PasswordLoginView.as_view(), name="password-login"),
    path("auth/ghl-email-login/", views.GhlEmailLoginView.as_view(), name="ghl-email-login"),
    path("auth/set-password/", views.SetPasswordView.as_view(), name="set-password"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("auth/me/", views.MeView.as_view(), name="me"),
    path("uploads/", views.FileUploadView.as_view(), name="file-upload"),
    path("uploads/url/", views.SignedUrlView.as_view(), name="file-url"),
    path("uploads/content/", views.MediaContentView.as_view(), name="file-content"),
    path("uploads/delete/", views.FileDeleteView.as_view(), name="file-delete"),
    path(
        "internal/lock-in/visits/upsert/",
        lock_in_views.InternalVisitUpsertView.as_view(),
        name="internal-lock-in-visit-upsert",
    ),
    path(
        "internal/lock-in/visits/",
        lock_in_views.InternalVisitListView.as_view(),
        name="internal-lock-in-visits",
    ),
    path(
        "internal/lock-in/pending/",
        lock_in_views.InternalPendingCreateView.as_view(),
        name="internal-lock-in-pending-create",
    ),
    path(
        "internal/lock-in/pending/lookup/",
        lock_in_views.InternalPendingLookupView.as_view(),
        name="internal-lock-in-pending-lookup",
    ),
    path(
        "internal/lock-in/pending/<uuid:pk>/confirm/",
        lock_in_views.InternalPendingConfirmView.as_view(),
        name="internal-lock-in-pending-confirm",
    ),
    path(
        "internal/lock-in/pending/<uuid:pk>/expire/",
        lock_in_views.InternalPendingExpireView.as_view(),
        name="internal-lock-in-pending-expire",
    ),
    path(
        "internal/lock-in/bonuses/<uuid:pk>/sms/",
        lock_in_views.InternalBonusSmsFlagsView.as_view(),
        name="internal-lock-in-bonus-sms",
    ),
    path(
        "internal/lock-in/users/",
        lock_in_views.InternalUserByJobberView.as_view(),
        name="internal-lock-in-user-by-jobber",
    ),
    path(
        "internal/lock-in/users/<uuid:pk>/",
        lock_in_views.InternalUserGhlIdView.as_view(),
        name="internal-lock-in-user-ghl",
    ),
    path("", include(router.urls)),
]
