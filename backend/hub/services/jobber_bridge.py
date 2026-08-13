"""Call service-creator to create a Jobber Task. Hub never stores Jobber OAuth tokens."""

from __future__ import annotations

import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class JobberBridgeError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _base_url() -> str:
    return (getattr(settings, "SERVICE_CREATOR_BASE_URL", "") or "").rstrip("/")


def create_absence_task(
    *,
    title: str,
    description: str,
    start_date: str,
    end_date: str,
    assignee_jobber_user_id: str | None = None,
    idempotency_key: str | None = None,
) -> dict:
    base = _base_url()
    if not base:
        raise JobberBridgeError("SERVICE_CREATOR_BASE_URL is not configured")

    payload = {
        "title": title,
        "description": description,
        "start_date": start_date,
        "end_date": end_date,
    }
    if assignee_jobber_user_id:
        payload["assignee_jobber_user_id"] = assignee_jobber_user_id
    if idempotency_key:
        payload["idempotency_key"] = str(idempotency_key)

    url = f"{base}/api/jobber/tasks/create/"
    try:
        resp = requests.post(url, json=payload, timeout=30)
    except requests.RequestException as exc:
        raise JobberBridgeError(f"Could not reach service-creator: {exc}") from exc

    try:
        data = resp.json() if resp.content else {}
    except ValueError:
        data = {}

    if resp.status_code >= 400:
        err = data.get("error") or data.get("detail") or resp.text[:500]
        raise JobberBridgeError(str(err), status_code=resp.status_code)

    task_id = data.get("task_id") or ""
    if not task_id:
        raise JobberBridgeError("service-creator returned no task_id")
    return {
        "task_id": task_id,
        "jobber_web_uri": data.get("jobber_web_uri") or "",
    }
