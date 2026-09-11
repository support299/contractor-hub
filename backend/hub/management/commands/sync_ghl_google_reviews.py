from django.core.management.base import BaseCommand

from hub.services.ghl_internal import (
    GhlInternalApiError,
    GhlInternalConfigError,
    sync_google_reviews,
)


class Command(BaseCommand):
    help = "Pull Google reviews from GHL Reputation into the hub cache."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true")

    def handle(self, *args, **options):
        try:
            n = sync_google_reviews(force=bool(options.get("force")))
        except (GhlInternalConfigError, GhlInternalApiError) as exc:
            self.stderr.write(self.style.ERROR(str(exc)))
            return
        self.stdout.write(self.style.SUCCESS(f"Google reviews in cache: {n}"))
