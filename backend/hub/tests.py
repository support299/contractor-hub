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
