"""Vacation eligibility, yearly hard reset, weekday-only deduction."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

VACATION_DAYS_ALLOTMENT = Decimal("10")


def add_years(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:
        return d.replace(year=d.year + years, month=2, day=28)


def is_vacation_eligible(hire_date: date | None, on_date: date | None = None) -> bool:
    if hire_date is None:
        return False
    on_date = on_date or date.today()
    return on_date >= add_years(hire_date, 1)


def eligibility_date(hire_date: date | None) -> date | None:
    if hire_date is None:
        return None
    return add_years(hire_date, 1)


def anniversary_on_or_before(hire_date: date, on_date: date) -> date:
    cand = add_years(hire_date, on_date.year - hire_date.year)
    if cand > on_date:
        cand = add_years(hire_date, on_date.year - hire_date.year - 1)
    return cand


def count_weekdays(start: date, end: date) -> int:
    if end < start:
        start, end = end, start
    days = 0
    cur = start
    while cur <= end:
        if cur.weekday() < 5:
            days += 1
        cur += timedelta(days=1)
    return days


def preview_vacation_balance(user, on_date: date | None = None) -> dict:
    """
    Compute eligibility + available days as if ensure_vacation_balance_current ran.
    Does not write to the DB.
    """
    on_date = on_date or date.today()
    hire = getattr(user, "hire_date", None)
    stored = getattr(user, "available_vacation_days", None)
    if stored is None:
        stored = Decimal("0")
    else:
        stored = Decimal(stored)

    elig = is_vacation_eligible(hire, on_date)
    elig_on = eligibility_date(hire)
    available = stored
    reset_pending = False
    if elig and hire:
        period_start = anniversary_on_or_before(hire, on_date)
        last_reset = getattr(user, "vacation_balance_reset_on", None)
        if last_reset is None or last_reset < period_start:
            available = VACATION_DAYS_ALLOTMENT
            reset_pending = True
    return {
        "eligible": elig,
        "eligibility_date": elig_on,
        "available": available,
        "reset_pending": reset_pending,
    }


def ensure_vacation_balance_current(user, on_date: date | None = None) -> bool:
    """
    If eligible and a hire-date anniversary passed since last reset, hard-reset to 10.
    Returns True if the user row was updated.
    """
    on_date = on_date or date.today()
    hire = user.hire_date
    if not is_vacation_eligible(hire, on_date):
        return False
    period_start = anniversary_on_or_before(hire, on_date)
    last_reset = user.vacation_balance_reset_on
    if last_reset is not None and last_reset >= period_start:
        return False
    user.available_vacation_days = VACATION_DAYS_ALLOTMENT
    user.vacation_balance_reset_on = period_start
    user.save(update_fields=["available_vacation_days", "vacation_balance_reset_on", "updated_at"])
    return True
