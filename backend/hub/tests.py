from datetime import date
from decimal import Decimal
from unittest.mock import patch

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

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    def test_approve_notifies_employee_once(self, mock_send):
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
        self.assertEqual(mock_send.call_count, 1)
        self.assertEqual(mock_send.call_args.kwargs["email"], "jane@test.local")
        self.assertEqual(mock_send.call_args.kwargs["subject"], "Leave approved")

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    def test_reject_copy(self, mock_send):
        from hub.models import HubLeaveApproval, HubNotification
        from hub.services.leave_notify import notify_leave_decision

        sub = self._submit(t="Absent", e="2026-08-12")
        approval = HubLeaveApproval.objects.create(
            submission=sub, status=HubLeaveApproval.Status.REJECTED
        )
        notify_leave_decision(approval, HubLeaveApproval.Status.PENDING)
        n = HubNotification.objects.get(type="leave_rejected")
        self.assertEqual(n.body, "Your Absent request (Aug 10–12) was rejected.")
        mock_send.assert_called_once()
        self.assertEqual(mock_send.call_args.kwargs["email"], "jane@test.local")
        self.assertEqual(mock_send.call_args.kwargs["subject"], "Leave rejected")

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    def test_same_status_patch_skips(self, mock_send):
        from hub.models import HubLeaveApproval, HubNotification
        from hub.services.leave_notify import notify_leave_decision

        sub = self._submit()
        approval = HubLeaveApproval.objects.create(
            submission=sub, status=HubLeaveApproval.Status.APPROVED
        )
        notify_leave_decision(approval, HubLeaveApproval.Status.APPROVED)
        self.assertEqual(HubNotification.objects.count(), 0)

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    def test_submit_emails_designated_addresses_once(self, mock_send):
        from hub.models import HubNotificationEmail, HubNotificationEmailLog
        from hub.services.leave_notify import notify_leave_submitted

        HubNotificationEmail.objects.create(email="boss@cotg.com", label="Peter")
        HubNotificationEmail.objects.create(
            email="off@cotg.com", active=False
        )
        sub = self._submit()
        notify_leave_submitted(sub)
        notify_leave_submitted(sub)
        self.assertEqual(mock_send.call_count, 1)
        kwargs = mock_send.call_args.kwargs
        self.assertEqual(kwargs["email"], "boss@cotg.com")
        self.assertEqual(kwargs["subject"], "New leave request")
        self.assertIn("Jane Doe submitted a Vacation request", kwargs["message"])
        self.assertIn("/admin/calendar", kwargs["html"])
        self.assertEqual(
            HubNotificationEmailLog.objects.filter(email="boss@cotg.com").count(),
            1,
        )

    @patch("hub.services.notify_email.send_conversation_email")
    def test_email_failure_does_not_block_in_app(self, mock_send):
        from hub.models import HubNotification, HubNotificationEmail
        from hub.services.leave_notify import notify_leave_submitted

        mock_send.return_value = False
        HubNotificationEmail.objects.create(email="boss@cotg.com")
        sub = self._submit()
        notify_leave_submitted(sub)
        self.assertEqual(
            HubNotification.objects.filter(type="leave_submitted").count(), 1
        )
        notify_leave_submitted(sub)
        self.assertEqual(mock_send.call_count, 2)

    @patch("hub.services.notify_email.send_conversation_email")
    def test_no_emails_skips_ghl(self, mock_send):
        from hub.services.leave_notify import notify_leave_submitted

        notify_leave_submitted(self._submit())
        mock_send.assert_not_called()


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
        self.assertEqual(set(row.keys()), {"id", "name", "picture", "role"})
        self.assertEqual(row["role"], HubUser.Role.EMPLOYEE)
        self.assertNotIn("email", row)
        self.assertNotIn("regularRate", row)

    def test_full_user_list_still_requires_auth(self):
        from rest_framework.test import APIClient

        res = APIClient().get("/api/users/")
        self.assertEqual(res.status_code, 401)

    def test_auth_user_list_omits_picture(self):
        from rest_framework.test import APIClient

        from hub.models import HubUser
        from hub.services.auth import tokens_for_hub_user

        admin = HubUser.objects.create(
            name="List Admin",
            email="list-admin@test.local",
            role=HubUser.Role.ADMIN,
            picture="data:image/png;base64," + ("A" * 8000),
        )
        client = APIClient()
        client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(admin)['access']}"
        )
        listing = client.get("/api/users/")
        self.assertEqual(listing.status_code, 200)
        row = next(u for u in listing.data if u["name"] == "List Admin")
        self.assertNotIn("picture", row)
        # Invalid base64 cannot be resized, so the list avatar stays empty.
        self.assertEqual(row["pictureThumb"], "")
        detail = client.get(f"/api/users/{admin.id}/")
        self.assertEqual(detail.status_code, 200)
        self.assertTrue(detail.data["picture"].startswith("data:image/png"))

    def test_auth_user_list_includes_picture_thumb(self):
        import base64
        import io

        from PIL import Image
        from rest_framework.test import APIClient

        from hub.models import HubUser
        from hub.services.auth import tokens_for_hub_user

        img = Image.new("RGB", (320, 240), (20, 80, 160))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        picture = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

        admin = HubUser.objects.create(
            name="Thumb Admin",
            email="thumb-admin@test.local",
            role=HubUser.Role.ADMIN,
            picture=picture,
        )
        client = APIClient()
        client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(admin)['access']}"
        )
        created = client.patch(
            f"/api/users/{admin.id}/",
            {"picture": picture},
            format="json",
        )
        self.assertEqual(created.status_code, 200)
        self.assertTrue(created.data["pictureThumb"].startswith("data:image/jpeg;base64,"))
        self.assertLess(len(created.data["pictureThumb"]), len(picture))

        listing = client.get("/api/users/")
        row = next(u for u in listing.data if u["name"] == "Thumb Admin")
        self.assertNotIn("picture", row)
        self.assertEqual(row["pictureThumb"], created.data["pictureThumb"])


class FormUserExcludePersistTests(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient

        from hub.models import HubUser
        from hub.services.auth import tokens_for_hub_user

        self.admin = HubUser.objects.create(
            name="Boss",
            email="boss-exclude@test.local",
            role=HubUser.Role.ADMIN,
        )
        self.client = APIClient()
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.admin)['access']}"
        )

    def test_users_field_keeps_exclude_lists(self):
        res = self.client.post(
            "/api/forms/",
            {
                "name": "Feedback",
                "slug": "how-are-we-doing-exclude-test",
                "fields": [
                    {
                        "id": "u",
                        "type": "users",
                        "label": "Technician",
                        "excludeUserIds": [str(self.admin.id)],
                        "excludeRoles": ["admin"],
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        field = res.data["fields"][0]
        self.assertEqual(field["excludeRoles"], ["admin"])
        self.assertEqual(field["excludeUserIds"], [str(self.admin.id)])


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
        with patch("hub.services.notify_sms.send_conversation_sms") as sms:
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
            "hub.services.notify_sms.send_conversation_sms", return_value=True
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

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    @patch("hub.services.notify_sms.send_conversation_sms", return_value=True)
    def test_confirmed_emails_techs_with_address(self, _sms, mock_email):
        from hub.models import HubFormSubmission
        from hub.services.tip_confirm import maybe_run_tip_confirm

        self.tech1.email = "alex@test.local"
        self.tech1.save(update_fields=["email"])
        sub = HubFormSubmission.objects.create(
            form=self.form, answers=self._answers("Yes")
        )
        self.assertTrue(maybe_run_tip_confirm(sub))
        maybe_run_tip_confirm(sub)
        self.assertEqual(mock_email.call_count, 1)
        self.assertEqual(mock_email.call_args.kwargs["email"], "alex@test.local")
        self.assertIn("Jane Client", mock_email.call_args.kwargs["message"])

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
            "hub.services.notify_sms.send_conversation_sms", return_value=True
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
            "hub.services.notify_sms.send_conversation_sms", return_value=True
        ):
            self.assertTrue(maybe_run_tip_confirm(sub))
        self.assertEqual(HubNotification.objects.filter(type="tip_confirmed").count(), 2)


class FeedbackNotifyTests(TestCase):
    def setUp(self):
        from hub.models import HubForm, HubUser

        self.form = HubForm.objects.create(
            name="How are we doing?",
            slug="how-are-we-doing",
            fields=[
                {"id": "u", "type": "users", "label": "Cleaners"},
                {"id": "c", "type": "short_text", "label": "Your name"},
            ],
        )
        self.tech = HubUser.objects.create(
            name="Alex Cleaner",
            email="alex-fb@test.local",
            role=HubUser.Role.EMPLOYEE,
        )
        self.other = HubUser.objects.create(
            name="Pat Lead",
            email="pat-fb@test.local",
            role=HubUser.Role.EMPLOYEE,
        )
        self.admin = HubUser.objects.create(
            name="Boss",
            email="boss-fb@test.local",
            role=HubUser.Role.ADMIN,
        )

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    def test_named_staff_get_in_app_and_email(self, mock_send):
        from hub.models import HubFormSubmission, HubNotification
        from hub.services.feedback_notify import maybe_notify_feedback

        sub = HubFormSubmission.objects.create(
            form=self.form,
            answers={"u": [str(self.tech.id)], "c": "Jane"},
        )
        maybe_notify_feedback(sub)
        maybe_notify_feedback(sub)
        qs = HubNotification.objects.filter(type="client_feedback")
        self.assertEqual(qs.count(), 1)
        self.assertEqual(qs.get().recipient_id, self.tech.id)
        self.assertEqual(qs.get().link, f"/admin/dashboard?user={self.tech.id}")
        self.assertEqual(mock_send.call_count, 1)
        self.assertEqual(mock_send.call_args.kwargs["email"], "alex-fb@test.local")
        self.assertIn(f"/admin/dashboard?user={self.tech.id}", mock_send.call_args.kwargs["html"])

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    def test_skips_admins_and_unnamed(self, mock_send):
        from hub.models import HubFormSubmission, HubNotification
        from hub.services.feedback_notify import maybe_notify_feedback

        sub = HubFormSubmission.objects.create(
            form=self.form,
            answers={"u": [str(self.admin.id)], "c": "Jane"},
        )
        maybe_notify_feedback(sub)
        self.assertEqual(HubNotification.objects.count(), 0)
        mock_send.assert_not_called()

        empty = HubFormSubmission.objects.create(
            form=self.form, answers={"u": [], "c": "Jane"}
        )
        maybe_notify_feedback(empty)
        self.assertEqual(HubNotification.objects.count(), 0)

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    def test_payroll_slug_skipped(self, mock_send):
        from hub.models import HubForm, HubFormSubmission, HubNotification
        from hub.services.feedback_notify import maybe_notify_feedback

        form = HubForm.objects.create(
            name="Payroll",
            slug="new-payroll-records",
            fields=[{"id": "u", "type": "users", "label": "Staff"}],
        )
        sub = HubFormSubmission.objects.create(
            form=form, answers={"u": [str(self.tech.id)]}
        )
        maybe_notify_feedback(sub)
        self.assertEqual(HubNotification.objects.count(), 0)
        mock_send.assert_not_called()


class ComplaintNotifyTests(TestCase):
    def setUp(self):
        from hub.models import HubForm, HubNotificationEmail, HubUser

        self.form = HubForm.objects.create(
            name="New Complaint",
            slug="new-complaint",
            fields=[
                {"id": "client", "type": "single_line", "label": "Client Name"},
                {"id": "team", "type": "users", "label": "Team"},
                {"id": "resp", "type": "users", "label": "Responsible"},
                {
                    "id": "kind",
                    "type": "dropdown",
                    "label": "Type of Complaint",
                    "options": ["Missed Areas"],
                },
            ],
        )
        self.tech = HubUser.objects.create(
            name="Alex Cleaner",
            email="alex-co@test.local",
            phone="+15551111",
            role=HubUser.Role.EMPLOYEE,
            status=HubUser.Status.ACTIVE,
        )
        self.lead = HubUser.objects.create(
            name="Pat Lead",
            email="pat-co@test.local",
            phone="+15552222",
            role=HubUser.Role.CONTRACTOR,
            status=HubUser.Status.ACTIVE,
        )
        self.admin = HubUser.objects.create(
            name="Boss",
            email="boss-co@test.local",
            role=HubUser.Role.ADMIN,
            status=HubUser.Status.ACTIVE,
        )
        HubNotificationEmail.objects.create(
            email="office@cotg.com", phone="+15559999", label="Office"
        )

    def _submit(self, answers=None):
        from hub.models import HubFormSubmission

        return HubFormSubmission.objects.create(
            form=self.form,
            answers=answers
            or {
                "client": "Jane Client",
                "team": [str(self.tech.id)],
                "resp": [str(self.lead.id), str(self.admin.id)],
                "kind": "Missed Areas",
            },
        )

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    @patch("hub.services.notify_sms.send_conversation_sms", return_value=True)
    @patch("hub.services.notify_sms.send_conversation_sms_to_phone", return_value=True)
    def test_office_and_named_staff(self, mock_office_sms, mock_staff_sms, mock_email):
        from hub.models import HubNotification
        from hub.services.complaint_notify import maybe_notify_complaint

        sub = self._submit()
        maybe_notify_complaint(sub)
        maybe_notify_complaint(sub)

        notes = HubNotification.objects.filter(type="client_complaint")
        self.assertEqual(notes.count(), 3)
        by_recipient = {n.recipient_id: n for n in notes}
        self.assertEqual(
            by_recipient[self.admin.id].body,
            "Jane Client: Missed Areas. Responsible: Pat Lead, Boss.",
        )
        self.assertEqual(
            by_recipient[self.admin.id].link,
            f"/admin/forms/{self.form.id}/submissions",
        )
        self.assertIn("includes you", by_recipient[self.tech.id].body)
        self.assertEqual(
            by_recipient[self.tech.id].link,
            f"/admin/dashboard?user={self.tech.id}",
        )
        self.assertEqual(by_recipient[self.lead.id].recipient_id, self.lead.id)

        emails = sorted(call.kwargs["email"] for call in mock_email.call_args_list)
        self.assertEqual(emails, ["alex-co@test.local", "office@cotg.com", "pat-co@test.local"])
        self.assertEqual(mock_staff_sms.call_count, 2)
        mock_office_sms.assert_called_once()
        self.assertEqual(mock_office_sms.call_args.args[0], "+15559999")
        self.assertIn("Jane Client", mock_office_sms.call_args.args[1])

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    @patch("hub.services.notify_sms.send_conversation_sms", return_value=True)
    @patch("hub.services.notify_sms.send_conversation_sms_to_phone", return_value=True)
    def test_other_form_skipped(self, mock_office_sms, mock_staff_sms, mock_email):
        from hub.models import HubForm, HubFormSubmission, HubNotification
        from hub.services.complaint_notify import maybe_notify_complaint

        form = HubForm.objects.create(
            name="Payroll",
            slug="new-payroll-records",
            fields=[{"id": "u", "type": "users", "label": "Staff"}],
        )
        sub = HubFormSubmission.objects.create(
            form=form, answers={"u": [str(self.tech.id)]}
        )
        maybe_notify_complaint(sub)
        self.assertEqual(HubNotification.objects.count(), 0)
        mock_email.assert_not_called()
        mock_staff_sms.assert_not_called()
        mock_office_sms.assert_not_called()

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    @patch("hub.services.notify_sms.send_conversation_sms_to_phone", return_value=True)
    def test_name_fallback_still_notifies_office(self, mock_office_sms, mock_email):
        from hub.models import HubForm, HubFormSubmission, HubNotification
        from hub.services.complaint_notify import maybe_notify_complaint

        form = HubForm.objects.create(
            name="Client Complaint",
            slug="issue-log",
            fields=[{"id": "c", "type": "single_line", "label": "Client Name"}],
        )
        sub = HubFormSubmission.objects.create(form=form, answers={"c": "Sam"})
        maybe_notify_complaint(sub)
        self.assertEqual(
            HubNotification.objects.filter(type="client_complaint").count(), 1
        )
        mock_email.assert_called_once()
        self.assertEqual(mock_email.call_args.kwargs["email"], "office@cotg.com")
        self.assertIn("Sam", mock_email.call_args.kwargs["message"])
        mock_office_sms.assert_called_once()


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
        internal = HubVisit.objects.create(
            jobber_visit_id="dash-v-internal",
            client_name="Clean on the Go",
            title="Clean on the Go",
            start_at=datetime(2026, 9, 15, 10, 0, tzinfo=dt_timezone.utc),
        )
        internal.technicians.set([self.employee])

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

    def test_summary_excludes_clean_on_the_go_client(self):
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


class JobberIdFillTests(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient

        from hub.models import HubUser
        from hub.services.auth import tokens_for_hub_user

        self.admin = HubUser.objects.create(
            name="Jobber Admin",
            email="jobber-admin@test.local",
            role=HubUser.Role.ADMIN,
        )
        self.client = APIClient()
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.admin)['access']}"
        )

    @patch("hub.services.jobber_bridge.find_jobber_user_id_by_email")
    def test_create_with_email_fills_jobber_id(self, mock_find):
        from hub.models import HubUser

        mock_find.return_value = "Z2lk_new_hire"
        res = self.client.post(
            "/api/users/",
            {"name": "New Hire", "email": "new@cotg.com", "role": "employee"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        user = HubUser.objects.get(email="new@cotg.com")
        self.assertEqual(user.jobber_id, "Z2lk_new_hire")
        mock_find.assert_called_once_with("new@cotg.com")

    @patch("hub.services.jobber_bridge.find_jobber_user_id_by_email")
    def test_existing_jobber_id_not_overwritten(self, mock_find):
        from hub.models import HubUser

        mock_find.return_value = "should_not_use"
        user = HubUser.objects.create(
            name="Has Id",
            email="hasid@cotg.com",
            jobber_id="keep_me",
        )
        res = self.client.patch(
            f"/api/users/{user.id}/",
            {"name": "Has Id Updated"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        user.refresh_from_db()
        self.assertEqual(user.jobber_id, "keep_me")
        mock_find.assert_not_called()

    @patch("hub.services.jobber_bridge.find_jobber_user_id_by_email")
    def test_patch_email_fills_when_jobber_id_empty(self, mock_find):
        from hub.models import HubUser

        mock_find.return_value = "Z2lk_from_email"
        user = HubUser.objects.create(name="No Mail", email="")
        res = self.client.patch(
            f"/api/users/{user.id}/",
            {"email": "later@cotg.com"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        user.refresh_from_db()
        self.assertEqual(user.jobber_id, "Z2lk_from_email")
        mock_find.assert_called_once_with("later@cotg.com")

    @patch("hub.services.jobber_bridge.find_jobber_user_id_by_email")
    def test_skips_id_already_on_another_user(self, mock_find):
        from hub.models import HubUser

        HubUser.objects.create(
            name="Owner",
            email="owner@cotg.com",
            jobber_id="Z2lk_taken",
        )
        mock_find.return_value = "Z2lk_taken"
        res = self.client.post(
            "/api/users/",
            {"name": "Dupe", "email": "dupe@cotg.com", "role": "employee"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        user = HubUser.objects.get(email="dupe@cotg.com")
        self.assertEqual(user.jobber_id, "")

    @patch("hub.services.jobber_bridge.find_jobber_user_id_by_email")
    def test_no_email_skips_lookup(self, mock_find):
        from hub.models import HubUser

        res = self.client.post(
            "/api/users/",
            {"name": "No Email", "role": "employee"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        user = HubUser.objects.get(name="No Email")
        self.assertEqual(user.jobber_id, "")
        mock_find.assert_not_called()

    @patch("hub.services.jobber_bridge.find_jobber_user_id_by_email")
    def test_lookup_failure_does_not_block_save(self, mock_find):
        from hub.models import HubUser

        mock_find.side_effect = RuntimeError("down")
        res = self.client.post(
            "/api/users/",
            {"name": "Still Saved", "email": "still@cotg.com", "role": "employee"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        user = HubUser.objects.get(email="still@cotg.com")
        self.assertEqual(user.jobber_id, "")


class GoogleFiveStarCountTests(TestCase):
    def test_counts_five_star_in_range_only(self):
        from datetime import datetime, timezone as dt_timezone

        from hub.models import GhlGoogleReview
        from hub.services.ghl_internal import count_five_star

        tz = dt_timezone.utc
        GhlGoogleReview.objects.create(
            ghl_id="a",
            star_rating=5,
            source=247,
            date_added=datetime(2026, 9, 9, 18, 0, tzinfo=tz),
        )
        GhlGoogleReview.objects.create(
            ghl_id="b",
            star_rating=4,
            source=247,
            date_added=datetime(2026, 9, 8, 12, 0, tzinfo=tz),
        )
        GhlGoogleReview.objects.create(
            ghl_id="c",
            star_rating=5,
            source=247,
            date_added=datetime(2026, 8, 1, 12, 0, tzinfo=tz),
        )
        GhlGoogleReview.objects.create(
            ghl_id="d",
            star_rating=5,
            source=71,
            date_added=datetime(2026, 9, 8, 12, 0, tzinfo=tz),
        )
        start = datetime(2026, 9, 1, 0, 0, tzinfo=tz)
        end = datetime(2026, 9, 30, 23, 59, 59, tzinfo=tz)
        self.assertEqual(count_five_star(start=start, end=end), 1)


class GoogleReviewSummaryApiTests(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient

        from hub.models import HubUser
        from hub.services.auth import tokens_for_hub_user

        self.admin = HubUser.objects.create(
            name="Admin",
            email="grev-admin@test.local",
            role=HubUser.Role.ADMIN,
        )
        self.display = HubUser.objects.create(
            name="TV",
            email="grev-tv@test.local",
            role=HubUser.Role.DISPLAY,
        )
        self.employee = HubUser.objects.create(
            name="Staff",
            email="grev-emp@test.local",
            role=HubUser.Role.EMPLOYEE,
        )
        self.admin_client = APIClient()
        self.admin_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.admin)['access']}"
        )
        self.tv_client = APIClient()
        self.tv_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.display)['access']}"
        )
        self.emp_client = APIClient()
        self.emp_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.employee)['access']}"
        )

    @patch("hub.google_review_views.sync_google_reviews")
    def test_admin_gets_five_star_count(self, mock_sync):
        from datetime import datetime, timezone as dt_timezone

        from hub.models import GhlGoogleReview

        mock_sync.return_value = 1
        GhlGoogleReview.objects.create(
            ghl_id="sep",
            star_rating=5,
            source=247,
            date_added=datetime(2026, 9, 9, 18, 0, tzinfo=dt_timezone.utc),
        )
        res = self.admin_client.get(
            "/api/reviews/google-summary/",
            {
                "start_at_after": "2026-09-01T00:00:00Z",
                "start_at_before": "2026-09-30T23:59:59Z",
            },
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["five_star"], 1)
        self.assertEqual(len(res.data["reviews"]), 1)
        self.assertEqual(res.data["reviews"][0]["reviewer_name"], "")

    @patch("hub.google_review_views.sync_google_reviews")
    def test_display_can_read(self, mock_sync):
        mock_sync.return_value = 0
        res = self.tv_client.get("/api/reviews/google-summary/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["five_star"], 0)
        self.assertEqual(res.data["reviews"], [])

    def test_staff_forbidden(self):
        res = self.emp_client.get("/api/reviews/google-summary/")
        self.assertEqual(res.status_code, 403)


class NotificationEmailApiTests(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient

        from hub.models import HubUser
        from hub.services.auth import tokens_for_hub_user

        self.admin = HubUser.objects.create(
            name="Email Admin",
            email="email-admin@test.local",
            role=HubUser.Role.ADMIN,
        )
        self.employee = HubUser.objects.create(
            name="Email Staff",
            email="email-staff@test.local",
            role=HubUser.Role.EMPLOYEE,
        )
        self.admin_client = APIClient()
        self.admin_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.admin)['access']}"
        )
        self.emp_client = APIClient()
        self.emp_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.employee)['access']}"
        )

    def test_admin_can_crud(self):
        res = self.admin_client.post(
            "/api/notification-emails/",
            {"email": "Peter@CleanOnTheGo.com", "label": "Peter"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["email"], "peter@cleanonthego.com")
        row_id = res.data["id"]

        listing = self.admin_client.get("/api/notification-emails/")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(len(listing.data), 1)

        dup = self.admin_client.post(
            "/api/notification-emails/",
            {"email": "peter@cleanonthego.com"},
            format="json",
        )
        self.assertEqual(dup.status_code, 400)

        off = self.admin_client.patch(
            f"/api/notification-emails/{row_id}/",
            {"active": False, "phone": "+15550101"},
            format="json",
        )
        self.assertEqual(off.status_code, 200)
        self.assertFalse(off.data["active"])
        self.assertEqual(off.data["phone"], "+15550101")

        gone = self.admin_client.delete(f"/api/notification-emails/{row_id}/")
        self.assertEqual(gone.status_code, 204)

    def test_prefs_channel_admin_only(self):
        listing = self.admin_client.get("/api/notification-prefs/")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.data["channel"], "both")

        patched = self.admin_client.patch(
            "/api/notification-prefs/",
            {"channel": "sms"},
            format="json",
        )
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.data["channel"], "sms")

        bad = self.admin_client.patch(
            "/api/notification-prefs/",
            {"channel": "carrier-pigeon"},
            format="json",
        )
        self.assertEqual(bad.status_code, 400)

        denied = self.emp_client.get("/api/notification-prefs/")
        self.assertEqual(denied.status_code, 403)

    def test_staff_cannot_list(self):
        res = self.emp_client.get("/api/notification-emails/")
        self.assertEqual(res.status_code, 403)


class NotifySmsTests(TestCase):
    def setUp(self):
        from hub.models import HubForm, HubUser

        self.admin = HubUser.objects.create(
            name="Boss",
            email="boss-sms@test.local",
            role=HubUser.Role.ADMIN,
            status=HubUser.Status.ACTIVE,
        )
        self.employee = HubUser.objects.create(
            name="Jane Doe",
            email="jane-sms@test.local",
            phone="+15550001",
            ghl_id="ghl-jane",
            role=HubUser.Role.EMPLOYEE,
            status=HubUser.Status.ACTIVE,
        )
        self.form = HubForm.objects.create(
            name="Request Time Off",
            slug="request-time-off",
            fields=LEAVE_FIELDS,
        )

    def _submit(self):
        from hub.models import HubFormSubmission

        return HubFormSubmission.objects.create(
            form=self.form,
            answers={
                "u": [str(self.employee.id)],
                "s": "2026-08-10",
                "e": "2026-08-17",
                "t": "Vacation",
            },
        )

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    @patch("hub.services.notify_sms.send_conversation_sms", return_value=True)
    def test_approve_sends_email_and_sms(self, mock_sms, mock_email):
        from hub.models import HubLeaveApproval
        from hub.services.leave_notify import notify_leave_decision

        sub = self._submit()
        approval = HubLeaveApproval.objects.create(
            submission=sub, status=HubLeaveApproval.Status.APPROVED
        )
        notify_leave_decision(approval, HubLeaveApproval.Status.PENDING)
        notify_leave_decision(approval, HubLeaveApproval.Status.PENDING)
        self.assertEqual(mock_email.call_count, 1)
        self.assertEqual(mock_sms.call_count, 1)
        self.assertIn("was approved", mock_sms.call_args.args[1])
        self.assertIn("/admin/calendar", mock_sms.call_args.args[1])

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    @patch("hub.services.notify_sms.send_conversation_sms", return_value=True)
    def test_channel_email_skips_sms(self, mock_sms, mock_email):
        from hub.models import HubLeaveApproval, HubNotifyPrefs
        from hub.services.leave_notify import notify_leave_decision

        prefs = HubNotifyPrefs.load()
        prefs.channel = HubNotifyPrefs.Channel.EMAIL
        prefs.save()
        sub = self._submit()
        approval = HubLeaveApproval.objects.create(
            submission=sub, status=HubLeaveApproval.Status.APPROVED
        )
        notify_leave_decision(approval, HubLeaveApproval.Status.PENDING)
        mock_email.assert_called_once()
        mock_sms.assert_not_called()

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    @patch("hub.services.notify_sms.send_conversation_sms_to_phone", return_value=True)
    def test_submit_sms_designated_phone(self, mock_sms, mock_email):
        from hub.models import HubNotificationEmail
        from hub.services.leave_notify import notify_leave_submitted

        HubNotificationEmail.objects.create(
            email="office@cotg.com", phone="+15559999", label="Office"
        )
        sub = self._submit()
        notify_leave_submitted(sub)
        notify_leave_submitted(sub)
        mock_email.assert_called_once()
        mock_sms.assert_called_once()
        self.assertEqual(mock_sms.call_args.args[0], "+15559999")
        self.assertIn("Jane Doe submitted", mock_sms.call_args.args[1])

    @patch("hub.services.notify_email.send_conversation_email", return_value=True)
    @patch("hub.services.notify_sms.send_conversation_sms", return_value=True)
    def test_feedback_sms_includes_dashboard_link(self, mock_sms, mock_email):
        from hub.models import HubForm, HubFormSubmission
        from hub.services.feedback_notify import maybe_notify_feedback

        form = HubForm.objects.create(
            name="How are we doing?",
            slug="how-are-we-doing",
            fields=[{"id": "u", "type": "users", "label": "Cleaners"}],
        )
        sub = HubFormSubmission.objects.create(
            form=form, answers={"u": [str(self.employee.id)]}
        )
        maybe_notify_feedback(sub)
        maybe_notify_feedback(sub)
        self.assertEqual(mock_sms.call_count, 1)
        body = mock_sms.call_args.args[1]
        self.assertIn("feedback", body.lower())
        self.assertIn(f"/admin/dashboard?user={self.employee.id}", body)
        self.assertEqual(mock_email.call_count, 1)


class MeProfileUpdateTests(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient

        from hub.models import HubUser
        from hub.services.auth import tokens_for_hub_user

        self.employee = HubUser.objects.create(
            name="Eli",
            email="eli-old@test.local",
            phone="",
            role=HubUser.Role.EMPLOYEE,
        )
        self.client = APIClient()
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {tokens_for_hub_user(self.employee)['access']}"
        )

    @patch("hub.services.jobber_bridge.maybe_fill_jobber_id")
    def test_staff_can_update_own_email_and_phone(self, mock_fill):
        res = self.client.patch(
            "/api/auth/me/",
            {"email": "eli-new@test.local", "phone": "+15558888"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["email"], "eli-new@test.local")
        self.assertEqual(res.data["phone"], "+15558888")
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.email, "eli-new@test.local")
        self.assertEqual(self.employee.phone, "+15558888")
        mock_fill.assert_called_once()




