"""Auth helpers: ensure Django User exists for a HubUser and issue JWTs."""

from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.utils.crypto import get_random_string
from rest_framework_simplejwt.tokens import RefreshToken

from hub.models import HubUser


def ensure_auth_user(hub_user: HubUser) -> User:
    if hub_user.auth_user_id:
        return hub_user.auth_user

    base = (hub_user.email or f"user-{hub_user.id}").lower()
    username = base
    i = 1
    while User.objects.filter(username=username).exists():
        username = f"{base}-{i}"
        i += 1

    user = User.objects.create_user(
        username=username,
        email=hub_user.email or "",
        password=get_random_string(32),
    )
    if hub_user.role == HubUser.Role.ADMIN:
        user.is_staff = True
        user.save(update_fields=["is_staff"])

    hub_user.auth_user = user
    hub_user.save(update_fields=["auth_user", "updated_at"])
    return user


def tokens_for_hub_user(hub_user: HubUser) -> dict:
    user = ensure_auth_user(hub_user)
    refresh = RefreshToken.for_user(user)
    refresh["hub_user_id"] = str(hub_user.id)
    refresh["role"] = hub_user.role
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "user": {
            "userId": str(hub_user.id),
            "role": hub_user.role,
            "identifier": hub_user.email or hub_user.phone,
            "name": hub_user.name,
            "email": hub_user.email,
            "position": hub_user.position or "",
        },
    }


def find_hub_user(identifier: str, role: str) -> HubUser | None:
    ident = identifier.strip()
    phone_norm = ident.replace(" ", "")
    qs = HubUser.objects.filter(role=role, status=HubUser.Status.ACTIVE)
    for u in qs:
        if u.email and u.email.lower() == ident.lower():
            return u
        if u.phone and u.phone.replace(" ", "") == phone_norm:
            return u
    return None


def find_hub_user_by_email(email: str) -> HubUser | None:
    email_norm = (email or "").strip().lower()
    if not email_norm:
        return None
    for u in HubUser.objects.filter(status=HubUser.Status.ACTIVE).exclude(email=""):
        if u.email.lower() == email_norm:
            return u
    return None


def find_hub_user_for_login(username_or_email: str) -> HubUser | None:
    """Resolve HubUser by email (preferred) or linked Django username."""
    ident = (username_or_email or "").strip()
    if not ident:
        return None
    by_email = find_hub_user_by_email(ident)
    if by_email:
        return by_email
    try:
        user = User.objects.get(username__iexact=ident)
    except User.DoesNotExist:
        return None
    return getattr(user, "hub_profile", None)


def set_hub_user_password(hub_user: HubUser, password: str) -> None:
    validate_password(password)
    user = ensure_auth_user(hub_user)
    user.set_password(password)
    if hub_user.email:
        user.email = hub_user.email
    if hub_user.role == HubUser.Role.ADMIN:
        user.is_staff = True
        user.is_superuser = True
    user.save()
    hub_user.password_configured = True
    hub_user.save(update_fields=["password_configured", "updated_at"])
