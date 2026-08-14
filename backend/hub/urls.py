from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

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

urlpatterns = [
    path("auth/request-otp/", views.RequestOtpView.as_view(), name="request-otp"),
    path("auth/verify-otp/", views.VerifyOtpView.as_view(), name="verify-otp"),
    path("auth/login/", views.PasswordLoginView.as_view(), name="password-login"),
    path("auth/set-password/", views.SetPasswordView.as_view(), name="set-password"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("auth/me/", views.MeView.as_view(), name="me"),
    path("uploads/", views.FileUploadView.as_view(), name="file-upload"),
    path("uploads/url/", views.SignedUrlView.as_view(), name="file-url"),
    path("uploads/content/", views.MediaContentView.as_view(), name="file-content"),
    path("uploads/delete/", views.FileDeleteView.as_view(), name="file-delete"),
    path("", include(router.urls)),
]
