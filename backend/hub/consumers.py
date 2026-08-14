"""JWT-authenticated notification WebSocket."""

from __future__ import annotations

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth.models import User
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from hub.services.notify import hub_user_group


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        hub_user = await self._hub_user_from_scope()
        if not hub_user:
            await self.close(code=4401)
            return
        self.hub_user_id = str(hub_user.id)
        self.group_name = hub_user_group(self.hub_user_id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        group = getattr(self, "group_name", None)
        if group:
            await self.channel_layer.group_discard(group, self.channel_name)

    async def notification_created(self, event):
        await self.send_json(event["notification"])

    async def _hub_user_from_scope(self):
        token = self._token_from_scope()
        if not token:
            return None
        return await _hub_user_for_jwt(token)

    def _token_from_scope(self) -> str:
        qs = parse_qs((self.scope.get("query_string") or b"").decode())
        raw = (qs.get("token") or [""])[0]
        if raw:
            return raw.strip()
        headers = dict(self.scope.get("headers") or [])
        auth = (headers.get(b"authorization") or b"").decode()
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        return ""


@database_sync_to_async
def _hub_user_for_jwt(token_str: str):
    try:
        token = AccessToken(token_str)
        user = User.objects.select_related("hub_profile").get(pk=token["user_id"])
    except (TokenError, User.DoesNotExist, KeyError):
        return None
    return getattr(user, "hub_profile", None)
