"""Create a Django + Hub admin user for local/dev login."""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from hub.models import HubUser
from hub.services.auth import ensure_auth_user


class Command(BaseCommand):
    help = "Create or update an admin HubUser and Django login credentials"

    def add_arguments(self, parser):
        parser.add_argument("--email", default="admin@cleaonthego.local")
        parser.add_argument("--password", default="admin123")
        parser.add_argument("--name", default="Admin")
        parser.add_argument("--phone", default="")

    def handle(self, *args, **options):
        email = options["email"]
        password = options["password"]
        name = options["name"]
        phone = options["phone"]

        hub_user, created = HubUser.objects.get_or_create(
            email=email,
            role=HubUser.Role.ADMIN,
            defaults={
                "name": name,
                "phone": phone,
                "status": HubUser.Status.ACTIVE,
            },
        )
        if not created:
            hub_user.name = name
            hub_user.status = HubUser.Status.ACTIVE
            hub_user.save()

        user = ensure_auth_user(hub_user)
        user.set_password(password)
        user.is_staff = True
        user.is_superuser = True
        user.email = email
        user.save()

        hub_user.password_configured = True
        hub_user.save(update_fields=["password_configured", "updated_at"])

        self.stdout.write(
            self.style.SUCCESS(
                f"{'Created' if created else 'Updated'} admin '{email}' "
                f"(password set). HubUser id={hub_user.id}"
            )
        )
