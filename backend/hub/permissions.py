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


class IsAdminRole(BasePermission):
    """Hub admin (or open-access mode)."""

    def has_permission(self, request, view):
        return user_is_hub_admin(request.user)


class HubAccess(BasePermission):
    """
    Any authenticated hub user when HUB_OPEN_ACCESS=False.
    When open: AllowAny.
    """

    def has_permission(self, request, view):
        if hub_open_access():
            return True
        return user_is_authenticated(request.user)


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
