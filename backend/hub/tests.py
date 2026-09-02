from datetime import date
from decimal import Decimal

from django.test import SimpleTestCase, TestCase

from hub.services.vacation import (
    VACATION_DAYS_ALLOTMENT,
    anniversary_on_or_before,
    count_weekdays,
    eligibility_date,
    is_vacation_eligible,
)


class WeekdayCountTests(SimpleTestCase):
    def test_mon_to_following_mon_is_six(self):
        # 2026-08-10 Mon → 2026-08-17 Mon
        self.assertEqual(count_weekdays(date(2026, 8, 10), date(2026, 8, 17)), 6)

    def test_mon_to_fri_is_five(self):
        self.assertEqual(count_weekdays(date(2026, 8, 10), date(2026, 8, 14)), 5)

    def test_weekend_only_is_zero(self):
        self.assertEqual(count_weekdays(date(2026, 8, 15), date(2026, 8, 16)), 0)


class EligibilityTests(SimpleTestCase):
    def test_not_eligible_before_anniversary(self):
        hire = date(2025, 8, 13)
        self.assertFalse(is_vacation_eligible(hire, date(2026, 8, 12)))
        self.assertTrue(is_vacation_eligible(hire, date(2026, 8, 13)))
        self.assertEqual(eligibility_date(hire), date(2026, 8, 13))

    def test_anniversary_on_or_before(self):
        hire = date(2024, 6, 1)
        self.assertEqual(anniversary_on_or_before(hire, date(2026, 5, 31)), date(2025, 6, 1))
        self.assertEqual(anniversary_on_or_before(hire, date(2026, 6, 1)), date(2026, 6, 1))


class VacationResetTests(TestCase):
    def test_hard_reset_to_ten(self):
        from hub.models import HubUser
        from hub.services.vacation import ensure_vacation_balance_current

        user = HubUser.objects.create(
            name="Test",
            hire_date=date(2024, 1, 1),
            available_vacation_days=Decimal("3"),
            vacation_balance_reset_on=date(2025, 1, 1),
        )
        changed = ensure_vacation_balance_current(user, on_date=date(2026, 1, 1))
        user.refresh_from_db()
        self.assertTrue(changed)
        self.assertEqual(user.available_vacation_days, VACATION_DAYS_ALLOTMENT)
        self.assertEqual(user.vacation_balance_reset_on, date(2026, 1, 1))


LEAVE_FIELDS = [
    {"id": "u", "type": "users", "label": "Staff"},
    {"id": "s", "type": "date", "label": "Start date"},
    {"id": "e", "type": "date", "label": "End date"},
    {"id": "t", "type": "dropdown", "label": "Leave type"},
]


class LeaveDateFormatTests(SimpleTestCase):
    def test_same_month_range(self):
        from hub.services.leave_notify import format_leave_dates

        self.assertEqual(
            format_leave_dates(date(2026, 8, 10), date(2026, 8, 17)),
            "Aug 10–17",
        )

    def test_single_day(self):
        from hub.services.leave_notify import format_leave_dates

        self.assertEqual(format_leave_dates(date(2026, 8, 10), date(2026, 8, 10)), "Aug 10")


class LeaveNotificationTests(TestCase):
    def setUp(self):
        from hub.models import HubForm, HubUser

        self.admin = HubUser.objects.create(
            name="Admin One",
            email="admin1@test.local",
            role=HubUser.Role.ADMIN,
            status=HubUser.Status.ACTIVE,
        )
        self.inactive_admin = HubUser.objects.create(
            name="Old Admin",
            email="old@test.local",
            role=HubUser.Role.ADMIN,
            status=HubUser.Status.INACTIVE,
        )
        self.employee = HubUser.objects.create(
            name="Jane Doe",
            email="jane@test.local",
            role=HubUser.Role.EMPLOYEE,
            status=HubUser.Status.ACTIVE,
        )
        self.form = HubForm.objects.create(
            name="Request Time Off",
            slug="request-time-off",
            fields=LEAVE_FIELDS,
        )

    def _submit(self, **answers):
        from hub.models import HubFormSubmission

        defaults = {
            "u": [str(self.employee.id)],
            "s": "2026-08-10",
            "e": "2026-08-17",
            "t": "Vacation",
        }
        defaults.update(answers)
        return HubFormSubmission.objects.create(form=self.form, answers=defaults)

    def test_submit_notifies_active_admins_only(self):
        from hub.models import HubLeaveApproval, HubNotification
        from hub.services.leave_notify import notify_leave_submitted

        sub = self._submit()
        HubLeaveApproval.objects.get_or_create(submission=sub)
        notify_leave_submitted(sub)
        notify_leave_submitted(sub)
        qs = HubNotification.objects.filter(type="leave_submitted")
        self.assertEqual(qs.count(), 1)
        n = qs.get()
        self.assertEqual(n.recipient_id, self.admin.id)
        self.assertIn("Jane Doe submitted a Vacation request (Aug 10–17)", n.body)
        self.assertEqual(n.link, "/admin/calendar")

    def test_approve_notifies_employee_once(self):
        from hub.models import HubLeaveApproval, HubNotification
        from hub.services.leave_notify import notify_leave_decision

        sub = self._submit()
        approval = HubLeaveApproval.objects.create(submission=sub)
        approval.status = HubLeaveApproval.Status.APPROVED
        approval.save()
        notify_leave_decision(approval, HubLeaveApproval.Status.PENDING)
        notify_leave_decision(approval, HubLeaveApproval.Status.PENDING)
        qs = HubNotification.objects.filter(type="leave_approved")
        self.assertEqual(qs.count(), 1)
        self.assertEqual(qs.get().recipient_id, self.employee.id)
        self.assertEqual(
            qs.get().body,
            "Your Vacation request (Aug 10–17) was approved.",
        )

    def test_reject_copy(self):
        from hub.models import HubLeaveApproval, HubNotification
        from hub.services.leave_notify import notify_leave_decision

        sub = self._submit(t="Absent", e="2026-08-12")
        approval = HubLeaveApproval.objects.create(
            submission=sub, status=HubLeaveApproval.Status.REJECTED
        )
        notify_leave_decision(approval, HubLeaveApproval.Status.PENDING)
        n = HubNotification.objects.get(type="leave_rejected")
        self.assertEqual(n.body, "Your Absent request (Aug 10–12) was rejected.")

    def test_same_status_patch_skips(self):
        from hub.models import HubLeaveApproval, HubNotification
        from hub.services.leave_notify import notify_leave_decision

        sub = self._submit()
        approval = HubLeaveApproval.objects.create(
            submission=sub, status=HubLeaveApproval.Status.APPROVED
        )
        notify_leave_decision(approval, HubLeaveApproval.Status.APPROVED)
        self.assertEqual(HubNotification.objects.count(), 0)


class NotificationApiTests(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient

        from hub.models import HubNotification, HubUser
        from hub.services.auth import tokens_for_hub_user

        self.user = HubUser.objects.create(
            name="Staff",
            email="staff@test.local",
            role=HubUser.Role.EMPLOYEE,
        )
        other = HubUser.objects.create(
            name="Other",
            email="other@test.local",
            role=HubUser.Role.EMPLOYEE,
        )
        HubNotification.objects.create(
            recipient=self.user,
            type="leave_approved",
            title="Leave approved",
            body="Your Vacation request was approved.",
        )
        HubNotification.objects.create(
            recipient=other,
            type="leave_approved",
            title="Nope",
            body="Not yours.",
        )
        tokens = tokens_for_hub_user(self.user)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    def test_list_own_only_and_mark_read(self):
        res = self.client.get("/api/notifications/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["count"], 1)
        self.assertEqual(res.data["unreadCount"], 1)
        nid = res.data["results"][0]["id"]
        read = self.client.post(f"/api/notifications/{nid}/read/")
        self.assertEqual(read.status_code, 200)
        self.assertIsNotNone(read.data["readAt"])
        count = self.client.get("/api/notifications/unread-count/")
        self.assertEqual(count.data["unreadCount"], 0)

    def test_clear_all_deletes_own_only(self):
        from hub.models import HubNotification

        res = self.client.post("/api/notifications/clear-all/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["deleted"], 1)
        self.assertEqual(
            HubNotification.objects.filter(recipient=self.user).count(), 0
        )
        self.assertEqual(HubNotification.objects.count(), 1)


class LeaveApprovalPermissionTests(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient

        from hub.models import HubForm, HubFormSubmission, HubLeaveApproval, HubUser
        from hub.services.auth import tokens_for_hub_user

        self.admin = HubUser.objects.create(
            name="Admin",
            email="admin-leave@test.local",
            role=HubUser.Role.ADMIN,
        )
        self.employee = HubUser.objects.create(
            name="Staff",
            email="staff-leave@test.local",
            role=HubUser.Role.EMPLOYEE,
        )
        form = HubForm.objects.create(
            name="Request Time Off",
            slug="request-time-off",
            fields=LEAVE_FIELDS,
        )
        sub = HubFormSubmission.objects.create(
            form=form,
            answers={
                "u": [str(self.employee.id)],
                "s": "2026-08-10",
                "e": "2026-08-12",
                "t": "Absent",
            },
        )
        self.approval = HubLeaveApproval.objects.create(submission=sub)
        self.url = f"/api/leave-approvals/{sub.id}/"
        self.admin_client = APIClient()
        self.admin_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.admin)['access']}"
        )
        self.staff_client = APIClient()
        self.staff_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.employee)['access']}"
        )

    def test_staff_can_list_but_cannot_approve(self):
        listed = self.staff_client.get("/api/leave-approvals/")
        self.assertEqual(listed.status_code, 200)
        denied = self.staff_client.patch(
            self.url, {"status": "approved"}, format="json"
        )
        self.assertEqual(denied.status_code, 403)
        self.approval.refresh_from_db()
        self.assertEqual(self.approval.status, "pending")

    def test_admin_can_reject(self):
        res = self.admin_client.patch(
            self.url, {"status": "rejected"}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.approval.refresh_from_db()
        self.assertEqual(self.approval.status, "rejected")


class LockInPositionAmountTests(SimpleTestCase):
    def test_canonical_amounts(self):
        from hub.models import lock_in_bonus_amount

        pos, amt = lock_in_bonus_amount("Team Leader")
        self.assertEqual(pos, "Team Leader")
        self.assertEqual(amt, Decimal("20"))
        pos, amt = lock_in_bonus_amount("cleaning technician")
        self.assertEqual(pos, "Cleaning Technician")
        self.assertEqual(amt, Decimal("10"))

    def test_unknown_is_zero(self):
        from hub.models import lock_in_bonus_amount

        pos, amt = lock_in_bonus_amount("Marketing Manager")
        self.assertEqual(amt, Decimal("0"))
        self.assertEqual(pos, "Marketing Manager")


from rest_framework.test import APIClient as _APIClient


class LockInFlowTests(TestCase):
    def setUp(self):
        from hub.models import HubUser

        self.tech = HubUser.objects.create(
            name="Alex Tech",
            phone="+15551212",
            position="Cleaning Technician",
            jobber_id="jb_user_1",
        )
        self.lead = HubUser.objects.create(
            name="Pat Lead",
            phone="+15551313",
            position="Team Leader",
            jobber_id="jb_user_2",
        )
        self.client_api = _APIClient()

    def test_upsert_visit_and_stage1_idempotent(self):
        up = self.client_api.post(
            "/api/internal/lock-in/visits/upsert/",
            {
                "jobber_visit_id": "v1",
                "title": "First Cleaning",
                "client_id": "c1",
                "client_name": "Jane",
                "job_id": "job_fc",
                "job_type": "ONE_OFF",
                "assignee_jobber_ids": ["jb_user_1", "jb_user_2"],
            },
            format="json",
        )
        self.assertEqual(up.status_code, 200)
        self.assertEqual(len(up.data["technicians"]), 2)

        payload = {
            "quote_id": "q1",
            "client_id": "c1",
            "client_name": "Jane",
            "job_id": "job_recurring",
            "original_visit_ids": ["v1"],
            "frequency": "Weekly",
            "technician_jobber_ids": ["jb_user_1", "jb_user_2"],
        }
        a = self.client_api.post(
            "/api/internal/lock-in/pending/", payload, format="json"
        )
        self.assertEqual(a.status_code, 201)
        self.assertTrue(a.data["created"])
        self.assertEqual(len(a.data["pending"]["bonuses"]), 2)
        amounts = sorted(b["amount"] for b in a.data["pending"]["bonuses"])
        self.assertEqual(amounts, ["10.00", "20.00"])

        from hub.models import HubNotification

        pots = HubNotification.objects.filter(type="lock_in_potential")
        self.assertEqual(pots.count(), 2)
        bodies = sorted(pots.values_list("body", flat=True))
        self.assertTrue(any("$10" in b and "Weekly" in b and "Jane" in b for b in bodies))
        self.assertTrue(any("$20" in b for b in bodies))
        self.assertEqual(
            set(pots.values_list("recipient_id", flat=True)),
            {self.tech.id, self.lead.id},
        )

        b = self.client_api.post(
            "/api/internal/lock-in/pending/", payload, format="json"
        )
        self.assertEqual(b.status_code, 200)
        self.assertFalse(b.data["created"])
        self.assertEqual(a.data["pending"]["id"], b.data["pending"]["id"])
        self.assertEqual(HubNotification.objects.filter(type="lock_in_potential").count(), 2)

        # Rule 1: another quote same first-clean visit
        c = self.client_api.post(
            "/api/internal/lock-in/pending/",
            {**payload, "quote_id": "q2"},
            format="json",
        )
        self.assertFalse(c.data["created"])
        self.assertEqual(c.data["pending"]["quote_id"], "q1")

    def test_confirm_then_duplicate_stays_confirmed(self):
        self.client_api.post(
            "/api/internal/lock-in/pending/",
            {
                "quote_id": "q1",
                "client_id": "c1",
                "client_name": "Jane",
                "job_id": "job_r",
                "technician_jobber_ids": ["jb_user_1"],
            },
            format="json",
        )
        lookup = self.client_api.get(
            "/api/internal/lock-in/pending/lookup/?client_id=c1&job_id=job_r",
        )
        pk = lookup.data["pending"]["id"]
        first = self.client_api.post(
            f"/api/internal/lock-in/pending/{pk}/confirm/",
            {"visit_id": "rv1"},
            format="json",
        )
        self.assertTrue(first.data["pending"]["locked_in"])
        self.assertEqual(first.data["pending"]["status"], "confirmed")
        self.assertEqual(first.data["pending"]["bonuses"][0]["status"], "confirmed")

        from hub.models import HubNotification

        confirmed = HubNotification.objects.filter(type="lock_in_confirmed")
        self.assertEqual(confirmed.count(), 1)
        self.assertEqual(confirmed.get().recipient_id, self.tech.id)
        self.assertIn("$10", confirmed.get().body)
        self.assertIn("Jane", confirmed.get().body)

        second = self.client_api.post(
            f"/api/internal/lock-in/pending/{pk}/confirm/",
            {"visit_id": "rv2"},
            format="json",
        )
        self.assertEqual(second.data["pending"]["first_recurring_visit_id"], "rv1")
        self.assertEqual(HubNotification.objects.filter(type="lock_in_confirmed").count(), 1)
        lookup2 = self.client_api.get(
            "/api/internal/lock-in/pending/lookup/?client_id=c1",
        )
        self.assertIsNone(lookup2.data["pending"])

    def test_expire(self):
        res = self.client_api.post(
            "/api/internal/lock-in/pending/",
            {
                "quote_id": "q1",
                "client_id": "c1",
                "client_name": "Jane",
                "technician_jobber_ids": ["jb_user_1"],
            },
            format="json",
        )
        pk = res.data["pending"]["id"]
        exp = self.client_api.post(
            f"/api/internal/lock-in/pending/{pk}/expire/",
            {"reason": "Eligibility Period Exceeded"},
            format="json",
        )
        self.assertEqual(exp.data["pending"]["status"], "expired")
        self.assertEqual(exp.data["pending"]["bonuses"][0]["status"], "expired")
        from hub.models import HubNotification

        self.assertEqual(HubNotification.objects.filter(type="lock_in_confirmed").count(), 0)

    def test_patch_attaches_job_id(self):
        res = self.client_api.post(
            "/api/internal/lock-in/pending/",
            {
                "quote_id": "q1",
                "client_id": "c1",
                "client_name": "Jane",
                "technician_jobber_ids": ["jb_user_1"],
            },
            format="json",
        )
        pk = res.data["pending"]["id"]
        self.assertEqual(res.data["pending"]["job_id"], "")
        patched = self.client_api.patch(
            f"/api/internal/lock-in/pending/{pk}/",
            {"job_id": "job_r", "frequency": "Bi-weekly"},
            format="json",
        )
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.data["pending"]["job_id"], "job_r")
        self.assertEqual(patched.data["pending"]["frequency"], "Bi-weekly")


class PublicUserDirectoryTests(TestCase):
    def test_anonymous_gets_active_names_and_pictures_only(self):
        from rest_framework.test import APIClient

        from hub.models import HubUser

        HubUser.objects.create(
            name="Active Tech",
            email="a@example.com",
            phone="555",
            regular_rate=Decimal("25"),
            picture="https://example.com/a.jpg",
            status=HubUser.Status.ACTIVE,
        )
        HubUser.objects.create(
            name="Inactive Tech",
            picture="https://example.com/i.jpg",
            status=HubUser.Status.INACTIVE,
        )

        res = APIClient().get("/api/users/directory/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        row = res.data[0]
        self.assertEqual(row["name"], "Active Tech")
        self.assertEqual(row["picture"], "https://example.com/a.jpg")
        self.assertEqual(set(row.keys()), {"id", "name", "picture"})
        self.assertNotIn("email", row)
        self.assertNotIn("regularRate", row)

    def test_full_user_list_still_requires_auth(self):
        from rest_framework.test import APIClient

        res = APIClient().get("/api/users/")
        self.assertEqual(res.status_code, 401)


TIPS_FIELDS = [
    {"id": "c", "type": "single_line", "label": "Client's Name"},
    {"id": "a", "type": "number", "label": "Tip per Technician"},
    {"id": "m", "type": "dropdown", "label": "Method"},
    {"id": "p", "type": "date", "label": "Paid Date"},
    {"id": "v", "type": "date", "label": "Visit Date"},
    {"id": "t", "type": "users", "label": "Technician(s)"},
    {"id": "q", "type": "radio", "label": "Confirm Tip", "options": ["Yes"]},
]


class TipConfirmParseTests(SimpleTestCase):
    def test_yes_like_values(self):
        from hub.services.tip_confirm import is_confirmed_value

        for val in ("Yes", "yes", "true", "Confirmed", True, "1"):
            self.assertTrue(is_confirmed_value(val), val)
        for val in ("", None, "No", False, "pending"):
            self.assertFalse(is_confirmed_value(val), val)

    def test_amount_format(self):
        from hub.services.tip_confirm import format_tip_amount

        self.assertEqual(format_tip_amount("25"), "25")
        self.assertEqual(format_tip_amount("$25.00"), "25")
        self.assertEqual(format_tip_amount("12.5"), "12.50")


class TipConfirmAutomationTests(TestCase):
    def setUp(self):
        from hub.models import HubForm, HubUser

        self.form = HubForm.objects.create(
            name="New Tips",
            slug="new-tips",
            fields=TIPS_FIELDS,
        )
        self.tech1 = HubUser.objects.create(
            name="Alex Cleaner",
            phone="+15551111",
            ghl_id="ghl_1",
            role=HubUser.Role.EMPLOYEE,
        )
        self.tech2 = HubUser.objects.create(
            name="Pat Lead",
            phone="+15552222",
            ghl_id="ghl_2",
            role=HubUser.Role.EMPLOYEE,
        )

    def _answers(self, confirm="", extra=None):
        data = {
            "c": "Jane Client",
            "a": 25,
            "m": "Cash",
            "p": "2026-08-20",
            "v": "2026-08-19",
            "t": [str(self.tech1.id), str(self.tech2.id)],
            "q": confirm,
        }
        if extra:
            data.update(extra)
        return data

    def test_unconfirmed_does_not_notify_or_sms(self):
        from unittest.mock import patch

        from hub.models import HubFormSubmission, HubNotification, HubTipConfirmLog
        from hub.services.tip_confirm import maybe_run_tip_confirm

        sub = HubFormSubmission.objects.create(
            form=self.form, answers=self._answers("")
        )
        with patch("hub.services.tip_confirm.send_conversation_sms") as sms:
            ran = maybe_run_tip_confirm(sub)
        self.assertFalse(ran)
        sms.assert_not_called()
        self.assertEqual(HubNotification.objects.count(), 0)
        self.assertFalse(HubTipConfirmLog.objects.filter(submission=sub).exists())

    def test_confirmed_notifies_and_sms_once_per_cleaner(self):
        from unittest.mock import patch

        from hub.models import HubFormSubmission, HubNotification, HubTipConfirmLog
        from hub.services.tip_confirm import maybe_run_tip_confirm

        sub = HubFormSubmission.objects.create(
            form=self.form, answers=self._answers("Yes")
        )
        with patch(
            "hub.services.tip_confirm.send_conversation_sms", return_value=True
        ) as sms:
            self.assertTrue(maybe_run_tip_confirm(sub))
            self.assertFalse(maybe_run_tip_confirm(sub))
            sms_count = sms.call_count
            maybe_run_tip_confirm(sub)
            self.assertEqual(sms.call_count, sms_count)

        self.assertEqual(sms_count, 2)
        bodies = [c.args[1] for c in sms.call_args_list]
        self.assertTrue(any("Alex" in b and "$25" in b and "Jane Client" in b for b in bodies))
        self.assertTrue(any("Pat" in b for b in bodies))

        qs = HubNotification.objects.filter(type="tip_confirmed")
        self.assertEqual(qs.count(), 2)
        self.assertEqual(
            set(qs.values_list("recipient_id", flat=True)),
            {self.tech1.id, self.tech2.id},
        )
        n = qs.filter(recipient=self.tech1).get()
        self.assertEqual(n.title, "New Tip! 🎉")
        self.assertEqual(n.body, "You received a $25 tip from Jane Client.")
        self.assertEqual(n.link, "/admin/data")
        self.assertTrue(HubTipConfirmLog.objects.filter(submission=sub).exists())

    def test_create_then_confirm_via_api(self):
        from unittest.mock import patch

        from rest_framework.test import APIClient

        from hub.models import HubNotification, HubTipConfirmLog, HubUser
        from hub.services.auth import tokens_for_hub_user

        admin = HubUser.objects.create(
            name="Admin",
            email="admin-tips@test.local",
            role=HubUser.Role.ADMIN,
        )
        anon = APIClient()
        with patch(
            "hub.services.tip_confirm.send_conversation_sms", return_value=True
        ) as sms:
            created = anon.post(
                "/api/submissions/",
                {"formId": str(self.form.id), "answers": self._answers("")},
                format="json",
            )
            self.assertEqual(created.status_code, 201)
            sid = created.data["id"]
            self.assertEqual(sms.call_count, 0)
            self.assertEqual(HubNotification.objects.count(), 0)

            authed = APIClient()
            authed.credentials(
                HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(admin)['access']}"
            )
            patched = authed.patch(
                f"/api/submissions/{sid}/",
                {"answers": self._answers("Yes")},
                format="json",
            )
            self.assertEqual(patched.status_code, 200)
            self.assertEqual(sms.call_count, 2)

            again = authed.patch(
                f"/api/submissions/{sid}/",
                {"answers": self._answers("Yes")},
                format="json",
            )
            self.assertEqual(again.status_code, 200)
            self.assertEqual(sms.call_count, 2)

        self.assertEqual(HubNotification.objects.filter(type="tip_confirmed").count(), 2)
        self.assertTrue(HubTipConfirmLog.objects.filter(submission_id=sid).exists())

    def test_name_fallback_slug(self):
        from unittest.mock import patch

        from hub.models import HubForm, HubFormSubmission, HubNotification
        from hub.services.tip_confirm import maybe_run_tip_confirm

        form = HubForm.objects.create(
            name="New Tips",
            slug="tips-intake",
            fields=TIPS_FIELDS,
        )
        sub = HubFormSubmission.objects.create(
            form=form, answers=self._answers("Yes")
        )
        with patch(
            "hub.services.tip_confirm.send_conversation_sms", return_value=True
        ):
            self.assertTrue(maybe_run_tip_confirm(sub))
        self.assertEqual(HubNotification.objects.filter(type="tip_confirmed").count(), 2)


class PhoneFromContactTests(SimpleTestCase):
    def test_primary_phone(self):
        from hub.services.ghl import phone_from_contact

        self.assertEqual(phone_from_contact({"phone": " +15551212 "}), "+15551212")

    def test_additional_phones_fallback(self):
        from hub.services.ghl import phone_from_contact

        self.assertEqual(
            phone_from_contact(
                {"phone": "", "additionalPhones": [{"phone": "+15559999"}]}
            ),
            "+15559999",
        )


class SyncEmployeePhonesFromGhlTests(TestCase):
    def setUp(self):
        from hub.models import HubUser

        self.employee = HubUser.objects.create(
            name="Alex Cleaner",
            email="alex@example.com",
            role=HubUser.Role.EMPLOYEE,
        )
        self.no_email = HubUser.objects.create(
            name="No Mail",
            email="",
            role=HubUser.Role.EMPLOYEE,
        )
        self.contractor = HubUser.objects.create(
            name="Pat Contractor",
            email="pat@example.com",
            role=HubUser.Role.CONTRACTOR,
        )

    def test_skips_no_email_and_non_employees(self):
        from io import StringIO
        from unittest.mock import patch

        from django.core.management import call_command

        with patch(
            "hub.management.commands.sync_employee_phones_from_ghl.search_contact_by_email",
            return_value={"id": "c1", "email": "alex@example.com", "phone": "+15551111"},
        ) as search:
            out = StringIO()
            call_command("sync_employee_phones_from_ghl", stdout=out)

        self.employee.refresh_from_db()
        self.no_email.refresh_from_db()
        self.contractor.refresh_from_db()
        self.assertEqual(self.employee.phone, "+15551111")
        self.assertEqual(self.employee.ghl_id, "c1")
        self.assertEqual(self.no_email.phone, "")
        self.assertEqual(self.contractor.phone, "")
        search.assert_called_once_with("alex@example.com")


class GhlEmailLoginTests(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient

        from hub.models import HubUser

        self.client = APIClient()
        self.staff = HubUser.objects.create(
            name="Serina Peluso",
            email="serina@test.local",
            role=HubUser.Role.EMPLOYEE,
            status=HubUser.Status.ACTIVE,
        )
        self.admin = HubUser.objects.create(
            name="Hub Admin",
            email="admin@test.local",
            role=HubUser.Role.ADMIN,
            status=HubUser.Status.ACTIVE,
        )
        HubUser.objects.create(
            name="Inactive",
            email="gone@test.local",
            role=HubUser.Role.EMPLOYEE,
            status=HubUser.Status.INACTIVE,
        )

    def test_logs_in_staff_and_admin_by_email(self):
        staff = self.client.post(
            "/api/auth/ghl-email-login/",
            {"email": "Serina@test.local"},
            format="json",
        )
        self.assertEqual(staff.status_code, 200)
        self.assertIn("access", staff.data)
        self.assertEqual(staff.data["user"]["email"], "serina@test.local")
        self.assertEqual(staff.data["user"]["role"], "employee")

        admin = self.client.post(
            "/api/auth/ghl-email-login/",
            {"email": "admin@test.local"},
            format="json",
        )
        self.assertEqual(admin.status_code, 200)
        self.assertEqual(admin.data["user"]["role"], "admin")

    def test_unknown_or_inactive_falls_back(self):
        missing = self.client.post(
            "/api/auth/ghl-email-login/",
            {"email": "nobody@test.local"},
            format="json",
        )
        self.assertEqual(missing.status_code, 404)
        inactive = self.client.post(
            "/api/auth/ghl-email-login/",
            {"email": "gone@test.local"},
            format="json",
        )
        self.assertEqual(inactive.status_code, 404)

    def test_disabled_by_setting(self):
        from django.test import override_settings

        with override_settings(HUB_GHL_EMAIL_LOGIN=False):
            res = self.client.post(
                "/api/auth/ghl-email-login/",
                {"email": "serina@test.local"},
                format="json",
            )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "disabled")


class StaffPermissionTests(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient

        from hub.models import HubForm, HubFormSubmission, HubLeaveApproval, HubUser
        from hub.services.auth import tokens_for_hub_user

        self.HubForm = HubForm
        self.HubFormSubmission = HubFormSubmission
        self.HubLeaveApproval = HubLeaveApproval

        self.admin = HubUser.objects.create(
            name="Ada Admin",
            email="ada@test.local",
            role=HubUser.Role.ADMIN,
            regular_rate=Decimal("50"),
        )
        self.employee = HubUser.objects.create(
            name="Eli Employee",
            email="eli@test.local",
            phone="5551111",
            role=HubUser.Role.EMPLOYEE,
            regular_rate=Decimal("22"),
        )
        self.contractor = HubUser.objects.create(
            name="Cara Contractor",
            email="cara@test.local",
            role=HubUser.Role.CONTRACTOR,
            regular_rate=Decimal("30"),
        )
        self.payroll = HubForm.objects.create(
            name="Payroll",
            slug="new-payroll-records",
            fields=[{"id": "u", "type": "users", "label": "Staff"}],
        )
        self.leave = HubForm.objects.create(
            name="Time off",
            slug="request-time-off",
            fields=LEAVE_FIELDS,
        )
        self.absence = HubForm.objects.create(
            name="Absence",
            slug="new-absence",
            fields=LEAVE_FIELDS,
        )
        self.mine = HubFormSubmission.objects.create(
            form=self.payroll,
            answers={"u": ["Eli Employee"]},
        )
        self.theirs = HubFormSubmission.objects.create(
            form=self.payroll,
            answers={"u": ["Cara Contractor"]},
        )
        other_leave = HubFormSubmission.objects.create(
            form=self.leave,
            answers={"u": ["Cara Contractor"], "s": "2026-09-01", "e": "2026-09-02", "t": "Vacation"},
        )
        HubLeaveApproval.objects.create(
            submission=other_leave,
            status=HubLeaveApproval.Status.PENDING,
        )

        self.emp_client = APIClient()
        self.emp_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.employee)['access']}"
        )
        self.con_client = APIClient()
        self.con_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.contractor)['access']}"
        )
        self.admin_client = APIClient()
        self.admin_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.admin)['access']}"
        )

    def test_staff_cannot_create_or_delete_payroll(self):
        created = self.emp_client.post(
            "/api/submissions/",
            {"formId": str(self.payroll.id), "answers": {"u": ["Eli Employee"]}},
            format="json",
        )
        self.assertEqual(created.status_code, 403)

        deleted = self.emp_client.delete(f"/api/submissions/{self.mine.id}/")
        self.assertEqual(deleted.status_code, 403)

        patched = self.emp_client.patch(
            f"/api/submissions/{self.mine.id}/",
            {"answers": {"u": ["Eli Employee"], "x": 1}},
            format="json",
        )
        self.assertEqual(patched.status_code, 403)

    def test_contractor_cannot_create_payroll(self):
        created = self.con_client.post(
            "/api/submissions/",
            {"formId": str(self.payroll.id), "answers": {"u": ["Cara Contractor"]}},
            format="json",
        )
        self.assertEqual(created.status_code, 403)

    def test_staff_payroll_list_is_own_records_only(self):
        res = self.emp_client.get(f"/api/submissions/?form={self.payroll.id}")
        self.assertEqual(res.status_code, 200)
        ids = {row["id"] for row in res.data}
        self.assertIn(str(self.mine.id), ids)
        self.assertNotIn(str(self.theirs.id), ids)

        admin_res = self.admin_client.get(f"/api/submissions/?form={self.payroll.id}")
        admin_ids = {row["id"] for row in admin_res.data}
        self.assertEqual(admin_ids, {str(self.mine.id), str(self.theirs.id)})

    def test_staff_can_request_time_off_for_self(self):
        res = self.emp_client.post(
            "/api/submissions/",
            {
                "formId": str(self.leave.id),
                "answers": {
                    "u": ["Eli Employee"],
                    "s": "2026-10-01",
                    "e": "2026-10-02",
                    "t": "Vacation",
                },
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)

    def test_staff_user_list_hides_others_pay_and_contact(self):
        res = self.emp_client.get("/api/users/")
        self.assertEqual(res.status_code, 200)
        by_name = {row["name"]: row for row in res.data}
        self.assertEqual(by_name["Eli Employee"]["regularRate"], "22.00")
        self.assertNotIn("regularRate", by_name["Cara Contractor"])
        self.assertNotIn("email", by_name["Cara Contractor"])
        self.assertEqual(by_name["Eli Employee"]["email"], "eli@test.local")

    def test_admin_can_create_payroll(self):
        res = self.admin_client.post(
            "/api/submissions/",
            {"formId": str(self.payroll.id), "answers": {"u": ["Eli Employee"]}},
            format="json",
        )
        self.assertEqual(res.status_code, 201)

    def test_anonymous_cannot_create_absence(self):
        from rest_framework.test import APIClient

        res = APIClient().post(
            "/api/submissions/",
            {
                "formId": str(self.absence.id),
                "answers": {
                    "u": ["Eli Employee"],
                    "s": "2026-10-01",
                    "e": "2026-10-01",
                    "t": "Absent",
                },
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_staff_cannot_create_absence(self):
        res = self.emp_client.post(
            "/api/submissions/",
            {
                "formId": str(self.absence.id),
                "answers": {
                    "u": ["Eli Employee"],
                    "s": "2026-10-01",
                    "e": "2026-10-01",
                    "t": "Absent",
                },
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_admin_can_create_absence(self):
        res = self.admin_client.post(
            "/api/submissions/",
            {
                "formId": str(self.absence.id),
                "answers": {
                    "u": ["Eli Employee"],
                    "s": "2026-10-01",
                    "e": "2026-10-01",
                    "t": "Absent",
                },
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)


class VisitSummaryPermissionTests(TestCase):
    def setUp(self):
        from datetime import datetime, timezone as dt_timezone

        from rest_framework.test import APIClient

        from hub.models import HubUser, HubVisit
        from hub.services.auth import tokens_for_hub_user

        self.admin = HubUser.objects.create(
            name="Ada Admin",
            email="ada-visits@test.local",
            role=HubUser.Role.ADMIN,
        )
        self.employee = HubUser.objects.create(
            name="Eli Employee",
            email="eli-visits@test.local",
            role=HubUser.Role.EMPLOYEE,
        )
        self.other = HubUser.objects.create(
            name="Cara Contractor",
            email="cara-visits@test.local",
            role=HubUser.Role.CONTRACTOR,
        )
        in_range = HubVisit.objects.create(
            jobber_visit_id="dash-v1",
            client_name="Jane",
            start_at=datetime(2026, 9, 10, 14, 0, tzinfo=dt_timezone.utc),
        )
        in_range.technicians.set([self.employee])
        other_visit = HubVisit.objects.create(
            jobber_visit_id="dash-v2",
            client_name="Bob",
            start_at=datetime(2026, 9, 12, 10, 0, tzinfo=dt_timezone.utc),
        )
        other_visit.technicians.set([self.other])
        out_of_range = HubVisit.objects.create(
            jobber_visit_id="dash-v3",
            client_name="Old",
            start_at=datetime(2026, 8, 2, 10, 0, tzinfo=dt_timezone.utc),
        )
        out_of_range.technicians.set([self.employee])

        self.emp_client = APIClient()
        self.emp_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.employee)['access']}"
        )
        self.admin_client = APIClient()
        self.admin_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.admin)['access']}"
        )

    def test_staff_summary_is_own_visits_only(self):
        res = self.emp_client.get(
            "/api/visits/summary/",
            {
                "start_at_after": "2026-09-01T00:00:00Z",
                "start_at_before": "2026-09-30T23:59:59Z",
            },
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["total"], 1)
        self.assertEqual(res.data["by_technician"][str(self.employee.id)], 1)
        self.assertNotIn(str(self.other.id), res.data["by_technician"])

    def test_admin_summary_includes_all_technicians(self):
        res = self.admin_client.get(
            "/api/visits/summary/",
            {
                "start_at_after": "2026-09-01T00:00:00Z",
                "start_at_before": "2026-09-30T23:59:59Z",
            },
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["total"], 2)
        self.assertEqual(res.data["by_technician"][str(self.employee.id)], 1)
        self.assertEqual(res.data["by_technician"][str(self.other.id)], 1)


class DisplayRolePermissionTests(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient

        from hub.models import HubForm, HubFormSubmission, HubUser
        from hub.services.auth import tokens_for_hub_user

        self.display = HubUser.objects.create(
            name="Office TV",
            email="tv@test.local",
            role=HubUser.Role.DISPLAY,
            status=HubUser.Status.ACTIVE,
        )
        self.employee = HubUser.objects.create(
            name="Eli Employee",
            email="eli-tv@test.local",
            role=HubUser.Role.EMPLOYEE,
            regular_rate=Decimal("22"),
        )
        self.payroll = HubForm.objects.create(
            name="Payroll",
            slug="new-payroll-records",
            fields=[{"id": "u", "type": "users", "label": "Staff"}],
        )
        self.leave = HubForm.objects.create(
            name="Time off",
            slug="request-time-off",
            fields=LEAVE_FIELDS,
        )
        self.payroll_sub = HubFormSubmission.objects.create(
            form=self.payroll,
            answers={"u": ["Eli Employee"]},
        )
        HubFormSubmission.objects.create(
            form=self.leave,
            answers={"u": ["Eli Employee"]},
        )
        self.client = APIClient()
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.display)['access']}"
        )

    def test_display_sees_scoreboard_submissions_and_rates(self):
        users = self.client.get("/api/users/")
        self.assertEqual(users.status_code, 200)
        eli = next(u for u in users.data if u["name"] == "Eli Employee")
        self.assertEqual(str(eli["regularRate"]), "22.00")
        self.assertNotIn("email", eli)

        subs = self.client.get("/api/submissions/")
        self.assertEqual(subs.status_code, 200)
        from hub.models import HubFormSubmission as Sub

        slugs = {Sub.objects.get(pk=row["id"]).form.slug for row in subs.data}
        self.assertIn("new-payroll-records", slugs)
        self.assertNotIn("request-time-off", slugs)

    def test_display_cannot_write_users_or_read_hub_staff_apis(self):
        patch = self.client.patch(
            f"/api/users/{self.employee.id}/",
            {"name": "Hacked"},
            format="json",
        )
        self.assertEqual(patch.status_code, 403)

        me = self.client.patch("/api/auth/me/", {"email": "x@test.local"}, format="json")
        self.assertEqual(me.status_code, 403)

        folders = self.client.get("/api/resource-folders/")
        self.assertEqual(folders.status_code, 403)

        notes = self.client.get("/api/notifications/")
        self.assertEqual(notes.status_code, 403)


