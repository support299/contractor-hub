from django.db import migrations, models


def backfill_picture_thumbs(apps, schema_editor):
    HubUser = apps.get_model("hub", "HubUser")
    from hub.services.pictures import picture_thumb

    for user in HubUser.objects.exclude(picture="").iterator():
        thumb = picture_thumb(user.picture or "")
        if thumb and thumb != (user.picture_thumb or ""):
            user.picture_thumb = thumb
            user.save(update_fields=["picture_thumb"])


class Migration(migrations.Migration):

    dependencies = [
        ("hub", "0013_notify_sms"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name="hubuser",
                    name="picture_thumb",
                    field=models.TextField(blank=True, default=""),
                ),
            ],
            database_operations=[
                migrations.RunSQL(
                    sql=(
                        "ALTER TABLE hub_hubuser "
                        "ADD COLUMN IF NOT EXISTS picture_thumb text NOT NULL DEFAULT '';"
                    ),
                    reverse_sql=(
                        "ALTER TABLE hub_hubuser DROP COLUMN IF EXISTS picture_thumb;"
                    ),
                ),
            ],
        ),
        migrations.RunPython(backfill_picture_thumbs, migrations.RunPython.noop),
    ]
