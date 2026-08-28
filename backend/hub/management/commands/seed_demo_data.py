"""Seed demo data across hub models for local dashboard / analytics testing."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from hub.models import (
    HubAlert,
    HubDocument,
    HubForm,
    HubFormSubmission,
    HubLeaveApproval,
    HubNotification,
    HubResourceFolder,
    HubTrainingMaterial,
    HubUser,
    HubVisit,
    LockInBonus,
    PendingLockIn,
)
from hub.services.auth import ensure_auth_user


def _aware(dt: datetime):
    if timezone.is_naive(dt):
        return timezone.make_aware(dt)
    return dt


class Command(BaseCommand):
    help = "Seed ~10 users and sample data for forms, leave, lock-in, training, etc."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete previously seeded demo records (keeps real admin if not demo-tagged).",
        )

    def handle(self, *args, **options):
        if options["reset"]:
            self._reset_demo()

        users = self._seed_users()
        folders = self._seed_folders()
        self._seed_training(folders)
        self._seed_documents(folders)
        self._seed_alerts()
        form = self._seed_time_off_form()
        self._seed_leave(users, form)
        visits = self._seed_visits(users)
        pendings = self._seed_lock_ins(users, visits)
        self._seed_notifications(users, pendings)
        self.stdout.write(self.style.SUCCESS("Demo data ready."))
        self.stdout.write(f"  Users: {HubUser.objects.count()}")
        self.stdout.write(f"  Leave approvals: {HubLeaveApproval.objects.count()}")
        self.stdout.write(f"  Lock-ins: {PendingLockIn.objects.count()}")
        self.stdout.write(f"  Bonuses: {LockInBonus.objects.count()}")
        self.stdout.write(f"  Visits: {HubVisit.objects.count()}")

    def _reset_demo(self):
        # Soft reset: remove users whose email ends with @demo.cleaonthego.local
        demo_users = HubUser.objects.filter(email__endswith="@demo.cleaonthego.local")
        demo_ids = list(demo_users.values_list("id", flat=True))
        LockInBonus.objects.filter(technician_id__in=demo_ids).delete()
        PendingLockIn.objects.filter(quote_id__startswith="demo-").delete()
        HubVisit.objects.filter(jobber_visit_id__startswith="demo-visit-").delete()
        HubLeaveApproval.objects.filter(
            submission__form__slug="request-time-off"
        ).delete()
        HubFormSubmission.objects.filter(form__slug="request-time-off").delete()
        HubNotification.objects.filter(recipient_id__in=demo_ids).delete()
        for u in demo_users:
            if u.auth_user_id:
                u.auth_user.delete()
            u.delete()
        HubForm.objects.filter(slug="request-time-off").delete()
        HubAlert.objects.filter(message__startswith="[DEMO]").delete()
        HubTrainingMaterial.objects.filter(title__startswith="[DEMO]").delete()
        HubDocument.objects.filter(title__startswith="[DEMO]").delete()
        HubResourceFolder.objects.filter(name__startswith="[DEMO]").delete()
        self.stdout.write(self.style.WARNING("Cleared previous demo data."))

    def _seed_users(self) -> list[HubUser]:
        specs = [
            ("Alex Rivera", "employee", "Team Leader", "2022-03-15", "8.0", "20"),
            ("Jordan Lee", "employee", "Cleaning Specialist", "2023-01-10", "5.0", "15"),
            ("Sam Patel", "employee", "Cleaning Technician", "2024-06-01", "10.0", "10"),
            ("Casey Nguyen", "employee", "Cleaning Specialist", "2021-11-20", "3.5", "15"),
            ("Riley Brooks", "contractor", "Cleaning Technician", "2023-08-05", "7.0", "10"),
            ("Morgan Diaz", "employee", "Team Leader", "2020-05-12", "10.0", "20"),
            ("Taylor Kim", "employee", "Cleaning Technician", "2025-02-14", "0", "10"),
            ("Jamie Ortiz", "contractor", "Cleaning Specialist", "2022-09-01", "6.0", "15"),
            ("Avery Chen", "employee", "Cleaning Technician", "2024-01-22", "8.5", "10"),
            ("Quinn Harper", "employee", "Team Leader", "2021-04-08", "4.0", "20"),
        ]
        users = []
        for i, (name, role, position, hire, vac, rate) in enumerate(specs, start=1):
            email = f"demo.user{i}@demo.cleaonthego.local"
            user, created = HubUser.objects.update_or_create(
                email=email,
                defaults={
                    "name": name,
                    "phone": f"+1555010{i:04d}"[-12:],
                    "role": role,
                    "status": HubUser.Status.ACTIVE if i != 7 else HubUser.Status.ACTIVE,
                    "position": position,
                    "sectors": ["Residential"] if i % 2 else ["Commercial", "Residential"],
                    "work_days": Decimal("5"),
                    "hire_date": date.fromisoformat(hire),
                    "available_vacation_days": Decimal(vac),
                    "vacation_balance_reset_on": date(2026, 1, 1) if Decimal(vac) > 0 else None,
                    "regular_rate": Decimal(rate),
                    "drive_time_rate": Decimal("12.00"),
                    "fc_rate": Decimal("18.00"),
                    "tr_rate": Decimal("16.00"),
                    "supplies_deduction": Decimal("5.00"),
                    "jobber_id": f"demo-jobber-{i}",
                    "ghl_id": f"demo-ghl-{i}",
                    "password_configured": True,
                },
            )
            auth = ensure_auth_user(user)
            auth.set_password("demo1234")
            auth.save()
            users.append(user)
            self.stdout.write(f"  {'Created' if created else 'Updated'} {email}")
        return users

    def _seed_folders(self) -> dict:
        training, _ = HubResourceFolder.objects.get_or_create(
            name="[DEMO] Onboarding",
            kind=HubResourceFolder.Kind.TRAINING,
            defaults={"sort_order": 1},
        )
        docs, _ = HubResourceFolder.objects.get_or_create(
            name="[DEMO] Handbooks",
            kind=HubResourceFolder.Kind.DOCUMENTS,
            defaults={"sort_order": 1},
        )
        both, _ = HubResourceFolder.objects.get_or_create(
            name="[DEMO] Shared",
            kind=HubResourceFolder.Kind.BOTH,
            defaults={"sort_order": 2},
        )
        return {"training": training, "docs": docs, "both": both}

    def _seed_training(self, folders: dict):
        items = [
            ("[DEMO] Safety Orientation", "https://example.com/videos/safety"),
            ("[DEMO] Client Communication", "https://example.com/videos/comms"),
            ("[DEMO] Lock-In Process", "https://example.com/videos/lockin"),
        ]
        for title, url in items:
            HubTrainingMaterial.objects.update_or_create(
                title=title,
                defaults={
                    "category": "Demo",
                    "folder": folders["training"],
                    "description": f"Demo training: {title}",
                    "video_url": url,
                    "visible_positions": [],
                },
            )

    def _seed_documents(self, folders: dict):
        items = [
            ("[DEMO] Employee Handbook", "handbook.pdf"),
            ("[DEMO] Uniform Policy", "uniform.pdf"),
        ]
        for title, fname in items:
            HubDocument.objects.update_or_create(
                title=title,
                defaults={
                    "category": "Demo",
                    "folder": folders["docs"],
                    "description": f"Demo document: {title}",
                    "file_path": f"demo/{fname}",
                    "file_name": fname,
                    "file_type": "application/pdf",
                    "file_size": 1024 * 250,
                    "allow_download": True,
                    "allow_copy": False,
                },
            )

    def _seed_alerts(self):
        HubAlert.objects.update_or_create(
            message="[DEMO] Welcome to the contractor hub — demo data loaded.",
            defaults={"active": True, "sort_order": 0},
        )
        HubAlert.objects.update_or_create(
            message="[DEMO] Submit time-off requests at least 3 days ahead.",
            defaults={"active": True, "sort_order": 1},
        )

    def _seed_time_off_form(self) -> HubForm:
        field_start = "fld_start"
        field_end = "fld_end"
        field_user = "fld_user"
        field_type = "fld_type"
        form, _ = HubForm.objects.update_or_create(
            slug="request-time-off",
            defaults={
                "name": "Request Time Off",
                "description": "Demo leave / vacation / absence form",
                "url": "/forms/request-time-off",
                "status": HubForm.Status.ACTIVE,
                "fields": [
                    {"id": field_start, "label": "Start date", "type": "date"},
                    {"id": field_end, "label": "End date", "type": "date"},
                    {"id": field_user, "label": "Staff name", "type": "users"},
                    {
                        "id": field_type,
                        "label": "Leave type",
                        "type": "dropdown",
                        "options": ["Vacation", "Absent", "Late Arrival"],
                    },
                ],
                "extra_fields": [],
            },
        )
        form._demo_field_ids = {
            "start": field_start,
            "end": field_end,
            "user": field_user,
            "type": field_type,
        }
        return form

    def _seed_leave(self, users: list[HubUser], form: HubForm):
        ids = form._demo_field_ids
        today = date.today()
        scenarios = [
            # user_idx, type, start_offset, end_offset, status, deduct
            (0, "Vacation", -20, -18, HubLeaveApproval.Status.APPROVED, "2.0"),
            (1, "Absent", -10, -10, HubLeaveApproval.Status.APPROVED, None),
            (2, "Vacation", 5, 7, HubLeaveApproval.Status.PENDING, None),
            (3, "Absent", -5, -4, HubLeaveApproval.Status.REJECTED, None),
            (4, "Late Arrival", -3, -3, HubLeaveApproval.Status.APPROVED, None),
            (5, "Vacation", -40, -36, HubLeaveApproval.Status.APPROVED, "4.0"),
            (6, "Absent", -2, -2, HubLeaveApproval.Status.PENDING, None),
            (7, "Vacation", 14, 16, HubLeaveApproval.Status.PENDING, None),
            (8, "Absent", -15, -15, HubLeaveApproval.Status.APPROVED, None),
            (9, "Late Arrival", -1, -1, HubLeaveApproval.Status.APPROVED, None),
            (0, "Absent", -8, -8, HubLeaveApproval.Status.APPROVED, None),
            (5, "Late Arrival", -12, -12, HubLeaveApproval.Status.APPROVED, None),
        ]
        # Clear old demo leave on this form so re-runs don't duplicate forever
        HubLeaveApproval.objects.filter(submission__form=form).delete()
        HubFormSubmission.objects.filter(form=form).delete()

        for user_idx, leave_type, start_off, end_off, status, deduct in scenarios:
            user = users[user_idx]
            start = today + timedelta(days=start_off)
            end = today + timedelta(days=end_off)
            created = _aware(datetime.combine(start - timedelta(days=2), datetime.min.time()))
            submission = HubFormSubmission.objects.create(
                form=form,
                answers={
                    ids["start"]: start.isoformat(),
                    ids["end"]: end.isoformat(),
                    ids["user"]: [str(user.id)],
                    ids["type"]: leave_type,
                },
            )
            # Force created_at for analytics date ranges
            HubFormSubmission.objects.filter(pk=submission.pk).update(created_at=created)
            decided = None
            if status != HubLeaveApproval.Status.PENDING:
                decided = created + timedelta(hours=6)
            approval = HubLeaveApproval.objects.create(
                submission=submission,
                status=status,
                decided_at=decided,
                jobber_task_id=f"demo-task-{uuid.uuid4().hex[:8]}"
                if status == HubLeaveApproval.Status.APPROVED
                else "",
                vacation_days_deducted=Decimal(deduct) if deduct else None,
            )
            HubLeaveApproval.objects.filter(pk=approval.pk).update(
                created_at=created, updated_at=created
            )

    def _seed_visits(self, users: list[HubUser]) -> list[HubVisit]:
        HubVisit.objects.filter(jobber_visit_id__startswith="demo-visit-").delete()
        visits = []
        clients = [
            ("Acme Offices", "demo-client-1"),
            ("Bright Homes", "demo-client-2"),
            ("City Clinic", "demo-client-3"),
            ("Harbor Hotel", "demo-client-4"),
            ("Maple Condos", "demo-client-5"),
        ]
        now = timezone.now()
        for i in range(12):
            client_name, client_id = clients[i % len(clients)]
            start = now - timedelta(days=30 - i * 2, hours=9)
            visit = HubVisit.objects.create(
                jobber_visit_id=f"demo-visit-{i + 1:03d}",
                title=f"Demo visit {i + 1} — {client_name}",
                client_jobber_id=client_id,
                client_name=client_name,
                jobber_job_id=f"demo-job-{(i % 5) + 1}",
                job_type="recurring" if i % 3 else "one_off",
                start_at=start,
            )
            techs = [users[i % 10], users[(i + 3) % 10]]
            visit.technicians.set(techs)
            visits.append(visit)
        return visits

    def _seed_lock_ins(self, users: list[HubUser], visits: list[HubVisit]) -> list[PendingLockIn]:
        PendingLockIn.objects.filter(quote_id__startswith="demo-").delete()
        now = timezone.now()
        specs = [
            ("demo-quote-001", "Acme Offices", "demo-client-1", PendingLockIn.Status.CONFIRMED, True, [0, 1]),
            ("demo-quote-002", "Bright Homes", "demo-client-2", PendingLockIn.Status.IN_PROCESS, False, [2, 3]),
            ("demo-quote-003", "City Clinic", "demo-client-3", PendingLockIn.Status.EXPIRED, False, [4]),
            ("demo-quote-004", "Harbor Hotel", "demo-client-4", PendingLockIn.Status.CONFIRMED, True, [5, 9]),
            ("demo-quote-005", "Maple Condos", "demo-client-5", PendingLockIn.Status.IN_PROCESS, False, [6, 7, 8]),
        ]
        pendings = []
        for i, (qid, cname, cid, status, locked, tech_idxs) in enumerate(specs):
            created = now - timedelta(days=45 - i * 7)
            pending = PendingLockIn.objects.create(
                quote_id=qid,
                client_jobber_id=cid,
                client_name=cname,
                recurring_jobber_job_id=f"demo-recurring-{i + 1}",
                original_visit_ids=[visits[i].jobber_visit_id] if i < len(visits) else [],
                quote_accepted=True,
                locked_in=locked,
                locked_at=created + timedelta(days=10) if locked else None,
                quote_sent_at=created,
                quote_approved_at=created + timedelta(days=2),
                frequency="weekly",
                eligibility_expires_at=created + timedelta(days=90),
                expected_first_visit_at=created + timedelta(days=14),
                first_recurring_visit_id=visits[i].jobber_visit_id if locked and i < len(visits) else "",
                first_recurring_visit_at=created + timedelta(days=14) if locked else None,
                status=status,
                expired_reason="Eligibility window passed" if status == PendingLockIn.Status.EXPIRED else "",
                confirmation_sms_sent=locked,
            )
            techs = [users[j] for j in tech_idxs]
            pending.technicians.set(techs)
            PendingLockIn.objects.filter(pk=pending.pk).update(created_at=created)

            for tech in techs:
                amount = {
                    "Team Leader": Decimal("20"),
                    "Cleaning Specialist": Decimal("15"),
                    "Cleaning Technician": Decimal("10"),
                }.get(tech.position, Decimal("10"))
                if status == PendingLockIn.Status.CONFIRMED:
                    b_status = LockInBonus.Status.PAID if tech == techs[0] else LockInBonus.Status.CONFIRMED
                elif status == PendingLockIn.Status.EXPIRED:
                    b_status = LockInBonus.Status.EXPIRED
                else:
                    b_status = LockInBonus.Status.IN_PROCESS
                bonus = LockInBonus.objects.create(
                    pending=pending,
                    technician=tech,
                    bonus_type="Locked-In",
                    status=b_status,
                    amount=amount,
                    position_snapshot=tech.position,
                    in_process_date=created,
                    confirmed_date=created + timedelta(days=10)
                    if b_status in (LockInBonus.Status.CONFIRMED, LockInBonus.Status.PAID)
                    else None,
                    bonus_confirmed=b_status
                    in (LockInBonus.Status.CONFIRMED, LockInBonus.Status.PAID),
                    bonus_paid=b_status == LockInBonus.Status.PAID,
                    paid_date=created + timedelta(days=20)
                    if b_status == LockInBonus.Status.PAID
                    else None,
                    payroll_reference=f"PR-DEMO-{qid[-3:]}"
                    if b_status == LockInBonus.Status.PAID
                    else "",
                )
                LockInBonus.objects.filter(pk=bonus.pk).update(created_at=created)
            pendings.append(pending)
        return pendings

    def _seed_notifications(self, users: list[HubUser], pendings: list[PendingLockIn]):
        HubNotification.objects.filter(event_key__startswith="demo:").delete()
        now = timezone.now()
        samples = [
            (0, "leave_approved", "Vacation approved", "Your vacation request was approved."),
            (1, "leave_submitted", "Absence submitted", "An absence request needs review."),
            (5, "leave_approved", "Vacation approved", "4 vacation days deducted."),
            (2, "leave_submitted", "Pending leave", "Waiting on admin decision."),
            (9, "leave_approved", "Late arrival noted", "Late arrival request approved."),
        ]
        for i, (uidx, ntype, title, body) in enumerate(samples):
            HubNotification.objects.create(
                recipient=users[uidx],
                type=ntype,
                title=title,
                body=body,
                link="/admin/calendar",
                payload={"demo": True},
                event_key=f"demo:notif:{i}",
                read_at=None if i % 2 == 0 else now - timedelta(hours=i),
            )
