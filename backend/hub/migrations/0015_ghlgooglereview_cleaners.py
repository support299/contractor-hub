from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("hub", "0014_hubuser_picture_thumb"),
    ]

    operations = [
        migrations.AddField(
            model_name="ghlgooglereview",
            name="cleaners",
            field=models.ManyToManyField(
                blank=True,
                related_name="google_reviews",
                to="hub.hubuser",
            ),
        ),
    ]
