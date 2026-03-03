from django.db import models
from .utils import defect_feedback_upload_to
from unixtimestampfield.fields import UnixTimeStampField
import os
import uuid


class DefectInfo(models.Model):
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
    loco_no = models.CharField(max_length=30, null=True)
    mvis_train_speed = models.FloatField()
    mvis_total_axles = models.IntegerField()
    dfis_train_id = models.CharField(max_length=30)
    start_ts = UnixTimeStampField(default=0.0)
    field_report = models.CharField(max_length=255, null=True)
    remarks = models.CharField(max_length=255, null=True)
    GENERATED_BY_CHOICES = [
        ("manual", "Manual"),
        ("system", "System"),
    ]
    generated_by = models.CharField(
        max_length=10,
        choices=GENERATED_BY_CHOICES,
        default="system",
        help_text="Indicates whether the defect was generated manually or by system",
    )
    is_deleted = models.BooleanField(
        default=False, help_text="Indicates whether the defect is deleted"
    )

    class Meta:
        db_table = "mvis_processed_info"


class DefectCategory(models.Model):
    """Defect categories"""

    category_code = models.CharField(max_length=10, unique=True, primary_key=True)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)

    class Meta:
        db_table = "defect_categories"
        verbose_name_plural = "Defect Categories"
        ordering = ["name"]

    def __str__(self):
        return self.name


# TODO: Rename to Component
class DefectType(models.Model):
    """Component Types"""

    defect_code = models.CharField(max_length=10, unique=True, primary_key=True)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    multiplier_factor = models.IntegerField(default=1)
    is_active = models.BooleanField(default=True)
    display_order = models.IntegerField(default=0)
    show_alert = models.BooleanField(
        default=True, help_text="Controls alert visibility for this component type"
    )
    category_code = models.ForeignKey(
        DefectCategory,
        to_field="category_code",
        db_column="category_code",
        on_delete=models.SET_NULL,
        related_name="defect_types",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "defect_types"
        ordering = ["defect_code"]

    def __str__(self):
        return f"{self.defect_code} - {self.name}"

class DefectLocation(models.Model):
    """Maps defect types to their specific DPU locations"""
    
    defect_code = models.ForeignKey(
        DefectType,
        to_field="defect_code",
        db_column="defect_code",
        on_delete=models.SET_NULL,
        related_name="defect_locations",
        null=True,
        blank=True,
    )
    dpu_id = models.CharField(max_length=20, blank=True)

    class Meta:
        db_table = "defect_locations"
        unique_together = [["defect_code", "dpu_id"]]
        verbose_name = "Defect Location"
        verbose_name_plural = "Defect Locations"

    def __str__(self):
        return f"{self.defect_code} - {self.dpu_id}"


#  This model represents a view that aggregates unique defects from the mvis_processed_info table.
class UniqueDefect(models.Model):
    # The 'id' from the original mvis_processed_info table.
    # We designate this as the primary key for the view model.
    id = models.BigIntegerField(primary_key=True)

    # Fields from your SELECT statement
    dpu_id = models.CharField(max_length=255, null=True, blank=True)
    train_id = models.CharField(max_length=255)
    wagon_id = models.CharField(max_length=255, null=True, blank=True)
    wagon_type = models.CharField(max_length=100, null=True, blank=True)
    loco_no = models.CharField(max_length=100, null=True, blank=True)
    mvis_total_axles = models.IntegerField(null=True, blank=True)
    mvis_train_speed = models.FloatField(null=True, blank=True)
    dfis_train_id = models.CharField(max_length=255, null=True, blank=True)
    tagged_wagon_id = models.CharField(max_length=255)
    tagged_bogie_id = models.CharField(max_length=255, null=True, blank=True)
    side = models.CharField(max_length=10)
    defect_image = models.URLField(max_length=500)
    defect_code = models.CharField(max_length=50)
    action_taken = models.CharField(max_length=50, null=True, blank=True)
    remarks = models.TextField(null=True, blank=True)
    start_ts = models.DateTimeField(null=True, blank=True)
    field_report = models.TextField(null=True, blank=True)
    ts = models.DateTimeField()
    GENERATED_BY_CHOICES = [
        ("manual", "Manual"),
        ("system", "System"),
    ]
    generated_by = models.CharField(
        max_length=10, choices=GENERATED_BY_CHOICES, default="system"
    )
    is_deleted = models.BooleanField(default=False)

    class Meta:
        # This model is a view, not a table, so we set managed to False.
        managed = False
        db_table = "unique_defects"
        verbose_name = "Unique Defect"
        verbose_name_plural = "Unique Defects"


class Defects(models.Model):
    train_id = models.CharField(max_length=20)
    wagon_position = models.CharField(max_length=5)
    wagon_no = models.CharField(max_length=20)
    wagon_type = models.CharField(max_length=20)
    side = models.CharField(max_length=5)
    defect_image = models.URLField(max_length=100)
    defect_code = models.CharField(max_length=10)
    remarks = models.TextField(null=True, blank=True)
    field_report = models.CharField(max_length=50, null=True, blank=True)
    action_taken = models.CharField(max_length=50, null=True, blank=True)
    is_active = models.BooleanField()

    class Meta:
        db_table = "defects"


class FilenameOnlyFileField(models.FileField):
    """
    Custom FileField that stores only the filename in the database,
    while keeping files organized in folders on the file system
    """

    def pre_save(self, model_instance, add):
        file = super().pre_save(model_instance, add)
        if file and hasattr(file, "name") and file.name:
            file.name = os.path.basename(file.name)
        return file


class DefectFeedbackAttachment(models.Model):
    defect = models.ForeignKey(
        DefectInfo, on_delete=models.CASCADE, related_name="attachments"
    )
    file = models.FileField(
        upload_to=defect_feedback_upload_to
    )  # Use regular FileField
    original_filename = models.CharField(max_length=255)  # Store original filename
    uuid_reference = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False
    )  # UUID for API access
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "defect_feedback_attachment"

    def __str__(self):
        return f"Attachment {self.uuid_reference} - {self.original_filename}"
