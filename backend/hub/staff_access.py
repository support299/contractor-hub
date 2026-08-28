"""Scope records so employees/contractors cannot act as admins."""

from .models import HubFormSubmission, HubLeaveApproval, HubUser

LEAVE_FORM_SLUG = "request-time-off"
PAYROLL_PERIODS_SLUG = "new-payroll-periods"

# Only admins may insert these (payroll, bonuses, recorded absences, efficiency).
STAFF_CREATE_BLOCKED_SLUGS = frozenset(
    {
        "new-payroll-records",
        "new-payroll-periods",
        "bonus-submissions",
        "new-absence",
        "new-efficiency",
    }
)


def answer_mentions_hub_user(answers: dict | None, hub_user: HubUser) -> bool:
    if not answers or not hub_user:
        return False
    name = (hub_user.name or "").strip()
    uid = str(hub_user.id)
    needles = {uid}
    if name:
        needles.add(name)
        needles.add(name.lower())

    def matches(value) -> bool:
        if value is None:
            return False
        if isinstance(value, (list, tuple)):
            return any(matches(v) for v in value)
        text = str(value).strip()
        if not text:
            return False
        return text in needles or text.lower() in needles

    return any(matches(v) for v in answers.values())


def staff_may_see_submission(
    submission: HubFormSubmission,
    hub_user: HubUser,
    leave_status_by_id: dict[str, str],
) -> bool:
    slug = getattr(submission.form, "slug", "") or ""
    if slug == PAYROLL_PERIODS_SLUG:
        return True
    mentions = answer_mentions_hub_user(submission.answers, hub_user)
    if slug == LEAVE_FORM_SLUG:
        status = leave_status_by_id.get(str(submission.id), "pending")
        return mentions or status == HubLeaveApproval.Status.APPROVED
    return mentions


def filter_submissions_for_staff(qs, hub_user: HubUser):
    ids = list(qs.values_list("id", flat=True))
    if not ids:
        return qs.none()
    leave_status = {
        str(sid): status
        for sid, status in HubLeaveApproval.objects.filter(
            submission_id__in=ids
        ).values_list("submission_id", "status")
    }
    allowed = [
        sub.id
        for sub in qs.select_related("form")
        if staff_may_see_submission(sub, hub_user, leave_status)
    ]
    return qs.filter(id__in=allowed)


def filter_leave_approvals_for_staff(qs, hub_user: HubUser):
    allowed_sub_ids = []
    for approval in qs.select_related("submission", "submission__form"):
        status_map = {str(approval.submission_id): approval.status}
        if staff_may_see_submission(approval.submission, hub_user, status_map):
            allowed_sub_ids.append(approval.submission_id)
    return qs.filter(submission_id__in=allowed_sub_ids)
