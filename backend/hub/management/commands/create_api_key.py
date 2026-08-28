"""Create a Hub API key for external dashboard analytics access."""

from django.core.management.base import BaseCommand

from hub.api_keys import generate_api_key
from hub.models import HubApiKey


class Command(BaseCommand):
    help = (
        "Create an API key for /api/admin-internal-app/analytics/. "
        "The full key is printed once — store it in the dashboard app."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--name",
            default="Dashboard",
            help="Label for this key (e.g. 'All-in-one dashboard')",
        )

    def handle(self, *args, **options):
        name = (options.get("name") or "Dashboard").strip() or "Dashboard"
        raw, prefix, key_hash = generate_api_key()
        obj = HubApiKey.objects.create(
            name=name,
            prefix=prefix,
            key_hash=key_hash,
            is_active=True,
        )
        self.stdout.write(self.style.SUCCESS(f"Created API key id={obj.id}"))
        self.stdout.write(f"Name:   {obj.name}")
        self.stdout.write(f"Prefix: {obj.prefix}…")
        self.stdout.write("")
        self.stdout.write(self.style.WARNING("Store this key now — it will not be shown again:"))
        self.stdout.write(raw)
        self.stdout.write("")
        self.stdout.write("Use it as:")
        self.stdout.write(f"  X-API-Key: {raw}")
        self.stdout.write(f"  or Authorization: Api-Key {raw}")
        self.stdout.write("Endpoint: GET /api/admin-internal-app/analytics/")
