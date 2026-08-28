import uuid
from decimal import Decimal

from django.contrib.auth.models import User
from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class HubUser(TimeStampedModel):
    class Role(models.TextChoices):
        EMPLOYEE = "employee", "Employee"
        CONTRACTOR = "contractor", "Contractor"
        ADMIN = "admin", "Admin"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    auth_user = models.OneToOneField(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="hub_profile",
    )
    name = models.CharField(max_length=255)
    email = models.EmailField(blank=True, default="")
    phone = models.CharField(max_length=64, blank=True, default="")
    role = models.CharField(
        max_length=32, choices=Role.choices, default=Role.EMPLOYEE
    )
    status = models.CharField(
        max_length=32, choices=Status.choices, default=Status.ACTIVE
    )
    sectors = models.JSONField(default=list, blank=True)
    work_days = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True
    )
    picture = models.TextField(blank=True, default="")
    position = models.CharField(max_length=128, blank=True, default="")
    jobber_id = models.CharField(max_length=128, blank=True, default="")
    ghl_id = models.CharField(max_length=128, blank=True, default="")
    hire_date = models.DateField(null=True, blank=True)
    available_vacation_days = models.DecimalField(
        max_digits=6, decimal_places=1, default=Decimal("0")
    )
    vacation_balance_reset_on = models.DateField(null=True, blank=True)
    regular_rate = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    drive_time_rate = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    fc_rate = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    tr_rate = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    supplies_deduction = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    # False until staff completes Set password (or admin seeds a password)
    password_configured = models.BooleanField(default=False)
    # Phone OTP (cleared after successful verify)
    otp_code = models.CharField(max_length=6, blank=True, null=True, default=None)
    otp_created_at = models.DateTimeField(blank=True, null=True, default=None)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["role"]),
            models.Index(fields=["status"]),
            models.Index(fields=["email"]),
            models.Index(fields=["jobber_id"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.role})"


LOCK_IN_POSITION_AMOUNTS = {
    "team leader": 20,
    "cleaning specialist": 15,
    "cleaning technician": 10,
}

LOCK_IN_POSITION_ALIASES = {
    "team leader": "Team Leader",
    "teamleader": "Team Leader",
    "team lead": "Team Leader",
    "tl": "Team Leader",
    "cleaning specialist": "Cleaning Specialist",
    "specialist": "Cleaning Specialist",
    "cleaning technician": "Cleaning Technician",
    "technician": "Cleaning Technician",
    "tech": "Cleaning Technician",
}


def normalize_lock_in_position(raw: str) -> str:
    key = " ".join((raw or "").strip().lower().split())
    return LOCK_IN_POSITION_ALIASES.get(key, (raw or "").strip())


def lock_in_bonus_amount(raw_position: str):
    """Return (canonical_position, Decimal amount). Unknown position → amount 0."""
    canonical = normalize_lock_in_position(raw_position)
    key = " ".join(canonical.lower().split())
    amount = LOCK_IN_POSITION_AMOUNTS.get(key)
    if amount is None:
        return canonical, Decimal("0")
    return canonical, Decimal(amount)


class HubForm(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    url = models.CharField(max_length=512, blank=True, default="")
    slug = models.SlugField(max_length=80, unique=True)
    status = models.CharField(
        max_length=32, choices=Status.choices, default=Status.ACTIVE
    )
    fields = models.JSONField(default=list, blank=True)
    extra_fields = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name


class HubFormSubmission(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    form = models.ForeignKey(
        HubForm, on_delete=models.CASCADE, related_name="submissions"
    )
    answers = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Submission {self.id} → {self.form.slug}"


class HubLeaveApproval(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    submission = models.OneToOneField(
        HubFormSubmission,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="leave_approval",
    )
    status = models.CharField(
        max_length=32, choices=Status.choices, default=Status.PENDING
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    jobber_task_id = models.CharField(max_length=255, blank=True, default="")
    jobber_task_synced_at = models.DateTimeField(null=True, blank=True)
    jobber_sync_error = models.TextField(blank=True, default="")
    vacation_days_deducted = models.DecimalField(
        max_digits=6, decimal_places=1, null=True, blank=True
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Leave {self.submission_id}: {self.status}"


class HubNotification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.ForeignKey(
        HubUser,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    type = models.CharField(max_length=64)
    title = models.CharField(max_length=255)
    body = models.TextField()
    link = models.CharField(max_length=512, blank=True, default="")
    payload = models.JSONField(default=dict, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Idempotency for a given event (leave transition, submit, etc.)
    event_key = models.CharField(max_length=191, unique=True, null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["recipient", "read_at", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.type} → {self.recipient_id}"


class HubResourceFolder(TimeStampedModel):
    """Organizational folder for training materials and documents (replaces free-text categories)."""

    class Kind(models.TextChoices):
        TRAINING = "training", "Training"
        DOCUMENTS = "documents", "Documents"
        BOTH = "both", "Both"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=128)
    kind = models.CharField(max_length=32, choices=Kind.choices, default=Kind.BOTH)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]
        unique_together = [("name", "kind")]

    def __str__(self) -> str:
        return self.name


class HubTrainingMaterial(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    category = models.CharField(max_length=128, blank=True, default="")
    folder = models.ForeignKey(
        HubResourceFolder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="training_materials",
    )
    description = models.TextField(blank=True, default="")
    video_url = models.TextField(blank=True, default="")
    # Empty list = visible to all positions
    visible_positions = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title


class HubDocument(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    category = models.CharField(max_length=128, blank=True, default="")
    folder = models.ForeignKey(
        HubResourceFolder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="documents",
    )
    description = models.TextField(blank=True, default="")
    file_path = models.CharField(max_length=512, blank=True, default="")
    file_name = models.CharField(max_length=255, blank=True, default="")
    file_type = models.CharField(max_length=128, blank=True, default="")
    file_size = models.BigIntegerField(default=0)
    # Empty list = visible to all positions
    visible_positions = models.JSONField(default=list, blank=True)
    allow_download = models.BooleanField(default=True)
    # Soft copy deterrent for in-app viewers (not true DRM)
    allow_copy = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title


class HubAlert(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    message = models.TextField()
    active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "created_at"]

    def __str__(self) -> str:
        return self.message[:60]


class HubVisit(TimeStampedModel):
    """Jobber visit persistence (replaces Airtable Visits for lock-in)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    jobber_visit_id = models.CharField(max_length=255, unique=True)
    title = models.CharField(max_length=512, blank=True, default="")
    client_jobber_id = models.CharField(max_length=255, blank=True, default="")
    client_name = models.CharField(max_length=255, blank=True, default="")
    jobber_job_id = models.CharField(max_length=255, blank=True, default="")
    job_type = models.CharField(max_length=64, blank=True, default="")
    start_at = models.DateTimeField(null=True, blank=True)
    technicians = models.ManyToManyField(
        HubUser, blank=True, related_name="jobber_visits"
    )

    class Meta:
        ordering = ["-start_at", "-created_at"]
        indexes = [
            models.Index(fields=["client_jobber_id"]),
            models.Index(fields=["jobber_job_id"]),
        ]

    def __str__(self) -> str:
        return self.jobber_visit_id


class PendingLockIn(TimeStampedModel):
    """Airtable Pending Quotes replacement."""

    class Status(models.TextChoices):
        IN_PROCESS = "in_process", "In Process"
        CONFIRMED = "confirmed", "Confirmed"
        EXPIRED = "expired", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quote_id = models.CharField(max_length=255, unique=True)
    client_jobber_id = models.CharField(max_length=255, db_index=True)
    client_name = models.CharField(max_length=255, blank=True, default="")
    recurring_jobber_job_id = models.CharField(max_length=255, blank=True, default="")
    original_visit_ids = models.JSONField(default=list, blank=True)
    quote_accepted = models.BooleanField(default=True)
    locked_in = models.BooleanField(default=False)
    locked_at = models.DateTimeField(null=True, blank=True)
    quote_sent_at = models.DateTimeField(null=True, blank=True)
    quote_approved_at = models.DateTimeField(null=True, blank=True)
    frequency = models.CharField(max_length=64, blank=True, default="")
    eligibility_expires_at = models.DateTimeField(null=True, blank=True)
    expected_first_visit_at = models.DateTimeField(null=True, blank=True)
    first_recurring_visit_id = models.CharField(max_length=255, blank=True, default="")
    first_recurring_visit_at = models.DateTimeField(null=True, blank=True)
    technicians = models.ManyToManyField(
        HubUser, blank=True, related_name="pending_lock_ins"
    )
    status = models.CharField(
        max_length=32, choices=Status.choices, default=Status.IN_PROCESS
    )
    expired_reason = models.CharField(max_length=255, blank=True, default="")
    confirmation_sms_sent = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["client_jobber_id", "locked_in"]),
            models.Index(fields=["status"]),
        ]

    def __str__(self) -> str:
        return f"{self.client_name} quote {self.quote_id}"


class LockInBonus(TimeStampedModel):
    """Per-technician lock-in bonus (replaces Airtable Bonuses Locked-In rows)."""

    class Status(models.TextChoices):
        IN_PROCESS = "in_process", "In Process"
        CONFIRMED = "confirmed", "Confirmed"
        EXPIRED = "expired", "Expired"
        PAID = "paid", "Paid"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pending = models.ForeignKey(
        PendingLockIn, on_delete=models.CASCADE, related_name="bonuses"
    )
    technician = models.ForeignKey(
        HubUser, on_delete=models.PROTECT, related_name="lock_in_bonuses"
    )
    bonus_type = models.CharField(max_length=64, default="Locked-In")
    status = models.CharField(
        max_length=32, choices=Status.choices, default=Status.IN_PROCESS
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    position_snapshot = models.CharField(max_length=128, blank=True, default="")
    in_process_date = models.DateTimeField(null=True, blank=True)
    confirmed_date = models.DateTimeField(null=True, blank=True)
    bonus_confirmed = models.BooleanField(default=False)
    bonus_paid = models.BooleanField(default=False)
    paid_date = models.DateTimeField(null=True, blank=True)
    payroll_reference = models.CharField(max_length=255, blank=True, default="")
    potential_sms_sent = models.BooleanField(default=False)
    confirmation_sms_sent = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        unique_together = [("pending", "technician")]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["technician", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.bonus_type} {self.status} {self.technician_id}"


class HubApiKey(TimeStampedModel):
    """Server-to-server API key for external dashboard / analytics consumers."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=128)
    # Prefix shown in admin; full secret is never stored (only key_hash).
    prefix = models.CharField(max_length=16, db_index=True)
    key_hash = models.CharField(max_length=64, unique=True)
    is_active = models.BooleanField(default=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="hub_api_keys_created",
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["is_active", "prefix"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.prefix}…)"
