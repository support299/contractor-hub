"""Auth helpers: ensure Django User exists for a HubUser and issue JWTs."""

from django.contrib.auth.models import User
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
