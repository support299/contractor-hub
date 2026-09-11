from django.core.management.base import BaseCommand

from hub.services.ghl_internal import GhlInternalApiError, GhlInternalConfigError, refresh_internal_token


class Command(BaseCommand):
    help = "Refresh GHL internal (Firebase) Token-Id used for Reputation APIs."

    def handle(self, *args, **options):
        try:
            obj = refresh_internal_token()
        except (GhlInternalConfigError, GhlInternalApiError) as exc:
            self.stderr.write(self.style.ERROR(str(exc)))
            return
        self.stdout.write(self.style.SUCCESS(f"Refreshed token for {obj.location_id}"))
