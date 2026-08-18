from django.contrib import admin

from .models import (
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


@admin.register(HubUser)
class HubUserAdmin(admin.ModelAdmin):
    list_display = ("name", "email", "role", "status", "position", "hire_date", "available_vacation_days", "created_at")
    list_filter = ("role", "status")
    search_fields = ("name", "email", "phone", "jobber_id", "ghl_id")
    raw_id_fields = ("auth_user",)


@admin.register(HubForm)
class HubFormAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(HubFormSubmission)
class HubFormSubmissionAdmin(admin.ModelAdmin):
    list_display = ("id", "form", "created_at")
    list_filter = ("form",)
    search_fields = ("id",)


@admin.register(HubLeaveApproval)
class HubLeaveApprovalAdmin(admin.ModelAdmin):
    list_display = ("submission", "status", "decided_at", "jobber_task_id", "created_at")
    list_filter = ("status",)


@admin.register(HubNotification)
class HubNotificationAdmin(admin.ModelAdmin):
    list_display = ("type", "recipient", "title", "read_at", "created_at")
    list_filter = ("type",)
    search_fields = ("title", "body", "event_key")
    raw_id_fields = ("recipient",)


@admin.register(HubResourceFolder)
class HubResourceFolderAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "sort_order", "created_at")
    list_filter = ("kind",)
    search_fields = ("name",)


@admin.register(HubTrainingMaterial)
class HubTrainingMaterialAdmin(admin.ModelAdmin):
    list_display = ("title", "folder", "category", "created_at")
    search_fields = ("title", "category")
    list_filter = ("folder",)


@admin.register(HubDocument)
class HubDocumentAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "folder",
        "allow_download",
        "allow_copy",
        "file_name",
        "file_size",
        "created_at",
    )
    search_fields = ("title", "file_name")
    list_filter = ("folder", "allow_download")


@admin.register(HubAlert)
class HubAlertAdmin(admin.ModelAdmin):
    list_display = ("message", "active", "sort_order", "created_at")
    list_filter = ("active",)


@admin.register(HubVisit)
class HubVisitAdmin(admin.ModelAdmin):
    list_display = (
        "jobber_visit_id",
        "client_name",
        "job_type",
        "start_at",
        "created_at",
    )
    search_fields = ("jobber_visit_id", "client_name", "client_jobber_id", "jobber_job_id")
    list_filter = ("job_type",)
    filter_horizontal = ("technicians",)


@admin.register(PendingLockIn)
class PendingLockInAdmin(admin.ModelAdmin):
    list_display = (
        "client_name",
        "quote_id",
        "status",
        "locked_in",
        "frequency",
        "eligibility_expires_at",
        "created_at",
    )
    search_fields = ("quote_id", "client_name", "client_jobber_id")
    list_filter = ("status", "locked_in")
    filter_horizontal = ("technicians",)


@admin.register(LockInBonus)
class LockInBonusAdmin(admin.ModelAdmin):
    list_display = (
        "technician",
        "status",
        "amount",
        "position_snapshot",
        "bonus_paid",
        "created_at",
    )
    list_filter = ("status", "bonus_paid", "bonus_type")
    search_fields = ("technician__name", "pending__client_name", "pending__quote_id")
    raw_id_fields = ("technician", "pending")
