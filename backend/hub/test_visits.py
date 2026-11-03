from decimal import Decimal

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from hub.models import HubUser, HubPayVisit


@override_settings(HUB_INTERNAL_SECRET="s3cret")
class VisitsUpsertTests(TestCase):
    URL = "/api/internal/visits/upsert/"

    def setUp(self):
        self.ana = HubUser.objects.create(name="Ana", jobber_id="J-ANA")
        self.bo = HubUser.objects.create(name="Bo", jobber_id="J-BO")
        self.client_api = APIClient()

    def _post(self, body, secret="s3cret"):
        headers = {"HTTP_X_INTERNAL_SECRET": secret} if secret is not None else {}
        return self.client_api.post(self.URL, body, format="json", **headers)

    def _visit(self, **over):
        return {
            "jobber_visit_id": "V-1",
            "jobber_job_id": "JOB-1",
            "job_number": "3202",
            "job_title": "Bi-Weekly Cleaning",
            "client_jobber_id": "C-1",
            "client_name": "Chantal SFM",
            "date": "2026-10-20",
            "status": "COMPLETED",
            "completed_at": "2026-10-20T15:30:00Z",
            "assigned_user_ids": ["J-ANA", "J-BO", "J-NOBODY"],
            "visit_amount": "200.00",
            "discount_share": "20.00",
            "tip_share": "10.00",
            "line_items_total": "229.00",
            "invoice_id": "INV-1",
            "invoice_subtotal": "400.00",
            "invoice_discount": "40.00",
            "invoice_tips": "20.00",
            "amount_rule": "invoice_share",
            "amount_is_estimate": False,
            "amount_needs_review": False,
            "internal": False,
            **over,
        }

    def test_rejects_missing_or_wrong_secret(self):
        self.assertEqual(self._post({"entries": []}, secret=None).status_code, 401)
        self.assertEqual(self._post({"entries": []}, secret="nope").status_code, 401)

    @override_settings(HUB_INTERNAL_SECRET="")
    def test_disabled_when_secret_not_configured(self):
        self.assertEqual(self._post({"entries": []}, secret="").status_code, 503)

    def test_entries_must_be_a_list(self):
        self.assertEqual(self._post({"entries": "x"}).status_code, 400)

    def test_saves_visit_with_known_assignees_and_reports_unknown(self):
        r = self._post({"entries": [self._visit()]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"saved": 1, "unknown_user_ids": ["J-NOBODY"], "invalid": []})
        v = HubPayVisit.objects.get()
        self.assertEqual(v.status, "COMPLETED")
        self.assertEqual(v.amount_rule, "invoice_share")
        self.assertEqual(
            (v.visit_amount, v.discount_share, v.tip_share),
            (Decimal("200.00"), Decimal("20.00"), Decimal("10.00")),
        )
        self.assertEqual(v.invoice_subtotal, Decimal("400.00"))
        self.assertIsNotNone(v.completed_at)
        # Headcount keeps the unknown person; assignees only the Hub users.
        self.assertEqual(len(v.assigned_user_ids), 3)
        self.assertEqual(set(v.assignees.all()), {self.ana, self.bo})

    def test_resend_overwrites_and_deleted_visit_is_kept(self):
        self._post({"entries": [self._visit()]})
        r = self._post(
            {
                "entries": [
                    self._visit(
                        status="deleted",
                        completed_at=None,
                        assigned_user_ids=["J-ANA"],
                        visit_amount="0.00",
                        discount_share="0.00",
                        tip_share="0.00",
                        invoice_id="",
                        invoice_subtotal=None,
                        invoice_discount=None,
                        invoice_tips=None,
                        amount_rule="job_price",
                    )
                ]
            }
        )
        self.assertEqual(r.json()["saved"], 1)
        v = HubPayVisit.objects.get()
        self.assertEqual(v.status, "DELETED")
        self.assertEqual(v.visit_amount, Decimal("0"))
        self.assertIsNone(v.invoice_subtotal)
        self.assertIsNone(v.completed_at)
        self.assertEqual(list(v.assignees.all()), [self.ana])

    def test_invalid_entries_are_reported_and_skipped(self):
        r = self._post(
            {
                "entries": [
                    self._visit(jobber_visit_id=""),
                    self._visit(jobber_visit_id="V-2", date="bad"),
                    self._visit(jobber_visit_id="V-3", status="DONE"),
                    self._visit(jobber_visit_id="V-4", amount_rule="guess"),
                    self._visit(jobber_visit_id="V-5", visit_amount="-1"),
                    self._visit(jobber_visit_id="V-6", internal="yes"),
                    self._visit(jobber_visit_id="V-7", assigned_user_ids="J-ANA"),
                    self._visit(jobber_visit_id="V-8", completed_at="soon"),
                    self._visit(jobber_visit_id="V-9"),
                ]
            }
        )
        self.assertEqual(r.json()["saved"], 1)
        self.assertEqual([e["index"] for e in r.json()["invalid"]], list(range(8)))
        self.assertEqual(list(HubPayVisit.objects.values_list("jobber_visit_id", flat=True)), ["V-9"])
