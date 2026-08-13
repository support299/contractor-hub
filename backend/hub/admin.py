from django.contrib import admin

from .models import (
    HubAlert,
    HubDocument,
    HubForm,
    HubFormSubmission,
    HubLeaveApproval,
    HubResourceFolder,
    HubTrainingMaterial,
    HubUser,
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
