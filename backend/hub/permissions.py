from django.conf import settings
from rest_framework.permissions import BasePermission, SAFE_METHODS


def hub_open_access() -> bool:
    """When True, hub APIs are open (legacy Lovable parity). Default False."""
    return bool(getattr(settings, "HUB_OPEN_ACCESS", False))


def user_is_authenticated(user) -> bool:
    return bool(user and getattr(user, "is_authenticated", False))


def user_is_hub_admin(user) -> bool:
    if hub_open_access():
        return True
    if not user_is_authenticated(user):
        return False
    if user.is_staff or user.is_superuser:
        return True
    profile = getattr(user, "hub_profile", None)
    return bool(profile and profile.role == "admin")


def user_can_change_contractor_pay(user) -> bool:
    """Admins Peter has allowed to change contractor pay (or a Django superuser)."""
    if not user_is_hub_admin(user):
        return False
    if hub_open_access() or getattr(user, "is_superuser", False):
        return True
    profile = getattr(user, "hub_profile", None)
    return bool(profile and profile.can_change_contractor_pay)


def user_can_approve_leave(user) -> bool:
    """Admins, plus active staff Peter has given the approve-time-off switch."""
    if user_is_hub_admin(user):
        return True
    if not user_is_authenticated(user):
        return False
    profile = getattr(user, "hub_profile", None)
    return bool(profile and profile.can_approve_leave and profile.status == "active")


def internal_secret_ok(request) -> bool:
    """Shared-secret check for the endpoints service-creator calls server to server."""
    import hmac

    expected = getattr(settings, "HUB_INTERNAL_SECRET", "") or ""
    if not expected:
        return False
    given = request.headers.get("X-Internal-Secret", "")
    return hmac.compare_digest(given.encode(), expected.encode())


class InternalSecret(BasePermission):
    message = "Missing or invalid X-Internal-Secret header."

    def has_permission(self, request, view):
        return internal_secret_ok(request)


def user_is_hub_display(user) -> bool:
    if not user_is_authenticated(user):
        return False
    profile = getattr(user, "hub_profile", None)
    return bool(profile and profile.role == "display")


def user_can_read_scoreboard(user) -> bool:
    """Admin or office-TV display account. Not regular staff."""
    return user_is_hub_admin(user) or user_is_hub_display(user)


class IsAdminRole(BasePermission):
    """Hub admin (or open-access mode)."""

    def has_permission(self, request, view):
        return user_is_hub_admin(request.user)


class CanChangeContractorPay(BasePermission):
    def has_permission(self, request, view):
        return user_can_change_contractor_pay(request.user)


class CanApproveLeave(BasePermission):
    def has_permission(self, request, view):
        return user_can_approve_leave(request.user)


class HubAccess(BasePermission):
    """
    Any authenticated hub user when HUB_OPEN_ACCESS=False.
    When open: AllowAny.
    """

    def has_permission(self, request, view):
        if hub_open_access():
            return True
        return user_is_authenticated(request.user)


class HubStaffAccess(BasePermission):
    """Authenticated hub user except display (TV) accounts."""

    def has_permission(self, request, view):
        if user_is_hub_display(request.user):
            return False
        return HubAccess().has_permission(request, view)


class IsScoreboardReader(BasePermission):
    """Team scoreboard reads: admin or display."""

    def has_permission(self, request, view):
        if hub_open_access():
            return True
        return user_can_read_scoreboard(request.user)


class IsAdminOrReadOnly(BasePermission):
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return HubAccess().has_permission(request, view)
        return IsAdminRole().has_permission(request, view)


class AllowPublicFormAccess(BasePermission):
    """Public can read active forms and create submissions; writes otherwise require admin."""

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        action = getattr(view, "action", None)
        if action in ("create", "submit", "by_slug"):
            return True
        return IsAdminRole().has_permission(request, view)
