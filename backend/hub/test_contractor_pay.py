from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from hub.models import (
    HubClientPayRule,
    HubPayAdjustment,
    HubPayChangeLog,
    HubPayDeduction,
    HubPayOverride,
    HubPayVisit,
    HubUser,
)
from hub.services import contractor_pay as pay
from hub.services.auth import tokens_for_hub_user

TODAY = date(2026, 11, 3)
WEEK = date(2026, 10, 18)  # Sunday; the week runs to Sat 24 Oct


def _client(user: HubUser) -> APIClient:
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(user)['access']}")
    return c


@patch("hub.services.contractor_pay.toronto_today", return_value=TODAY)
class ContractorPayTests(TestCase):
    def setUp(self):
        self.cara = HubUser.objects.create(
            name="Cara",
            role=HubUser.Role.CONTRACTOR,
            jobber_id="J-CARA",
            contractor_percent=Decimal("30"),
            supplies_deduction=Decimal("10"),
        )
        self.dan = HubUser.objects.create(
            name="Dan", role=HubUser.Role.CONTRACTOR, jobber_id="J-DAN", contractor_percent=Decimal("25")
        )
        self.emp = HubUser.objects.create(name="Emp", role=HubUser.Role.EMPLOYEE, jobber_id="J-EMP")
        self.peter = HubUser.objects.create(
            name="Peter", email="peter@test.local", role=HubUser.Role.ADMIN, can_change_contractor_pay=True
        )
        self.office = HubUser.objects.create(name="Office", email="office@test.local", role=HubUser.Role.ADMIN)

    def _visit(self, vid, people, extra_ids=(), **over):
        fields = {
            "visit_date": date(2026, 10, 20),
            "status": "COMPLETED",
            "client_jobber_id": "C-1",
            "client_name": "Client One",
            "visit_amount": Decimal("200"),
            "discount_share": Decimal("0"),
            "tip_share": Decimal("0"),
            "amount_rule": "invoice",
            **over,
        }
        v = HubPayVisit.objects.create(
            jobber_visit_id=vid, assigned_user_ids=[p.jobber_id for p in people] + list(extra_ids), **fields
        )
        v.assignees.set(people)
        return v

    def _rows(self, **filters):
        rows = pay.build_rows(WEEK, date(2026, 10, 24))
        return [r for r in rows if all(r.get(k) == val for k, val in filters.items())]

    def test_percent_split_by_everyone_on_visit_and_tips_on_top(self, _today):
        # Peter's example: 1 contractor with 3 employees gets a quarter of their %.
        self._visit("V1", [self.cara, self.emp], extra_ids=["J-X", "J-Y"], tip_share=Decimal("20"))
        pay_row = self._rows(type="pay")[0]
        self.assertEqual(pay_row["amount_paid"], "15.00")  # 200 × 30% ÷ 4
        self.assertEqual(pay_row["pay_rule"], "percent")
        self.assertEqual(self._rows(type="tip")[0]["amount_paid"], "5.00")  # 20 ÷ 4

    def test_highest_percent_after_discount_split_between_contractors(self, _today):
        self._visit("V1", [self.cara, self.dan], discount_share=Decimal("20"))
        amounts = {r["contractor_name"]: r["amount_paid"] for r in self._rows(type="pay")}
        self.assertEqual(amounts, {"Cara": "27.00", "Dan": "27.00"})  # 180 × 30% ÷ 2

    def test_fixed_client_rule_and_review_flag_cleared(self, _today):
        HubClientPayRule.objects.create(client_jobber_id="C-1", rule="fixed", fixed_amount=Decimal("100"))
        self._visit("V1", [self.cara, self.emp], amount_needs_review=True)
        row = self._rows(type="pay")[0]
        self.assertEqual((row["amount_paid"], row["pay_rule"]), ("50.00", "fixed"))
        self.assertNotIn("amount_needs_review", row["flags"])

    def test_not_completed_is_void_and_internal_has_no_price(self, _today):
        self._visit("V1", [self.cara], status="LATE")
        self._visit("V2", [self.dan], internal=True, visit_amount=Decimal("0"))
        late = self._rows(jobber_visit_id="V1", type="pay")[0]
        self.assertEqual((late["status"], late["amount_paid"]), ("void", "0.00"))
        internal = self._rows(jobber_visit_id="V2", type="pay")[0]
        self.assertEqual(internal["amount_paid"], "0.00")
        self.assertIn("no_price", internal["flags"])

    def test_supplies_only_in_weeks_worked_plus_restock(self, _today):
        self._visit("V1", [self.cara])
        HubPayDeduction.objects.create(
            contractor=self.cara, amount=Decimal("12.50"), date=date(2026, 10, 21), note="Mops"
        )
        rows = self._rows(contractor_name="Cara")
        supplies = [r for r in rows if r["type"] == "supplies_deduction"]
        self.assertEqual([(r["amount_paid"], r["date"]) for r in supplies], [("-10.00", "2026-10-24")])
        self.assertEqual([r["amount_paid"] for r in rows if r["type"] == "restock_deduction"], ["-12.50"])
        self.assertEqual(pay.summarize(rows)["by_contractor"][0]["total"], "37.50")  # 60 - 10 - 12.50

    def test_override_needs_pay_permission_and_is_logged(self, _today):
        v = self._visit("V1", [self.cara])
        body = {"visit_id": str(v.id), "contractor_id": str(self.cara.id), "amount": "80", "reason": "Agreed rate"}
        self.assertEqual(_client(self.office).post("/api/contractor-pay/overrides/", body, format="json").status_code, 403)
        r = _client(self.peter).post("/api/contractor-pay/overrides/", body, format="json")
        self.assertEqual(r.status_code, 200)
        row = self._rows(type="pay")[0]
        self.assertEqual((row["amount_paid"], row["calculated_amount"]), ("80.00", "60.00"))
        self.assertEqual((row["pay_rule"], row["changed_by"]), ("override", "Peter"))
        self.assertTrue(HubPayChangeLog.objects.filter(action="override.set").exists())
        # Reading is fine for any admin.
        self.assertEqual(_client(self.office).get(f"/api/contractor-pay/?week={WEEK}").status_code, 200)

    def test_paid_week_is_frozen_and_only_increases_become_adjustments(self, _today):
        v = self._visit("V1", [self.cara])
        r = _client(self.peter).post(f"/api/contractor-pay/weeks/{WEEK}/paid/")
        self.assertEqual(r.status_code, 200)

        # Invoice drops (discount added later): left alone.
        v.discount_share = Decimal("50")
        v.save()
        self.assertEqual(pay.record_late_changes(), 0)
        self.assertEqual(self._rows(type="pay")[0]["amount_paid"], "60.00")

        # Tip arrives and the invoice ends up higher: both paid as adjustments.
        v.discount_share = Decimal("0")
        v.visit_amount = Decimal("300")
        v.tip_share = Decimal("15")
        v.save()
        self.assertEqual(pay.record_late_changes(), 2)
        self.assertEqual(pay.record_late_changes(), 0)  # not added twice
        amounts = sorted(HubPayAdjustment.objects.values_list("amount", flat=True))
        self.assertEqual(amounts, [Decimal("15.00"), Decimal("30.00")])
        self.assertTrue(all(a.date == TODAY for a in HubPayAdjustment.objects.all()))
        adj = [r for r in pay.build_rows(TODAY, TODAY) if r["type"] == "adjustment"]
        self.assertEqual(len(adj), 2)
        self.assertFalse(adj[0]["week_paid"])

        # The paid week can't be changed.
        body = {"visit_id": str(v.id), "contractor_id": str(self.cara.id), "amount": "1", "reason": "x"}
        self.assertEqual(_client(self.peter).post("/api/contractor-pay/overrides/", body, format="json").status_code, 400)
        self.assertEqual(_client(self.peter).post(f"/api/contractor-pay/weeks/{WEEK}/paid/").status_code, 400)

    def test_cannot_pay_week_while_a_contractor_has_no_percent(self, _today):
        self.dan.contractor_percent = None
        self.dan.save()
        v = self._visit("V1", [self.dan])
        r = _client(self.peter).post(f"/api/contractor-pay/weeks/{WEEK}/paid/")
        self.assertEqual(r.status_code, 400)
        self.assertIn("Dan", r.json()["detail"])
        # An override settles it.
        HubPayOverride.objects.create(visit=v, contractor=self.dan, amount=Decimal("40"), reason="Agreed")
        self.assertEqual(_client(self.peter).post(f"/api/contractor-pay/weeks/{WEEK}/paid/").status_code, 200)

    def test_cannot_pay_unfinished_week(self, _today):
        r = _client(self.peter).post("/api/contractor-pay/weeks/2026-11-01/paid/")
        self.assertEqual(r.status_code, 400)

    def test_percent_on_user_needs_pay_permission(self, _today):
        url = f"/api/users/{self.cara.id}/"
        self.assertEqual(
            _client(self.office).patch(url, {"contractorPercent": "40"}, format="json").status_code, 400
        )
        # Saving the same value (e.g. editing the name) is fine.
        self.assertEqual(
            _client(self.office).patch(url, {"name": "Cara B", "contractorPercent": "30.00"}, format="json").status_code,
            200,
        )
        self.assertEqual(_client(self.peter).patch(url, {"contractorPercent": "40"}, format="json").status_code, 200)
        self.cara.refresh_from_db()
        self.assertEqual(self.cara.contractor_percent, Decimal("40"))
        self.assertTrue(HubPayChangeLog.objects.filter(action="user.contractor_percent").exists())

    def test_export_section(self, _today):
        from hub.services.analytics_extra import build_contractor_pay_section

        self._visit("V1", [self.cara])
        section = build_contractor_pay_section(WEEK, date(2026, 10, 24))
        self.assertTrue(section["available"])
        ids = [r["id"] for r in section["records"]]
        self.assertIn(f"pay:V1:{self.cara.id}", ids)
        self.assertIn(f"ded:supplies:{self.cara.id}:2026-10-18", ids)
        self.assertNotIn("basis", section["records"][0])
        self.assertEqual(HubPayOverride.objects.count(), 0)
