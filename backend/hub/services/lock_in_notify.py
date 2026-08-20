"""In-app lock-in notifications (parallel to GHL SMS from service-creator)."""

from __future__ import annotations

import logging
from decimal import Decimal

from hub.models import LockInBonus, PendingLockIn
from hub.services.notify import event_key_for, notify_user

logger = logging.getLogger(__name__)

TYPE_POTENTIAL = "lock_in_potential"
TYPE_CONFIRMED = "lock_in_confirmed"
DASHBOARD_PATH = "/admin/dashboard"


def _money(amount) -> str:
    d = Decimal(str(amount or 0))
    if d == d.to_integral_value():
        return str(int(d))
    return f"{d:.2f}"


def _payload(pending: PendingLockIn, bonus: LockInBonus) -> dict:
    return {
        "bonus_id": str(bonus.id),
        "pending_id": str(pending.id),
        "quote_id": pending.quote_id,
        "client_name": pending.client_name or "",
        "amount": str(bonus.amount),
        "position": bonus.position_snapshot or "",
        "frequency": pending.frequency or "",
    }


def notify_lock_in_potential(pending: PendingLockIn) -> None:
    try:
        client = (pending.client_name or "A client").strip() or "A client"
        freq = (pending.frequency or "").strip() or "Currently Unknown"
        for bonus in pending.bonuses.select_related("technician").all():
            if Decimal(str(bonus.amount or 0)) <= 0:
                continue
            amt = _money(bonus.amount)
            notify_user(
                bonus.technician,
                type=TYPE_POTENTIAL,
                title="Potential lock-in bonus",
                body=(
                    f"{client} has approved a quote for recurring cleaning services. "
                    f"Potential earnings: ${amt}. Frequency: {freq}. Status: In Process."
                ),
                link=DASHBOARD_PATH,
                payload=_payload(pending, bonus),
                event_key=event_key_for(TYPE_POTENTIAL, bonus.id),
            )
    except Exception:
        logger.exception(
            "Lock-in potential notify failed for pending %s",
            getattr(pending, "id", None),
        )


def notify_lock_in_confirmed(pending: PendingLockIn) -> None:
    try:
        client = (pending.client_name or "a client").strip() or "a client"
        for bonus in pending.bonuses.select_related("technician").all():
            if Decimal(str(bonus.amount or 0)) <= 0:
                continue
            amt = _money(bonus.amount)
            position = (bonus.position_snapshot or "").strip() or "your recorded position"
            notify_user(
                bonus.technician,
                type=TYPE_CONFIRMED,
                title="Lock-in bonus confirmed",
                body=(
                    f"Your lock-in bonus for {client} has been confirmed. "
                    f"Bonus amount: ${amt}. Position: {position}."
                ),
                link=DASHBOARD_PATH,
                payload=_payload(pending, bonus),
                event_key=event_key_for(TYPE_CONFIRMED, bonus.id),
            )
    except Exception:
        logger.exception(
            "Lock-in confirmed notify failed for pending %s",
            getattr(pending, "id", None),
        )
