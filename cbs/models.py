from django.db import models
from unixtimestampfield.fields import UnixTimeStampField
from django.contrib.postgres.fields import ArrayField


class LeftWagonInfo(models.Model):
    ts = UnixTimeStampField(default=0.0)
    train_id = models.CharField(max_length=100, null=True)
    dpu_id = models.CharField(max_length=20, blank=True)
    wagon_id = models.CharField(max_length=100, blank=True)
    wagon_type = models.CharField(max_length=100, blank=True)
    tagged_wagon_id = models.CharField(max_length=30, blank=True)
    tagged_bogie_id = models.CharField(max_length=30, blank=True)
    defect_code = models.CharField(max_length=30, null=True)
    defect_image = models.ImageField(upload_to="images/", null=True)
    side = models.CharField(max_length=30, null=True)
    action_taken = models.CharField(max_length=255, null=True)

    class Meta:
        db_table = "mvis_left_wagon_info"


class HealthInfo(models.Model):
    ts = UnixTimeStampField(default=0.0)
    error_id = models.CharField(max_length=100, null=True)
    error_severity = models.CharField(max_length=100, null=True)
    error_desc = models.CharField(max_length=255, null=True)

    class Meta:
        db_table = "health_info"


class TrainConsolidatedInfo(models.Model):
    id = models.AutoField(primary_key=True)
    train_id = models.CharField(max_length=30)
    dfis_train_id = models.CharField(max_length=30)
    train_type = models.CharField(max_length=100)
    dpu_id = models.CharField(max_length=20, blank=True)
    total_axles = models.IntegerField()
    entry_time = UnixTimeStampField(default=0.0)
    exit_time = UnixTimeStampField(default=0.0)
    total_wheels = models.IntegerField()
    total_bad_wheels = models.IntegerField()
    direction = models.CharField(max_length=100)
    train_speed = models.FloatField()
    ilf_threshold_warning = models.FloatField(null=True)
    ilf_threshold_critical = models.FloatField(null=True)
    mdil_threshold_warning = models.FloatField(null=True)
    mdil_threshold_critical = models.FloatField(null=True)
    train_processed = models.BooleanField(default=True)
    remark = models.CharField(default="None", max_length=255)

    class Meta:
        db_table = "train_consolidated_info"


class UserProfile(models.Model):
    """
    Extended user profile data linked to Django's auth_user.
    Authentication and roles are handled by auth_user and auth_group.
    """

    user = models.OneToOneField(
        "auth.User", on_delete=models.CASCADE, related_name="profile", primary_key=True
    )
    phone = models.CharField(max_length=255, null=True, blank=True)
    profile_image = models.ImageField(upload_to="images/", null=True, blank=True)

    class Meta:
        db_table = "user_profile"

    def __str__(self):
        return f"Profile for {self.user.username}"


class MissedInfo(models.Model):
    ts = UnixTimeStampField(default=0.0)
    train_id = models.CharField(max_length=100, null=True)
    tagged_wagon_id = models.CharField(max_length=30, blank=True)
    defect_code = models.CharField(max_length=30, null=True)
    defect_image = models.ImageField(upload_to="images/", null=True)
    missed_remarks = models.CharField(max_length=255, null=True)

    class Meta:
        db_table = "mvis_unprocessed_info"
