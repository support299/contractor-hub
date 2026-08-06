from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsAdminRole(BasePermission):
    """Authenticated user whose linked HubUser role is admin (or Django staff/superuser)."""

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_staff or user.is_superuser:
            return True
        profile = getattr(user, "hub_profile", None)
        return bool(profile and profile.role == "admin")


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
