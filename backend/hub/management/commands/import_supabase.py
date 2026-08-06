"""
Import Supabase-exported hub data into Django.

Expected layout of --data-dir:

  data-dir/
    hub_users.json
    hub_forms.json
    hub_form_submissions.json
    hub_leave_approvals.json
    hub_training_materials.json
    hub_documents.json
    hub_alerts.json
    files/                  # optional Storage mirror
      form-uploads/...
      hub-documents/...

Each JSON file is an array of row objects (Supabase table export / pg dump as JSON).
UUIDs are preserved when present.
"""

from __future__ import annotations

import json
import shutil
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.dateparse import parse_datetime

from hub.models import (
    HubAlert,
    HubDocument,
    HubForm,
    HubFormSubmission,
    HubLeaveApproval,
    HubResourceFolder,
    HubTrainingMaterial,
    HubUser,
)


def _load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "data" in data:
        data = data["data"]
    if not isinstance(data, list):
        raise CommandError(f"{path} must be a JSON array")
    return data


def _dec(v):
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError):
        return None


def _dt(v):
    if not v:
        return None
    if isinstance(v, str):
        return parse_datetime(v.replace("Z", "+00:00"))
    return v


class Command(BaseCommand):
    help = "Import exported Supabase hub_* JSON (+ optional files/) into Django"

    def add_arguments(self, parser):
        parser.add_argument(
            "--data-dir",
            required=True,
            help="Directory containing hub_*.json and optional files/",
        )
        parser.add_argument(
            "--skip-files",
            action="store_true",
            help="Do not copy Storage files into MEDIA_ROOT",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete existing hub rows before import (destructive)",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        data_dir = Path(options["data_dir"]).resolve()
        if not data_dir.is_dir():
            raise CommandError(f"Not a directory: {data_dir}")

        if options["clear"]:
            self.stdout.write(self.style.WARNING("Clearing existing hub data…"))
            HubLeaveApproval.objects.all().delete()
            HubFormSubmission.objects.all().delete()
            HubForm.objects.all().delete()
            HubDocument.objects.all().delete()
            HubTrainingMaterial.objects.all().delete()
            HubAlert.objects.all().delete()
            HubUser.objects.all().delete()

        users = _load(data_dir / "hub_users.json")
        for r in users:
            HubUser.objects.update_or_create(
                id=r["id"],
                defaults={
                    "name": r.get("name") or "",
                    "email": r.get("email") or "",
                    "phone": r.get("phone") or "",
                    "role": r.get("role") or "employee",
                    "status": r.get("status") or "active",
                    "sectors": r.get("sectors") or [],
                    "work_days": _dec(r.get("work_days")),
                    "picture": r.get("picture") or "",
                    "position": r.get("position") or "",
                    "jobber_id": r.get("jobber_id") or "",
                    "ghl_id": r.get("ghl_id") or "",
                    "regular_rate": _dec(r.get("regular_rate")),
                    "drive_time_rate": _dec(r.get("drive_time_rate")),
                    "fc_rate": _dec(r.get("fc_rate")),
                    "tr_rate": _dec(r.get("tr_rate")),
                    "supplies_deduction": _dec(r.get("supplies_deduction")),
                },
            )
        self.stdout.write(f"  users: {len(users)}")

        forms = _load(data_dir / "hub_forms.json")
        for r in forms:
            HubForm.objects.update_or_create(
                id=r["id"],
                defaults={
                    "name": r.get("name") or "",
                    "description": r.get("description") or "",
                    "url": r.get("url") or "",
                    "slug": r.get("slug") or f"form-{str(r['id'])[:8]}",
                    "status": r.get("status") or "active",
                    "fields": r.get("fields") or [],
                    "extra_fields": r.get("extra_fields") or [],
                },
            )
        self.stdout.write(f"  forms: {len(forms)}")

        subs = _load(data_dir / "hub_form_submissions.json")
        for r in subs:
            form_id = r.get("form_id")
            if not HubForm.objects.filter(pk=form_id).exists():
                self.stdout.write(
                    self.style.WARNING(f"  skip submission {r.get('id')}: missing form")
                )
                continue
            obj, _ = HubFormSubmission.objects.update_or_create(
                id=r["id"],
                defaults={
                    "form_id": form_id,
                    "answers": r.get("answers") or {},
                },
            )
            created_at = _dt(r.get("created_at"))
            if created_at:
                HubFormSubmission.objects.filter(pk=obj.pk).update(created_at=created_at)
        self.stdout.write(f"  submissions: {len(subs)}")

        leaves = _load(data_dir / "hub_leave_approvals.json")
        for r in leaves:
            sid = r.get("submission_id")
            if not HubFormSubmission.objects.filter(pk=sid).exists():
                continue
            HubLeaveApproval.objects.update_or_create(
                submission_id=sid,
                defaults={
                    "status": r.get("status") or "pending",
                    "decided_at": _dt(r.get("decided_at")),
                },
            )
        self.stdout.write(f"  leave approvals: {len(leaves)}")

        training = _load(data_dir / "hub_training_materials.json")
        for r in training:
            category = r.get("category") or ""
            folder = None
            if category.strip():
                folder, _ = HubResourceFolder.objects.get_or_create(
                    name=category.strip(),
                    kind=HubResourceFolder.Kind.TRAINING,
                    defaults={"sort_order": 0},
                )
            HubTrainingMaterial.objects.update_or_create(
                id=r["id"],
                defaults={
                    "title": r.get("title") or "",
                    "category": category,
                    "folder": folder,
                    "description": r.get("description") or "",
                    "video_url": r.get("video_url") or "",
                    # New fields not in Supabase — safe defaults
                    "visible_positions": r.get("visible_positions") or [],
                },
            )
        self.stdout.write(f"  training: {len(training)}")

        docs = _load(data_dir / "hub_documents.json")
        for r in docs:
            category = r.get("category") or ""
            folder = None
            if category.strip():
                folder, _ = HubResourceFolder.objects.get_or_create(
                    name=category.strip(),
                    kind=HubResourceFolder.Kind.DOCUMENTS,
                    defaults={"sort_order": 0},
                )
            HubDocument.objects.update_or_create(
                id=r["id"],
                defaults={
                    "title": r.get("title") or "",
                    "category": category,
                    "folder": folder,
                    "description": r.get("description") or "",
                    "file_path": r.get("file_path") or "",
                    "file_name": r.get("file_name") or "",
                    "file_type": r.get("file_type") or "",
                    "file_size": int(r.get("file_size") or 0),
                    # New fields not in Supabase — safe defaults
                    "visible_positions": r.get("visible_positions") or [],
                    "allow_download": bool(r.get("allow_download", True)),
                    "allow_copy": bool(r.get("allow_copy", False)),
                },
            )
        self.stdout.write(f"  documents: {len(docs)}")

        alerts = _load(data_dir / "hub_alerts.json")
        for r in alerts:
            HubAlert.objects.update_or_create(
                id=r["id"],
                defaults={
                    "message": r.get("message") or "",
                    "active": bool(r.get("active", True)),
                    "sort_order": int(r.get("sort_order") or 0),
                },
            )
        self.stdout.write(f"  alerts: {len(alerts)}")

        if not options["skip_files"]:
            files_src = data_dir / "files"
            if files_src.is_dir():
                from django.conf import settings as dj_settings
                from django.core.files import File
                from hub.services.storage import save_file, use_s3

                if use_s3():
                    # Upload each file into the S3 bucket under the same relative key
                    count = 0
                    for path in files_src.rglob("*"):
                        if not path.is_file():
                            continue
                        relative = path.relative_to(files_src).as_posix()
                        with path.open("rb") as fh:
                            save_file(relative, File(fh, name=path.name))
                        count += 1
                    self.stdout.write(f"  uploaded {count} files to S3")
                else:
                    dest = Path(dj_settings.MEDIA_ROOT)
                    dest.mkdir(parents=True, exist_ok=True)
                    for bucket in ("form-uploads", "hub-documents"):
                        src_bucket = files_src / bucket
                        if src_bucket.is_dir():
                            target = dest / bucket
                            if target.exists():
                                shutil.copytree(src_bucket, target, dirs_exist_ok=True)
                            else:
                                shutil.copytree(src_bucket, target)
                            self.stdout.write(f"  copied files/{bucket}")
            else:
                self.stdout.write("  no files/ directory — skipped media copy")

        self.stdout.write(self.style.SUCCESS("Import complete."))
