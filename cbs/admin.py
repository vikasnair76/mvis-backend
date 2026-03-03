from django.contrib import admin
from .models import LeftWagonInfo
from defects.models import DefectInfo


@admin.register(DefectInfo)
class DefectInfoAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "train_id",
        "tagged_wagon_id",
        "wagon_id",
        "defect_code",
        "ts",
        "defect_image",
        "action_taken",
        "side",
    )
    search_fields = (
        "train_id",
        "tagged_wagon_id",
        "wagon_id",
        "defect_code",
        "defect_image",
        "action_taken",
        "side",
    )


@admin.register(LeftWagonInfo)
class LeftWagonInfoAdmin(admin.ModelAdmin):
    list_display = ("train_id", "wagon_id", "tagged_wagon_id")
    search_fields = ("train_id", "wagon_id", "tagged_wagon_id")
