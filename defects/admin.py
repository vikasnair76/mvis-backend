from django.contrib import admin
from .models import DefectCategory, DefectType


@admin.register(DefectCategory)
class DefectCategoryAdmin(admin.ModelAdmin):
    # Removed list_display and list_filter for is_active
    search_fields = ["name", "description"]
    ordering = ["name"]

    def defect_types_count(self, obj):
        return obj.defect_types.count()

    defect_types_count.short_description = "Defect Types"


@admin.register(DefectType)
class DefectTypeAdmin(admin.ModelAdmin):
    # Removed list_display, list_filter, and list_editable for is_active, severity, etc.
    search_fields = ["defect_code", "name", "description"]

    fieldsets = (
        (
            "Basic Information",
            {"fields": ("defect_code", "name", "description", "category_code")},
        ),
        ("Configuration", {"fields": ("multiplier_factor",)}),
    )
