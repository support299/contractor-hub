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



