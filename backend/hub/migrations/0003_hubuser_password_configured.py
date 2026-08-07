from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("hub", "0002_hubdocument_allow_copy_hubdocument_allow_download_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="hubuser",
            name="password_configured",
            field=models.BooleanField(default=False),
        ),
    ]
