import uuid
from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hub', '0017_work_hours_general'),
    ]

    operations = [
        migrations.CreateModel(
            name='HubPayVisit',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('jobber_visit_id', models.CharField(max_length=128, unique=True)),
                ('jobber_job_id', models.CharField(blank=True, default='', max_length=128)),
                ('job_number', models.CharField(blank=True, default='', max_length=32)),
                ('job_title', models.CharField(blank=True, default='', max_length=255)),
                ('client_jobber_id', models.CharField(blank=True, db_index=True, default='', max_length=128)),
                ('client_name', models.CharField(blank=True, default='', max_length=255)),
                ('visit_date', models.DateField(db_index=True)),
                ('status', models.CharField(max_length=16)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('assigned_user_ids', models.JSONField(blank=True, default=list)),
                ('visit_amount', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=10)),
                ('discount_share', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=10)),
                ('tip_share', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=10)),
                ('line_items_total', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('invoice_id', models.CharField(blank=True, default='', max_length=128)),
                ('invoice_subtotal', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('invoice_discount', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('invoice_tips', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('amount_rule', models.CharField(choices=[('invoice', 'Invoice'), ('invoice_share', 'Share of invoice'), ('estimate', 'Estimate'), ('job_price', 'Job price')], max_length=16)),
                ('amount_is_estimate', models.BooleanField(default=False)),
                ('amount_needs_review', models.BooleanField(default=False)),
                ('internal', models.BooleanField(default=False)),
                ('assignees', models.ManyToManyField(blank=True, related_name='pay_visits', to='hub.hubuser')),
            ],
            options={
                'ordering': ['-visit_date', 'client_name'],
            },
        ),
    ]
