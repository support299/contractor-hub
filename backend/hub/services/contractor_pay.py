"""Contractor pay, worked out from the visits service-creator pushes (HubPayVisit).

Peter's rules:
- A contractor's pay for a visit = price before tax, after discount × the highest
  contractor % on the visit ÷ everyone on the visit. A client can instead be set to a
  fixed amount per visit, split the same way. Authorized admins can override any visit.
- Tips are paid on top, split evenly between everyone on the visit.
- Only completed visits are paid. A visit belongs to the pay week (Sunday–Saturday) of
  its scheduled date.
- Weekly deductions: the contractor's flat supplies deduction (in weeks they worked) and
  any restocks entered for that week.
- Once a week is marked paid it is frozen. Later increases (tip arrives, invoice higher,
  visit completed late) are paid as adjustments in the week they're found. Decreases are
  left alone.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone

from hub.models import (
    HubClientPayRule,
    HubPayAdjustment,
    HubPayChangeLog,
    HubPayDeduction,
    HubPayOverride,
    HubPayVisit,
    HubPayWeek,
    HubUser,
)

logger = logging.getLogger(__name__)

TORONTO = ZoneInfo("America/Toronto")
CENT = Decimal("0.01")
ZERO = Decimal("0")
PAYABLE_STATUS = "COMPLETED"

RULES_TEXT = (
    "Pay per visit = price before tax, after discount × highest contractor % on the visit "
    "÷ people on the visit (or the client's fixed amount ÷ people on the visit), unless an "
    "admin overrode it. Tips on top, split evenly. Only completed visits count, in the "
    "Sunday–Saturday week of the scheduled date. Paid weeks are frozen: later increases "
    "are paid as adjustments the week they're found; decreases are left alone."
)


class PayError(ValueError):
    """A pay action that isn't allowed (paid week, bad input)."""


def toronto_today() -> date:
    return timezone.now().astimezone(TORONTO).date()


def week_start(d: date) -> date:
    """Sunday on or before d."""
    return d - timedelta(days=(d.weekday() + 1) % 7)


def _q(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _s(value: Decimal | None) -> str | None:
    return None if value is None else format(_q(value), "f")


def _jsonable(value):
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, date):
        return value.isoformat()
    return value


def actor(request) -> HubUser | None:
    return getattr(getattr(request, "user", None), "hub_profile", None) if request else None


def log_change(request, action: str, detail: dict) -> None:
    HubPayChangeLog.objects.create(
        changed_by=actor(request),
        action=action,
        detail={k: _jsonable(v) for k, v in detail.items()},
    )


def is_week_paid(d: date) -> bool:
    return HubPayWeek.objects.filter(week_start=week_start(d)).exists()


def ensure_week_open(d: date) -> None:
    if is_week_paid(d):
        raise PayError(
            f"The pay week of {week_start(d).isoformat()} is already paid and can't be changed."
        )


# ---------- live rows ----------


def _due(basis: dict, visit: HubPayVisit) -> Decimal:
    """Pay owed for a pay row's basis, using the visit's current amounts."""
    headcount = Decimal(basis["headcount"])
    if basis.get("override") is not None:
        return _q(Decimal(basis["override"]))
    if visit.internal:
        return ZERO
    if basis.get("fixed") is not None:
        return _q(Decimal(basis["fixed"]) / headcount)
    if basis.get("percent") is not None:
        price = max(visit.visit_amount - visit.discount_share, ZERO)
        return _q(price * Decimal(basis["percent"]) / 100 / headcount)
    return ZERO


def _visit_rows(visits, rules, overrides) -> list[dict]:
    rows: list[dict] = []
    for v in visits:
        assignees = list(v.assignees.all())
        contractors = [u for u in assignees if u.role == HubUser.Role.CONTRACTOR]
        if not contractors:
            continue
        headcount = max(len(v.assigned_user_ids), len(assignees), 1)
        counted = v.status == PAYABLE_STATUS
        rule = rules.get(v.client_jobber_id) if v.client_jobber_id else None
        fixed = (
            rule.fixed_amount
            if rule and rule.rule == HubClientPayRule.Rule.FIXED and rule.fixed_amount is not None
            else None
        )
        percents = [c.contractor_percent for c in contractors if c.contractor_percent is not None]
        top = max(percents) if percents else None

        for c in contractors:
            override = overrides.get((v.id, c.id))
            basis = {
                "headcount": headcount,
                "percent": None if fixed is not None else _jsonable(top),
                "fixed": _jsonable(fixed),
                "override": _jsonable(override.amount) if override else None,
            }
            calculated = _due({**basis, "override": None}, v)
            flags: list[str] = []
            if override:
                pay_rule = "manual" if v.internal or v.visit_amount <= v.discount_share else "override"
            elif v.internal:
                pay_rule = None
                flags.append("no_price")
            elif fixed is not None:
                pay_rule = "fixed"
            else:
                pay_rule = "percent"
                if top is None:
                    flags.append("missing_percent")
            if not override and fixed is None and not v.internal:
                if v.amount_needs_review:
                    flags.append("amount_needs_review")
                if v.discount_share > v.visit_amount:
                    flags.append("discount_exceeds_price")
            if v.amount_is_estimate:
                flags.append("estimate")
            if not counted:
                flags.append("not_completed")

            common = {
                "date": v.visit_date.isoformat(),
                "status": "active" if counted else "void",
                "contractor_id": str(c.id),
                "contractor_name": c.name,
                "jobber_user_id": c.jobber_id or None,
                "visit_id": str(v.id),
                "jobber_visit_id": v.jobber_visit_id,
                "client_name": v.client_name,
                "job_title": v.job_title,
                "visit_status": v.status,
            }
            key = f"{v.jobber_visit_id}:{c.id}"
            rows.append(
                {
                    **common,
                    "id": f"pay:{key}",
                    "type": "pay",
                    "visit_amount": _s(v.visit_amount),
                    "discount_share": _s(v.discount_share),
                    "basis": basis,
                    "calculated_amount": _s(calculated),
                    "amount_paid": _s(_due(basis, v) if counted else ZERO),
                    "pay_rule": pay_rule,
                    "changed_by": override.changed_by.name if override and override.changed_by else None,
                    "reason": override.reason if override else "",
                    "override_id": str(override.id) if override else None,
                    "flags": flags,
                }
            )
            if v.tip_share > 0:
                tip = _q(v.tip_share / headcount)
                rows.append(
                    {
                        **common,
                        "id": f"tip:{key}",
                        "type": "tip",
                        "calculated_amount": _s(tip),
                        "amount_paid": _s(tip if counted else ZERO),
                        "pay_rule": None,
                        "flags": ["not_completed"] if not counted else [],
                    }
                )
    return rows


def _contractor_ref(user: HubUser) -> dict:
    return {
        "contractor_id": str(user.id),
        "contractor_name": user.name,
        "jobber_user_id": user.jobber_id or None,
    }


def _deduction_row(row_id: str, kind: str, user: HubUser, day: date, amount: Decimal, note: str) -> dict:
    return {
        "id": row_id,
        "type": kind,
        "date": day.isoformat(),
        "status": "active",
        **_contractor_ref(user),
        "calculated_amount": _s(-amount),
        "amount_paid": _s(-amount),
        "pay_rule": None,
        "note": note,
        "flags": [],
    }


def build_rows(from_date: date | None, to_date: date | None) -> list[dict]:
    """All pay rows dated in the range. Weeks are read whole (the supplies deduction
    depends on the week), paid weeks come from their frozen copy."""
    start = week_start(from_date) if from_date else None
    end = week_start(to_date) + timedelta(days=6) if to_date else None

    visits = HubPayVisit.objects.prefetch_related("assignees")
    restocks = HubPayDeduction.objects.select_related("contractor")
    adjustments = HubPayAdjustment.objects.select_related("contractor", "visit")
    paid_weeks = HubPayWeek.objects.all()
    if start:
        visits = visits.filter(visit_date__gte=start)
        restocks = restocks.filter(date__gte=start)
        adjustments = adjustments.filter(date__gte=start)
        paid_weeks = paid_weeks.filter(week_start__gte=start)
    if end:
        visits = visits.filter(visit_date__lte=end)
        restocks = restocks.filter(date__lte=end)
        adjustments = adjustments.filter(date__lte=end)
        paid_weeks = paid_weeks.filter(week_start__lte=end)

    rules = {r.client_jobber_id: r for r in HubClientPayRule.objects.all()}
    overrides = {
        (o.visit_id, o.contractor_id): o
        for o in HubPayOverride.objects.select_related("changed_by").filter(visit__in=visits)
    }
    rows = _visit_rows(visits, rules, overrides)

    worked: dict[tuple, HubUser] = {}
    users = {str(u.id): u for u in HubUser.objects.filter(role=HubUser.Role.CONTRACTOR)}
    for r in rows:
        if r["type"] == "pay" and r["status"] == "active" and r["contractor_id"] in users:
            ws = week_start(date.fromisoformat(r["date"]))
            worked[(r["contractor_id"], ws)] = users[r["contractor_id"]]
    for (cid, ws), user in worked.items():
        if user.supplies_deduction and user.supplies_deduction > 0:
            rows.append(
                _deduction_row(
                    f"ded:supplies:{cid}:{ws.isoformat()}",
                    "supplies_deduction",
                    user,
                    ws + timedelta(days=6),
                    user.supplies_deduction,
                    "Weekly supplies deduction",
                )
            )
    for d in restocks:
        rows.append(
            {
                **_deduction_row(f"ded:{d.id}", "restock_deduction", d.contractor, d.date, d.amount, d.note),
                "deduction_id": str(d.id),
            }
        )
    for a in adjustments:
        rows.append(
            {
                "id": f"adj:{a.id}",
                "type": "adjustment",
                "date": a.date.isoformat(),
                "status": "active",
                **_contractor_ref(a.contractor),
                "visit_id": str(a.visit_id) if a.visit_id else None,
                "jobber_visit_id": a.visit.jobber_visit_id if a.visit else None,
                "client_name": a.visit.client_name if a.visit else "",
                "source_row_id": a.source_row_id,
                "calculated_amount": _s(a.amount),
                "amount_paid": _s(a.amount),
                "pay_rule": None,
                "note": a.note,
                "flags": [],
            }
        )

    frozen = {w.week_start: w for w in paid_weeks}
    out: list[dict] = []
    for r in rows:
        ws = week_start(date.fromisoformat(r["date"]))
        if ws in frozen:
            continue
        out.append({**r, "week_start": ws.isoformat(), "week_paid": False})
    for w in frozen.values():
        out.extend({**r, "week_start": w.week_start.isoformat(), "week_paid": True} for r in w.rows)

    out = [
        r
        for r in out
        if not (from_date and r["date"] < from_date.isoformat())
        and not (to_date and r["date"] > to_date.isoformat())
    ]
    out.sort(key=lambda r: (r["date"], r["contractor_name"], r["id"]))
    return out


def summarize(rows: list[dict]) -> dict:
    by_contractor: dict[str, dict] = {}
    by_type: dict[str, Decimal] = defaultdict(Decimal)
    for r in rows:
        amount = Decimal(r["amount_paid"])
        by_type[r["type"]] += amount
        c = by_contractor.setdefault(
            r["contractor_id"],
            {
                "contractor_id": r["contractor_id"],
                "contractor_name": r["contractor_name"],
                "visits": 0,
                "pay": ZERO,
                "tips": ZERO,
                "deductions": ZERO,
                "adjustments": ZERO,
                "total": ZERO,
            },
        )
        if r["type"] == "pay" and r["status"] == "active":
            c["visits"] += 1
        bucket = {"pay": "pay", "tip": "tips", "adjustment": "adjustments"}.get(r["type"], "deductions")
        c[bucket] += amount
        c["total"] += amount
    contractors = sorted(by_contractor.values(), key=lambda c: c["contractor_name"])
    for c in contractors:
        for k in ("pay", "tips", "deductions", "adjustments", "total"):
            c[k] = _s(c[k])
    return {
        "total_paid": _s(sum(by_type.values(), ZERO)),
        "by_type": {k: _s(v) for k, v in sorted(by_type.items())},
        "by_contractor": contractors,
    }


# ---------- paying a week, late changes ----------


def mark_week_paid(ws: date, request=None) -> HubPayWeek:
    if ws != week_start(ws):
        raise PayError("A pay week starts on a Sunday.")
    if ws + timedelta(days=6) >= toronto_today():
        raise PayError("This pay week isn't over yet.")
    with transaction.atomic():
        if HubPayWeek.objects.select_for_update().filter(week_start=ws).exists():
            raise PayError("This pay week is already paid.")
        rows = [
            {k: v for k, v in r.items() if k not in ("week_start", "week_paid")}
            for r in build_rows(ws, ws + timedelta(days=6))
        ]
        # A frozen $0 would never be fixed later (a % entered afterwards isn't retroactive).
        missing = sorted(
            {
                r["contractor_name"]
                for r in rows
                if r["type"] == "pay" and r["status"] == "active" and "missing_percent" in r["flags"]
            }
        )
        if missing:
            raise PayError(
                f"Set a contractor % (or change the pay on their visits) before paying this week: "
                f"{', '.join(missing)}."
            )
        week = HubPayWeek.objects.create(
            week_start=ws, paid_at=timezone.now(), paid_by=actor(request), rows=rows
        )
        log_change(
            request,
            "week.paid",
            {"week_start": ws, "total_paid": summarize(rows)["total_paid"], "rows": len(rows)},
        )
    return week


def record_late_changes() -> int:
    """Add adjustments for increases on paid weeks. Returns how many were added."""
    weeks = list(HubPayWeek.objects.all())
    if not weeks:
        return 0
    visit_ids = {r["jobber_visit_id"] for w in weeks for r in w.rows if r.get("type") == "pay"}
    visits = {v.jobber_visit_id: v for v in HubPayVisit.objects.filter(jobber_visit_id__in=visit_ids)}
    contractors = {
        str(u.id): u for u in HubUser.objects.filter(id__in={
            r["contractor_id"] for w in weeks for r in w.rows if r.get("type") == "pay"
        })
    }
    already: dict[str, Decimal] = defaultdict(Decimal)
    for source, amount in HubPayAdjustment.objects.values_list("source_row_id", "amount"):
        already[source] += amount

    today = toronto_today()
    added = 0
    for w in weeks:
        paid = {r["id"]: Decimal(r["amount_paid"]) for r in w.rows}
        for r in w.rows:
            if r.get("type") != "pay":
                continue
            v = visits.get(r["jobber_visit_id"])
            contractor = contractors.get(r["contractor_id"])
            if v is None or contractor is None or v.status != PAYABLE_STATUS:
                continue
            key = r["id"].removeprefix("pay:")
            headcount = Decimal(r["basis"]["headcount"])
            owed = {
                f"pay:{key}": (_due(r["basis"], v), "Visit completed or invoiced higher after the week was paid"),
                f"tip:{key}": (_q(v.tip_share / headcount), "Tip arrived after the week was paid"),
            }
            for source, (due, note) in owed.items():
                diff = due - paid.get(source, ZERO) - already[source]
                if diff >= CENT:
                    HubPayAdjustment.objects.create(
                        source_row_id=source,
                        contractor=contractor,
                        visit=v,
                        amount=diff,
                        date=today,
                        note=note,
                    )
                    already[source] += diff
                    added += 1
    return added


def record_late_changes_safely() -> None:
    try:
        record_late_changes()
    except Exception:  # never fail the visits sync over this
        logger.exception("Contractor pay: recording late changes failed")
