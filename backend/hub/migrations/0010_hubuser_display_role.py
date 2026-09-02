from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("hub", "0009_merge_0008_hubapikey_0008_hubtipconfirmlog"),
    ]

    operations = [
        migrations.AlterField(
            model_name="hubuser",
            name="role",
            field=models.CharField(
                choices=[
                    ("employee", "Employee"),
                    ("contractor", "Contractor"),
                    ("admin", "Admin"),
                    ("display", "Display (TV)"),
                ],
                default="employee",
                max_length=32,
            ),
        ),
    ]
