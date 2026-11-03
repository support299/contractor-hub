"""Admin API for contractor pay: the week view, paying a week, client rules, per-visit
overrides, restock deductions and the change log. Reading needs admin; changing needs
the contractor-pay permission (see permissions.user_can_change_contractor_pay)."""

import uuid
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.db.models import Count, Max
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    HubClientPayRule,
    HubPayChangeLog,
    HubPayDeduction,
    HubPayOverride,
    HubPayVisit,
    HubPayWeek,
    HubUser,
)
from .permissions import CanChangeContractorPay, IsAdminRole, user_can_change_contractor_pay
from .services import contractor_pay as pay

MAX_AMOUNT = Decimal("100000")


def _bad(message: str, code=status.HTTP_400_BAD_REQUEST) -> Response:
    return Response({"detail": message}, status=code)


def _amount(value, field: str, *, allow_zero: bool = True) -> Decimal:
    try:
        d = Decimal(str(value).strip())
    except (InvalidOperation, AttributeError):
        raise pay.PayError(f"{field} must be a number.")
    if not d.is_finite() or d < 0 or d >= MAX_AMOUNT or (not allow_zero and d == 0):
        raise pay.PayError(f"{field} must be {'0 or more' if allow_zero else 'more than 0'}.")
    return d.quantize(pay.CENT)


def _date(value, field: str) -> date:
    try:
        return date.fromisoformat(str(value or "").strip()[:10])
    except ValueError:
        raise pay.PayError(f"{field} must be a date (YYYY-MM-DD).")


def _by_id(model, value):
    try:
        return model.objects.filter(id=uuid.UUID(str(value))).first()
    except (ValueError, TypeError, AttributeError):
        return None


def _contractor(value) -> HubUser:
    user = _by_id(HubUser, value)
    if user is None or user.role != HubUser.Role.CONTRACTOR:
        raise pay.PayError("Choose a contractor.")
    return user


class _PayView(APIView):
    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsAdminRole()]
        return [IsAdminRole(), CanChangeContractorPay()]

    def handle_exception(self, exc):
        if isinstance(exc, pay.PayError):
            return _bad(str(exc))
        return super().handle_exception(exc)


class ContractorPayWeekView(_PayView):
    """GET /api/contractor-pay/?week=YYYY-MM-DD (any day in the week; default last week)."""

    def get(self, request):
        today = pay.toronto_today()
        day = _date(request.query_params["week"], "week") if request.query_params.get("week") else today - timedelta(days=7)
        ws = pay.week_start(day)
        we = ws + timedelta(days=6)
        rows = pay.build_rows(ws, we)
        week = HubPayWeek.objects.select_related("paid_by").filter(week_start=ws).first()
        contractors = HubUser.objects.filter(role=HubUser.Role.CONTRACTOR).order_by("name")
        return Response(
            {
                "week_start": ws.isoformat(),
                "week_end": we.isoformat(),
                "pay_day": (we + timedelta(days=6)).isoformat(),
                "paid": week is not None,
                "paid_at": week.paid_at.isoformat() if week else None,
                "paid_by": week.paid_by.name if week and week.paid_by else None,
                "can_edit": user_can_change_contractor_pay(request.user),
                "week_over": we < today,
                "rules": pay.RULES_TEXT,
                "summary": pay.summarize(rows),
                "rows": rows,
                "contractors": [
                    {
                        "id": str(c.id),
                        "name": c.name,
                        "status": c.status,
                        "percent": pay._s(c.contractor_percent),
                        "supplies_deduction": pay._s(c.supplies_deduction),
                    }
                    for c in contractors
                ],
            }
        )


class ContractorPayMarkPaidView(_PayView):
    """POST /api/contractor-pay/weeks/<YYYY-MM-DD>/paid/"""

    def post(self, request, week):
        pay.mark_week_paid(_date(week, "week"), request)
        return Response({"paid": True})


class ClientPayRulesView(_PayView):
    """GET: rules + clients seen on visits. POST: create or replace a client's rule."""

    def get(self, request):
        rules = HubClientPayRule.objects.select_related("changed_by")
        # One entry per client even if its name changed between visits.
        clients = (
            HubPayVisit.objects.exclude(client_jobber_id="")
            .values("client_jobber_id")
            .annotate(client_name=Max("client_name"), visits=Count("id"))
            .order_by("client_name")
        )
        return Response(
            {
                "rules": [
                    {
                        "id": str(r.id),
                        "client_jobber_id": r.client_jobber_id,
                        "client_name": r.client_name,
                        "rule": r.rule,
                        "fixed_amount": pay._s(r.fixed_amount),
                        "note": r.note,
                        "changed_by": r.changed_by.name if r.changed_by else None,
                        "updated_at": r.updated_at.isoformat(),
                    }
                    for r in rules
                ],
                "clients": list(clients),
            }
        )

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        client_id = str(data.get("client_jobber_id") or "").strip()
        if not client_id:
            raise pay.PayError("Choose a client.")
        rule = str(data.get("rule") or "")
        if rule not in HubClientPayRule.Rule.values:
            raise pay.PayError("Rule must be percent or fixed.")
        fixed = (
            _amount(data.get("fixed_amount"), "Fixed amount", allow_zero=False)
            if rule == HubClientPayRule.Rule.FIXED
            else None
        )
        name = str(data.get("client_name") or "").strip()[:255] or (
            HubPayVisit.objects.filter(client_jobber_id=client_id)
            .values_list("client_name", flat=True)
            .first()
            or ""
        )
        obj, created = HubClientPayRule.objects.update_or_create(
            client_jobber_id=client_id,
            defaults={
                "client_name": name,
                "rule": rule,
                "fixed_amount": fixed,
                "note": str(data.get("note") or "").strip(),
                "changed_by": pay.actor(request),
            },
        )
        pay.log_change(
            request,
            "client_rule.set",
            {"client": name, "client_jobber_id": client_id, "rule": rule, "fixed_amount": fixed},
        )
        return Response({"id": str(obj.id)}, status=status.HTTP_201_CREATED if created else 200)


class ClientPayRuleDetailView(_PayView):
    def delete(self, request, pk):
        rule = HubClientPayRule.objects.filter(id=pk).first()
        if rule is None:
            return _bad("Not found.", status.HTTP_404_NOT_FOUND)
        pay.log_change(
            request, "client_rule.removed", {"client": rule.client_name, "rule": rule.rule}
        )
        rule.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PayOverridesView(_PayView):
    """POST {visit_id, contractor_id, amount, reason}: set a contractor's pay on a visit."""

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        visit = _by_id(HubPayVisit, data.get("visit_id"))
        if visit is None:
            raise pay.PayError("Visit not found.")
        contractor = _contractor(data.get("contractor_id"))
        if not visit.assignees.filter(id=contractor.id).exists():
            raise pay.PayError("That contractor isn't on this visit.")
        amount = _amount(data.get("amount"), "Amount")
        reason = str(data.get("reason") or "").strip()
        if not reason:
            raise pay.PayError("Give a reason for the change.")
        pay.ensure_week_open(visit.visit_date)
        HubPayOverride.objects.update_or_create(
            visit=visit,
            contractor=contractor,
            defaults={"amount": amount, "reason": reason, "changed_by": pay.actor(request)},
        )
        pay.log_change(
            request,
            "override.set",
            {
                "visit": visit.jobber_visit_id,
                "client": visit.client_name,
                "date": visit.visit_date,
                "contractor": contractor.name,
                "amount": amount,
                "reason": reason,
            },
        )
        return Response({"saved": True})


class PayOverrideDetailView(_PayView):
    def delete(self, request, pk):
        override = HubPayOverride.objects.select_related("visit", "contractor").filter(id=pk).first()
        if override is None:
            return _bad("Not found.", status.HTTP_404_NOT_FOUND)
        pay.ensure_week_open(override.visit.visit_date)
        pay.log_change(
            request,
            "override.removed",
            {
                "visit": override.visit.jobber_visit_id,
                "contractor": override.contractor.name,
                "amount": override.amount,
            },
        )
        override.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class RestocksView(_PayView):
    """POST {contractor_id, amount, date, note}: a restock deduction for that date's week."""

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        contractor = _contractor(data.get("contractor_id"))
        amount = _amount(data.get("amount"), "Amount", allow_zero=False)
        day = _date(data.get("date"), "Date")
        note = str(data.get("note") or "").strip()
        if not note:
            raise pay.PayError("Say what was restocked.")
        pay.ensure_week_open(day)
        d = HubPayDeduction.objects.create(
            contractor=contractor, amount=amount, date=day, note=note, created_by=pay.actor(request)
        )
        pay.log_change(
            request,
            "restock.added",
            {"contractor": contractor.name, "amount": amount, "date": day, "note": note},
        )
        return Response({"id": str(d.id)}, status=status.HTTP_201_CREATED)


class RestockDetailView(_PayView):
    def delete(self, request, pk):
        d = HubPayDeduction.objects.select_related("contractor").filter(id=pk).first()
        if d is None:
            return _bad("Not found.", status.HTTP_404_NOT_FOUND)
        pay.ensure_week_open(d.date)
        pay.log_change(
            request,
            "restock.removed",
            {"contractor": d.contractor.name, "amount": d.amount, "date": d.date, "note": d.note},
        )
        d.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PayChangeLogView(_PayView):
    def get(self, request):
        entries = HubPayChangeLog.objects.select_related("changed_by")[:200]
        return Response(
            [
                {
                    "at": e.created_at.isoformat(),
                    "by": e.changed_by.name if e.changed_by else None,
                    "action": e.action,
                    "detail": e.detail,
                }
                for e in entries
            ]
        )
