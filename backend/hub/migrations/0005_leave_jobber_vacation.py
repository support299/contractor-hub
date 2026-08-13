from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("hub", "0004_hubuser_otp_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="hubuser",
            name="hire_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="hubuser",
            name="available_vacation_days",
            field=models.DecimalField(
                decimal_places=1, default=Decimal("0"), max_digits=6
            ),
        ),
        migrations.AddField(
            model_name="hubuser",
            name="vacation_balance_reset_on",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="hubleaveapproval",
            name="jobber_task_id",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="hubleaveapproval",
            name="jobber_task_synced_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="hubleaveapproval",
            name="jobber_sync_error",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="hubleaveapproval",
            name="vacation_days_deducted",
            field=models.DecimalField(
                blank=True, decimal_places=1, max_digits=6, null=True
            ),
        ),
    ]
