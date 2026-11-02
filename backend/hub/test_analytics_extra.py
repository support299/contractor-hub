from datetime import date
from decimal import Decimal

from django.test import TestCase

from hub.models import HubForm, HubFormSubmission, HubUser, HubWorkHours
from hub.services.analytics_extra import (
    build_cancellations_section,
    build_complaints_section,
    build_late_arrivals_section,
    build_reviews_section,
    build_work_hours_section,
)


def _form(slug, fields):
    return HubForm.objects.create(name=slug, slug=slug, fields=fields)


class ExtraSectionsTests(TestCase):
    def setUp(self):
        self.ana = HubUser.objects.create(name="Ana", jobber_id="J-ANA")
        self.ben = HubUser.objects.create(name="Ben")

    def test_reviews_both_forms_and_google(self):
        quick = _form(
            "how-are-we-doing",
            [
                {"id": "f_q0oxrx8g", "type": "single_line", "label": "Name"},
                {"id": "f_xtxrrtvv", "type": "star_rating", "label": "Rating"},
            ],
        )
        detailed = _form(
            "review-your-recent-experience",
            [
                {"id": "f_ff06eyjn", "type": "single_line", "label": "Name"},
                {"id": "f_s7corlm2", "type": "star_rating", "label": "Cleaners"},
                {"id": "f_wrkv1t9b", "type": "star_rating", "label": "Recommend"},
            ],
        )
        HubFormSubmission.objects.create(
            form=quick,
            answers={"f_q0oxrx8g": "Jo", "f_xtxrrtvv": "5", "f_1ypy9afk": [str(self.ana.id)]},
        )
        HubFormSubmission.objects.create(
            form=detailed,
            answers={
                "f_ff06eyjn": "Kim",
                "f_s7corlm2": "4",
                "f_wrkv1t9b": "3",
                "f_42oed41g": "Missed spots",
                "f_04r83638": ["Ben"],
            },
        )
        out = build_reviews_section(None, None)
        self.assertEqual(out["summary"]["total"], 2)
        self.assertEqual(out["summary"]["average_rating"], "4.50")
        by_name = {r["client_name"]: r for r in out["records"]}
        self.assertEqual(by_name["Jo"]["rating"], 5)
        self.assertEqual(by_name["Jo"]["cleaners"][0]["jobber_user_id"], "J-ANA")
        self.assertEqual(by_name["Kim"]["rating"], 4)
        self.assertEqual(by_name["Kim"]["recommend_rating"], 3)
        self.assertEqual(by_name["Kim"]["comment"], "Missed spots")
        self.assertIsNone(by_name["Kim"]["visit_date"])
        self.assertIsNone(by_name["Kim"]["cleaners"][0]["jobber_user_id"])

    def test_complaint_status_defaults_and_new_fields(self):
        form = _form(
            "new-complaint",
            [
                {"id": "f_co7nnoro", "type": "single_line", "label": "Client Name"},
                {"id": "f_ucnhpg8i", "type": "date", "label": "Date"},
                {"id": "f_new1", "type": "dropdown", "label": "Status"},
                {"id": "f_new2", "type": "date", "label": "Resolved date"},
            ],
        )
        HubFormSubmission.objects.create(
            form=form,
            answers={"f_co7nnoro": "A", "f_ucnhpg8i": "2026-10-01", "f_bd42zhds": ["Ana"]},
        )
        HubFormSubmission.objects.create(
            form=form,
            answers={"f_co7nnoro": "B", "f_new1": "In progress", "f_new2": "2026-10-05"},
        )
        recs = {r["client_name"]: r for r in build_complaints_section(None, None)["records"]}
        self.assertEqual(recs["A"]["status"], "open")
        self.assertEqual(recs["A"]["incident_date"], "2026-10-01")
        self.assertEqual(recs["A"]["team"][0]["name"], "Ana")
        self.assertEqual(recs["B"]["status"], "in_progress")
        self.assertEqual(recs["B"]["resolved_date"], "2026-10-05")

    def test_complaint_team_leader(self):
        form = _form(
            "new-complaint",
            [
                {"id": "f_co7nnoro", "type": "single_line", "label": "Client Name"},
                {"id": "f_lead", "type": "users", "label": "Team Leader"},
            ],
        )
        HubFormSubmission.objects.create(
            form=form, answers={"f_co7nnoro": "A", "f_lead": [str(self.ana.id)]}
        )
        HubFormSubmission.objects.create(form=form, answers={"f_co7nnoro": "B"})
        recs = {r["client_name"]: r for r in build_complaints_section(None, None)["records"]}
        self.assertEqual(recs["A"]["team_leader"]["name"], "Ana")
        self.assertEqual(recs["A"]["team_leader"]["jobber_user_id"], "J-ANA")
        self.assertIsNone(recs["B"]["team_leader"])

    def test_late_arrivals_only_late_type_filtered_by_late_date(self):
        form = _form(
            "new-absence",
            [
                {"id": "f_rhfm17h9", "type": "users", "label": "Technician"},
                {"id": "f_4a12y9ll", "type": "date", "label": "Date"},
                {"id": "f_vxzb7cc6", "type": "dropdown", "label": "Type"},
                {"id": "f_x61sk1qb", "type": "multi_line", "label": "Comment"},
            ],
        )
        for token, day, kind, comment in (
            ([str(self.ana.id)], "2026-10-05", "Late", "Traffic"),
            (["Ana", "Ben"], "2026-10-20", "Late", ""),
            ([str(self.ben.id)], "2026-10-06", "Sick", ""),
            ([str(self.ben.id)], "2026-10-07", "Absent", ""),
        ):
            HubFormSubmission.objects.create(
                form=form,
                answers={
                    "f_rhfm17h9": token,
                    "f_4a12y9ll": day,
                    "f_vxzb7cc6": kind,
                    "f_x61sk1qb": comment,
                },
            )

        out = build_late_arrivals_section(None, None)
        self.assertEqual(out["summary"]["total"], 3)
        self.assertEqual(out["summary"]["by_employee"], {"Ana": 2, "Ben": 1})
        self.assertEqual(len({r["id"] for r in out["records"]}), 3)

        # The period is the late date, even though everything was logged today.
        october = build_late_arrivals_section(date(2026, 10, 1), date(2026, 10, 10))
        self.assertEqual(len(october["records"]), 1)
        rec = october["records"][0]
        self.assertEqual(
            (rec["date"], rec["employee_name"], rec["jobber_user_id"], rec["comment"]),
            ("2026-10-05", "Ana", "J-ANA", "Traffic"),
        )

    def test_cancellation_sub_reasons_merged(self):
        form = _form(
            "service-cancellation-form",
            [{"id": "f_on1q7uad", "type": "single_line", "label": "Full Name"}],
        )
        HubFormSubmission.objects.create(
            form=form,
            answers={
                "f_on1q7uad": "Mary",
                "f_3vqldwsx": "Financial Reasons",
                "f_fazmz5r7": ["Price increased"],
                "f_t5ialee1": [],
            },
        )
        rec = build_cancellations_section(None, None)["records"][0]
        self.assertEqual(rec["sub_reasons"], ["Price increased"])
        self.assertEqual(rec["sub_reasons_by_group"], {"financial": ["Price increased"]})

    def test_work_hours_weekly_overtime(self):
        # Mon 2026-10-05 .. Fri: 9h regular + 1h drive each day = 10h/day → 50h week.
        for day in range(5, 10):
            HubWorkHours.objects.create(
                employee=self.ana,
                work_date=date(2026, 10, day),
                regular_hours=Decimal("9"),
                drive_time_hours=Decimal("1"),
            )
        out = build_work_hours_section(None, None)
        by_day = {r["date"]: r for r in out["records"]}
        self.assertEqual(by_day["2026-10-08"]["overtime_hours"], "0.00")  # 40h reached
        self.assertEqual(by_day["2026-10-09"]["overtime_hours"], "10.00")
        self.assertEqual(out["summary"]["overtime_hours"], "10.00")
        self.assertEqual(by_day["2026-10-09"]["hours_worked"], "10.00")

        # A range that starts mid-week still reports the right overtime.
        cut = build_work_hours_section(date(2026, 10, 9), date(2026, 10, 9))
        self.assertEqual(len(cut["records"]), 1)
        self.assertEqual(cut["records"][0]["overtime_hours"], "10.00")

    def test_general_hours_follow_team_leader_rule(self):
        lead = HubUser.objects.create(name="Lea", position="Team Leader")
        for user in (self.ben, lead):
            HubWorkHours.objects.create(
                employee=user,
                work_date=date(2026, 10, 5),
                regular_hours=Decimal("6"),
                drive_time_hours=Decimal("0.5"),
                general_hours=Decimal("1.25"),
            )
        by_name = {r["employee_name"]: r for r in build_work_hours_section(None, None)["records"]}
        ben, lea = by_name["Ben"], by_name["Lea"]
        self.assertEqual(
            (ben["regular_hours"], ben["drive_time_hours"], ben["general_counted_as"]),
            ("6.00", "1.75", "drive_time"),
        )
        self.assertEqual(
            (lea["regular_hours"], lea["drive_time_hours"], lea["general_counted_as"]),
            ("7.25", "0.50", "regular"),
        )
        self.assertEqual((ben["hours_worked"], lea["hours_worked"]), ("7.75", "7.75"))
        self.assertEqual(ben["general_hours"], "1.25")


from django.test import override_settings
from rest_framework.test import APIClient


@override_settings(HUB_INTERNAL_SECRET="s3cret")
class WorkHoursUpsertTests(TestCase):
    URL = "/api/internal/work-hours/upsert/"

    def setUp(self):
        self.ana = HubUser.objects.create(name="Ana", jobber_id="J-ANA")
        self.client_api = APIClient()

    def _post(self, body, secret="s3cret"):
        headers = {"HTTP_X_INTERNAL_SECRET": secret} if secret is not None else {}
        return self.client_api.post(self.URL, body, format="json", **headers)

    def test_rejects_missing_or_wrong_secret(self):
        self.assertEqual(self._post({"entries": []}, secret=None).status_code, 401)
        self.assertEqual(self._post({"entries": []}, secret="nope").status_code, 401)

    @override_settings(HUB_INTERNAL_SECRET="")
    def test_disabled_when_secret_not_configured(self):
        self.assertEqual(self._post({"entries": []}, secret="").status_code, 503)

    def test_upsert_overwrites_including_zero_and_reports_skipped(self):
        day = {"jobber_user_id": "J-ANA", "date": "2026-10-05"}
        r = self._post(
            {
                "entries": [
                    {
                        **day,
                        "regular_hours": "7.50",
                        "drive_time_hours": "1.25",
                        "general_hours": "0.75",
                    },
                    {"jobber_user_id": "J-NOBODY", "date": "2026-10-05", "regular_hours": "1"},
                    {**day, "date": "bad", "regular_hours": "1"},
                    {**day, "regular_hours": "99"},
                    {**day, "regular_hours": "1", "general_hours": "-1"},
                ]
            }
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["saved"], 1)
        self.assertEqual(r.json()["skipped_ids"], ["J-NOBODY"])
        self.assertEqual(len(r.json()["invalid"]), 3)
        row = HubWorkHours.objects.get()
        self.assertEqual(
            (row.regular_hours, row.drive_time_hours, row.general_hours),
            (Decimal("7.50"), Decimal("1.25"), Decimal("0.75")),
        )
        self.assertEqual(row.source, "jobber")

        # Re-sending zeros overwrites the day (entry deleted in Jobber). A sender that
        # predates general_hours leaves it out, which also resets it to 0.
        self._post({"entries": [{**day, "regular_hours": "0.00", "drive_time_hours": "0.00"}]})
        row.refresh_from_db()
        self.assertEqual(
            (row.regular_hours, row.drive_time_hours, row.general_hours),
            (Decimal("0"), Decimal("0"), Decimal("0")),
        )
        self.assertEqual(HubWorkHours.objects.count(), 1)

    def test_entries_must_be_a_list(self):
        self.assertEqual(self._post({"entries": "x"}).status_code, 400)
