from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from . import (
    analytics_views,
    contractor_pay_views,
    google_review_views,
    lock_in_views,
    views,
    visits_views,
    work_hours_views,
)

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
router.register(
    r"notification-emails",
    views.HubNotificationEmailViewSet,
    basename="hub-notification-emails",
)
router.register(r"visits", lock_in_views.HubVisitViewSet, basename="hub-visits")
router.register(
    r"pending-lock-ins", lock_in_views.PendingLockInViewSet, basename="pending-lock-ins"
)
router.register(
    r"lock-in-bonuses", lock_in_views.LockInBonusViewSet, basename="lock-in-bonuses"
)

urlpatterns = [
    path(
        "notification-prefs/",
        views.HubNotifyPrefsView.as_view(),
        name="hub-notification-prefs",
    ),
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
        "internal/lock-in/pending/<uuid:pk>/",
        lock_in_views.InternalPendingPatchView.as_view(),
        name="internal-lock-in-pending-patch",
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
        "internal/work-hours/upsert/",
        work_hours_views.InternalWorkHoursUpsertView.as_view(),
        name="internal-work-hours-upsert",
    ),
    path(
        "internal/visits/upsert/",
        visits_views.InternalVisitsUpsertView.as_view(),
        name="internal-visits-upsert",
    ),
    path(
        "contractor-pay/",
        contractor_pay_views.ContractorPayWeekView.as_view(),
        name="contractor-pay-week",
    ),
    path(
        "contractor-pay/weeks/<str:week>/paid/",
        contractor_pay_views.ContractorPayMarkPaidView.as_view(),
        name="contractor-pay-mark-paid",
    ),
    path(
        "contractor-pay/client-rules/",
        contractor_pay_views.ClientPayRulesView.as_view(),
        name="contractor-pay-client-rules",
    ),
    path(
        "contractor-pay/client-rules/<uuid:pk>/",
        contractor_pay_views.ClientPayRuleDetailView.as_view(),
        name="contractor-pay-client-rule",
    ),
    path(
        "contractor-pay/overrides/",
        contractor_pay_views.PayOverridesView.as_view(),
        name="contractor-pay-overrides",
    ),
    path(
        "contractor-pay/overrides/<uuid:pk>/",
        contractor_pay_views.PayOverrideDetailView.as_view(),
        name="contractor-pay-override",
    ),
    path(
        "contractor-pay/restocks/",
        contractor_pay_views.RestocksView.as_view(),
        name="contractor-pay-restocks",
    ),
    path(
        "contractor-pay/restocks/<uuid:pk>/",
        contractor_pay_views.RestockDetailView.as_view(),
        name="contractor-pay-restock",
    ),
    path(
        "contractor-pay/log/",
        contractor_pay_views.PayChangeLogView.as_view(),
        name="contractor-pay-log",
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
    path(
        "admin-internal-app/analytics/",
        analytics_views.AnalyticsOverviewView.as_view(),
        name="analytics-overview",
    ),
    path(
        "reviews/google-summary/",
        google_review_views.GoogleReviewSummaryView.as_view(),
        name="google-review-summary",
    ),
    path(
        "reviews/google/<str:ghl_id>/cleaners/",
        google_review_views.GoogleReviewCleanersView.as_view(),
        name="google-review-cleaners",
    ),
    path("", include(router.urls)),
]
