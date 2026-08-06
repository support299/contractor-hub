from django.conf import settings
from rest_framework.permissions import BasePermission, SAFE_METHODS


def hub_open_access() -> bool:
    """Lovable parity: shipped UI is open admin (no login gate)."""
    return bool(getattr(settings, "HUB_OPEN_ACCESS", True))


def user_is_hub_admin(user) -> bool:
    if hub_open_access():
        return True
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if user.is_staff or user.is_superuser:
        return True
    profile = getattr(user, "hub_profile", None)
    return bool(profile and profile.role == "admin")


class IsAdminRole(BasePermission):
    """Hub admin (or open-access mode)."""

    def has_permission(self, request, view):
        return user_is_hub_admin(request.user)


class HubAccess(BasePermission):
    """
    Hub API access.
    When HUB_OPEN_ACCESS=True (default): AllowAny — matches Lovable open RLS.
    When False: require authenticated hub admin / Django staff.
    """

    def has_permission(self, request, view):
        if hub_open_access():
            return True
        return user_is_hub_admin(request.user)


class IsAdminOrReadOnly(BasePermission):
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
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
