"""Add the form fields the Insights analytics export reads.

Safe to re-run: a field is only added when no field with that label exists yet.
Existing submissions are untouched (they simply have no value for the new fields).
"""

import secrets

from django.core.management.base import BaseCommand

from hub.models import HubForm

STATUS_OPTIONS = ["Open", "In progress", "Resolved"]

# slug -> [(label, type, options)]
ADDITIONS = {
    "new-complaint": [
        ("Status", "dropdown", STATUS_OPTIONS),
        ("Resolved date", "date", None),
    ],
    "how-are-we-doing": [("Visit date", "date", None), ("Email", "single_line", None)],
    "review-your-recent-experience": [
        ("Visit date", "date", None),
        ("Email", "single_line", None),
    ],
    "service-cancellation-form": [("Email", "single_line", None)],
}


def _new_id() -> str:
    return f"f_{secrets.token_hex(4)}"[:10]


class Command(BaseCommand):
    help = "Add Status/Resolved date (complaints), Visit date and Email (reviews), Email (cancellations)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run", action="store_true", help="Show what would change, write nothing."
        )

    def handle(self, *args, **options):
        dry = options["dry_run"]
        for slug, additions in ADDITIONS.items():
            form = HubForm.objects.filter(slug=slug).first()
            if form is None:
                self.stdout.write(self.style.WARNING(f"{slug}: form not found, skipped"))
                continue
            fields = list(form.fields or [])
            have = {(f.get("label") or "").strip().lower() for f in fields if isinstance(f, dict)}
            added = []
            for label, ftype, options_list in additions:
                if label.lower() in have:
                    continue
                field = {
                    "id": _new_id(),
                    "type": ftype,
                    "label": label,
                    "required": False,
                    "condition": None,
                }
                if options_list:
                    field["options"] = list(options_list)
                fields.append(field)
                added.append(label)
            if not added:
                self.stdout.write(f"{slug}: already up to date")
                continue
            if not dry:
                form.fields = fields
                form.save(update_fields=["fields", "updated_at"])
            verb = "would add" if dry else "added"
            self.stdout.write(self.style.SUCCESS(f"{slug}: {verb} {', '.join(added)}"))
