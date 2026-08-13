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
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.role})"


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
