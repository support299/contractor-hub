"""Fill employee HubUser.phone from the GHL contact with the same email."""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from hub.models import HubUser
from hub.services.ghl import (
    GHLConfigError,
    phone_from_contact,
    search_contact_by_email,
)


class Command(BaseCommand):
    help = "Sync employee mobile numbers from GHL contacts matched by email"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print matches without writing to the database",
        )
        parser.add_argument(
            "--overwrite",
            action="store_true",
            help="Replace phones that are already set",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        overwrite = options["overwrite"]

        employees = HubUser.objects.filter(role=HubUser.Role.EMPLOYEE).order_by(
            "name"
        )
        skipped_no_email = 0
        skipped_has_phone = 0
        skipped_no_contact = 0
        skipped_no_phone = 0
        updated = 0
        errors = 0

        try:
            for user in employees:
                email = (user.email or "").strip()
                if not email:
                    skipped_no_email += 1
                    self.stdout.write(
                        f"SKIP no email: {user.name} ({user.id})"
                    )
                    continue

                existing = (user.phone or "").strip()
                if existing and not overwrite:
                    skipped_has_phone += 1
                    self.stdout.write(
                        f"SKIP has phone: {user.name} <{email}> {existing}"
                    )
                    continue

                try:
                    contact = search_contact_by_email(email)
                except GHLConfigError as exc:
                    raise CommandError(str(exc)) from exc
                except Exception as exc:  # noqa: BLE001 — keep syncing remaining users
                    errors += 1
                    self.stderr.write(
                        f"ERROR search {user.name} <{email}>: {exc}"
                    )
                    continue

                if not contact:
                    skipped_no_contact += 1
                    self.stdout.write(
                        f"SKIP no GHL contact: {user.name} <{email}>"
                    )
                    continue

                phone = phone_from_contact(contact)
                if not phone:
                    skipped_no_phone += 1
                    self.stdout.write(
                        f"SKIP GHL contact has no phone: {user.name} <{email}> "
                        f"ghl_id={contact.get('id') or ''}"
                    )
                    continue

                ghl_id = str(contact.get("id") or "").strip()
                fields = ["phone", "updated_at"]
                if ghl_id and user.ghl_id != ghl_id:
                    user.ghl_id = ghl_id
                    fields.append("ghl_id")

                action = "DRY" if dry_run else "UPDATE"
                extra = f" ghl_id={ghl_id}" if ghl_id else ""
                self.stdout.write(
                    f"{action}: {user.name} <{email}> {existing or '(empty)'} -> {phone}{extra}"
                )

                if not dry_run:
                    user.phone = phone
                    user.save(update_fields=fields)
                updated += 1
        except GHLConfigError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            self.style.SUCCESS(
                "Done. "
                f"updated={updated} skipped_no_email={skipped_no_email} "
                f"skipped_has_phone={skipped_has_phone} "
                f"skipped_no_contact={skipped_no_contact} "
                f"skipped_no_phone={skipped_no_phone} errors={errors}"
                + (" (dry-run)" if dry_run else "")
            )
        )
