"""New Tips form: notify + SMS once when Confirm Tip becomes yes-like."""

from __future__ import annotations

import logging
import re
import uuid
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction

from hub.models import HubForm, HubFormSubmission, HubTipConfirmLog, HubUser
from hub.services.ghl import send_conversation_sms
from hub.services.notify import event_key_for, notify_user

logger = logging.getLogger(__name__)

TYPE_TIP_CONFIRMED = "tip_confirmed"
TIPS_DATA_PATH = "/admin/data"
NEW_TIPS_SLUGS = frozenset({"new-tips", "new_tips"})

_YES_VALUES = frozenset(
    {
        "yes",
        "y",
        "true",
        "1",
        "confirmed",
        "confirm",
        "checked",
        "on",
    }
)


def is_new_tips_form(form: HubForm | None) -> bool:
    if form is None:
        return False
    slug = (form.slug or "").strip().lower()
    if slug in NEW_TIPS_SLUGS:
        return True
    name = (form.name or "").strip().lower()
    if re.search(r"\bnew\s+tips?\b", name):
        return True
    return name in ("tips", "tip")


def _fields(form: HubForm) -> dict:
    fields = form.fields or []

    def by_label(pattern, type_name=None):
        rx = re.compile(pattern, re.I)
        for f in fields:
            if not isinstance(f, dict):
                continue
            if type_name and f.get("type") != type_name:
                continue
            if rx.search(f.get("label") or ""):
                return f
        return None

    client_field = by_label(r"client")
    amount_field = by_label(r"tip", "number") or by_label(
        r"per\s+(technician|cleaner)|amount", "number"
    )
    tech_field = (
        by_label(r"technician|cleaner", "users")
        or next(
            (f for f in fields if isinstance(f, dict) and f.get("type") == "users"),
            None,
        )
        or by_label(r"technician|cleaner")
    )
    confirm_field = by_label(r"confirm")
    return {
        "client": client_field,
        "amount": amount_field,
        "technicians": tech_field,
        "confirm": confirm_field,
    }


def _fid(field) -> str | None:
    if not field or not isinstance(field, dict):
        return None
    return field.get("id")


def _as_str(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return ", ".join(str(v) for v in value if v is not None)
    return str(value)


def _as_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    s = str(value).strip()
    return [s] if s else []


def is_confirmed_value(raw) -> bool:
    if isinstance(raw, bool):
        return raw
    s = _as_str(raw).strip().lower()
    if not s:
        return False
    return s in _YES_VALUES


def format_tip_amount(raw) -> str:
    s = _as_str(raw).strip().replace("$", "").replace(",", "")
    if not s:
        return "0"
    try:
        d = Decimal(s)
    except InvalidOperation:
        return s
    if d == d.to_integral_value():
        return str(int(d))
    return f"{d:.2f}"


def first_name(user: HubUser) -> str:
    parts = (user.name or "").strip().split()
    return parts[0] if parts else "there"


def resolve_hub_users(values: list[str]) -> list[HubUser]:
    seen: set[uuid.UUID] = set()
    out: list[HubUser] = []
    for raw in values:
        token = (raw or "").strip()
        if not token:
            continue
        user = None
        try:
            uid = uuid.UUID(token)
            user = HubUser.objects.filter(pk=uid).first()
        except ValueError:
            pass
        if user is None:
            user = HubUser.objects.filter(name__iexact=token).first()
        if user is None:
            user = HubUser.objects.filter(email__iexact=token).first()
        if user is None or user.id in seen:
            continue
        seen.add(user.id)
        out.append(user)
    return out


def parse_tip_submission(submission: HubFormSubmission) -> dict:
    form = submission.form
    answers = submission.answers or {}
    detected = _fields(form)
    client_id = _fid(detected["client"])
    amount_id = _fid(detected["amount"])
    tech_id = _fid(detected["technicians"])
    confirm_id = _fid(detected["confirm"])

    client_name = (_as_str(answers.get(client_id)) if client_id else "").strip()
    amount_raw = answers.get(amount_id) if amount_id else None
    staff = _as_list(answers.get(tech_id)) if tech_id else []
    confirm_raw = answers.get(confirm_id) if confirm_id else None
    technicians = resolve_hub_users(staff)
    return {
        "client_name": client_name or "a client",
        "amount": format_tip_amount(amount_raw),
        "staff": staff,
        "technicians": technicians,
        "confirmed": is_confirmed_value(confirm_raw),
        "confirm_raw": confirm_raw,
    }


def _sms_body(user: HubUser, amount: str, client_name: str) -> str:
    return (
        f"🎉 Great job, {first_name(user)}!\n\n"
        f"You received a ${amount} tip from {client_name}! 💰👏\n\n"
        "Keep up the great work! 😎"
    )


def _in_app_body(amount: str, client_name: str) -> str:
    return f"You received a ${amount} tip from {client_name}."


def _run_automation(submission: HubFormSubmission, parsed: dict) -> None:
    amount = parsed["amount"]
    client_name = parsed["client_name"]
    techs = parsed["technicians"]
    if not techs:
        logger.warning(
            "Tip confirm %s: no technicians resolved; still marking ran",
            submission.id,
        )
        return
    for tech in techs:
        notify_user(
            tech,
            type=TYPE_TIP_CONFIRMED,
            title="New Tip! 🎉",
            body=_in_app_body(amount, client_name),
            link=TIPS_DATA_PATH,
            payload={
                "submission_id": str(submission.id),
                "client_name": client_name,
                "amount": amount,
                "technician_id": str(tech.id),
            },
            event_key=event_key_for(TYPE_TIP_CONFIRMED, submission.id, tech.id),
        )
        try:
            ok = send_conversation_sms(tech, _sms_body(tech, amount, client_name))
            if not ok:
                logger.warning(
                    "Tip SMS failed for technician %s submission %s",
                    tech.id,
                    submission.id,
                )
        except Exception:
            logger.exception(
                "Tip SMS error for technician %s submission %s",
                tech.id,
                submission.id,
            )


def maybe_run_tip_confirm(submission: HubFormSubmission) -> bool:
    """
    If New Tips + confirmed + not yet logged, claim the log then notify/SMS.
    Returns True if this call claimed and ran the automation.
    """
    try:
        form = getattr(submission, "form", None)
        if form is None:
            submission = HubFormSubmission.objects.select_related("form").get(
                pk=submission.pk
            )
            form = submission.form
        if not is_new_tips_form(form):
            return False
        parsed = parse_tip_submission(submission)
        if not parsed["confirmed"]:
            return False
        if HubTipConfirmLog.objects.filter(pk=submission.pk).exists():
            return False
        try:
            with transaction.atomic():
                HubTipConfirmLog.objects.create(submission=submission)
        except IntegrityError:
            return False
        _run_automation(submission, parsed)
        return True
    except Exception:
        logger.exception(
            "Tip confirm automation failed for submission %s",
            getattr(submission, "id", None),
        )
        return False
