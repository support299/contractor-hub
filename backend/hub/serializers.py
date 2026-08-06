from django.contrib.auth.models import User
from rest_framework import serializers

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


class HubUserSerializer(serializers.ModelSerializer):
    workDays = serializers.DecimalField(
        source="work_days",
        max_digits=8,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    jobberId = serializers.CharField(
        source="jobber_id", required=False, allow_blank=True, default=""
    )
    ghlId = serializers.CharField(
        source="ghl_id", required=False, allow_blank=True, default=""
    )
    regularRate = serializers.DecimalField(
        source="regular_rate",
        max_digits=10,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    driveTimeRate = serializers.DecimalField(
        source="drive_time_rate",
        max_digits=10,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    fcRate = serializers.DecimalField(
        source="fc_rate",
        max_digits=10,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    trRate = serializers.DecimalField(
        source="tr_rate",
        max_digits=10,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    suppliesDeduction = serializers.DecimalField(
        source="supplies_deduction",
        max_digits=10,
        decimal_places=2,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = HubUser
        fields = [
            "id",
            "name",
            "email",
            "phone",
            "role",
            "status",
            "sectors",
            "workDays",
            "picture",
            "position",
            "jobberId",
            "ghlId",
            "regularRate",
            "driveTimeRate",
            "fcRate",
            "trRate",
            "suppliesDeduction",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class HubFormSerializer(serializers.ModelSerializer):
    extraFields = serializers.JSONField(source="extra_fields", required=False)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = HubForm
        fields = [
            "id",
            "name",
            "description",
            "url",
            "slug",
            "status",
            "fields",
            "extraFields",
            "createdAt",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "createdAt"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Frontend store shape
        data["extraFields"] = instance.extra_fields or []
        data["createdAt"] = instance.created_at.isoformat() if instance.created_at else None
        return data


class HubFormSubmissionSerializer(serializers.ModelSerializer):
    formId = serializers.UUIDField(source="form_id", required=False)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    answers = serializers.JSONField(required=False)

    class Meta:
        model = HubFormSubmission
        fields = ["id", "formId", "answers", "createdAt", "created_at"]
        read_only_fields = ["id", "created_at", "createdAt"]

    def create(self, validated_data):
        form_id = validated_data.pop("form_id", None)
        if not form_id:
            raise serializers.ValidationError({"formId": "This field is required."})
        form = HubForm.objects.get(pk=form_id)
        return HubFormSubmission.objects.create(form=form, **validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("form_id", None)
        if "answers" in validated_data:
            instance.answers = validated_data["answers"]
        instance.save()
        return instance

    def to_representation(self, instance):
        return {
            "id": str(instance.id),
            "formId": str(instance.form_id),
            "answers": instance.answers or {},
            "createdAt": instance.created_at.isoformat() if instance.created_at else None,
        }


class HubLeaveApprovalSerializer(serializers.ModelSerializer):
    submission_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = HubLeaveApproval
        fields = [
            "submission_id",
            "status",
            "decided_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["submission_id", "created_at", "updated_at"]


class HubTrainingMaterialSerializer(serializers.ModelSerializer):
    folder_id = serializers.UUIDField(allow_null=True, required=False)
    folder_name = serializers.SerializerMethodField()

    class Meta:
        model = HubTrainingMaterial
        fields = [
            "id",
            "title",
            "category",
            "folder_id",
            "folder_name",
            "description",
            "video_url",
            "visible_positions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "folder_name"]

    def get_folder_name(self, obj):
        return obj.folder.name if obj.folder_id else ""

    def to_internal_value(self, data):
        folder_id = data.get("folder_id", serializers.empty)
        ret = super().to_internal_value(
            {k: v for k, v in data.items() if k != "folder_id"}
        )
        if folder_id is serializers.empty:
            ret["_folder_id"] = serializers.empty
        elif folder_id in (None, ""):
            ret["_folder_id"] = None
        else:
            ret["_folder_id"] = folder_id
        return ret

    def _apply_folder(self, obj, folder_id):
        if folder_id is serializers.empty:
            return
        folder = (
            HubResourceFolder.objects.filter(pk=folder_id).first() if folder_id else None
        )
        obj.folder = folder
        obj.category = folder.name if folder else (obj.category or "")

    def create(self, validated_data):
        folder_id = validated_data.pop("_folder_id", serializers.empty)
        obj = HubTrainingMaterial(**validated_data)
        self._apply_folder(obj, folder_id)
        obj.save()
        return obj

    def update(self, instance, validated_data):
        folder_id = validated_data.pop("_folder_id", serializers.empty)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        self._apply_folder(instance, folder_id)
        instance.save()
        return instance

    def to_representation(self, instance):
        return {
            "id": str(instance.id),
            "title": instance.title,
            "category": instance.category,
            "folder_id": str(instance.folder_id) if instance.folder_id else None,
            "folder_name": instance.folder.name if instance.folder_id else "",
            "description": instance.description,
            "video_url": instance.video_url,
            "visible_positions": instance.visible_positions or [],
            "created_at": instance.created_at.isoformat() if instance.created_at else None,
        }


class HubDocumentSerializer(serializers.ModelSerializer):
    folder_id = serializers.UUIDField(allow_null=True, required=False)

    class Meta:
        model = HubDocument
        fields = [
            "id",
            "title",
            "category",
            "folder_id",
            "description",
            "file_path",
            "file_name",
            "file_type",
            "file_size",
            "visible_positions",
            "allow_download",
            "allow_copy",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def to_internal_value(self, data):
        folder_id = data.get("folder_id", serializers.empty)
        ret = super().to_internal_value(
            {k: v for k, v in data.items() if k != "folder_id"}
        )
        if folder_id is serializers.empty:
            ret["_folder_id"] = serializers.empty
        elif folder_id in (None, ""):
            ret["_folder_id"] = None
        else:
            ret["_folder_id"] = folder_id
        return ret

    def _apply_folder(self, obj, folder_id):
        if folder_id is serializers.empty:
            return
        folder = (
            HubResourceFolder.objects.filter(pk=folder_id).first() if folder_id else None
        )
        obj.folder = folder
        obj.category = folder.name if folder else (obj.category or "")

    def create(self, validated_data):
        folder_id = validated_data.pop("_folder_id", serializers.empty)
        obj = HubDocument(**validated_data)
        self._apply_folder(obj, folder_id)
        obj.save()
        return obj

    def update(self, instance, validated_data):
        folder_id = validated_data.pop("_folder_id", serializers.empty)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        self._apply_folder(instance, folder_id)
        instance.save()
        return instance

    def to_representation(self, instance):
        return {
            "id": str(instance.id),
            "title": instance.title,
            "category": instance.category,
            "folder_id": str(instance.folder_id) if instance.folder_id else None,
            "folder_name": instance.folder.name if instance.folder_id else "",
            "description": instance.description,
            "file_path": instance.file_path,
            "file_name": instance.file_name,
            "file_type": instance.file_type,
            "file_size": instance.file_size,
            "visible_positions": instance.visible_positions or [],
            "allow_download": instance.allow_download,
            "allow_copy": instance.allow_copy,
            "created_at": instance.created_at.isoformat() if instance.created_at else None,
        }


class HubResourceFolderSerializer(serializers.ModelSerializer):
    class Meta:
        model = HubResourceFolder
        fields = [
            "id",
            "name",
            "kind",
            "sort_order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class HubAlertSerializer(serializers.ModelSerializer):
    sortOrder = serializers.IntegerField(source="sort_order", required=False)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = HubAlert
        fields = [
            "id",
            "message",
            "active",
            "sortOrder",
            "createdAt",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "createdAt"]

    def to_representation(self, instance):
        return {
            "id": str(instance.id),
            "message": instance.message,
            "active": instance.active,
            "sortOrder": instance.sort_order,
            "createdAt": instance.created_at.isoformat() if instance.created_at else None,
        }


class OtpLoginSerializer(serializers.Serializer):
    identifier = serializers.CharField()
    role = serializers.ChoiceField(choices=HubUser.Role.choices)
    otp = serializers.CharField()


class PasswordLoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


class MeSerializer(serializers.Serializer):
    userId = serializers.UUIDField()
    role = serializers.CharField()
    identifier = serializers.CharField()
    name = serializers.CharField()
    email = serializers.CharField()


class FileUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    prefix = serializers.CharField(required=False, default="submissions")
    bucket = serializers.ChoiceField(
        choices=["form-uploads", "hub-documents"],
        default="form-uploads",
        required=False,
    )
