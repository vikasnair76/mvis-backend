from rest_framework import serializers
from .models import DefectCategory, DefectType, UniqueDefect
from .models import DefectType  # for lookup in processed defects
from .models import DefectFeedbackAttachment


class DefectCategorySerializer(serializers.ModelSerializer):
    defect_types_count = serializers.SerializerMethodField()

    class Meta:
        model = DefectCategory
        fields = ["category_code", "name", "description", "defect_types_count"]

    def get_defect_types_count(self, obj):
        return obj.defect_types.count()


class DefectTypeSerializer(serializers.ModelSerializer):
    category = serializers.SerializerMethodField()
    category_name = serializers.SerializerMethodField()

    class Meta:
        model = DefectType
        fields = [
            "defect_code",
            "name",
            "description",
            "multiplier_factor",
            "is_active",
            "display_order",
            "category",
            "category_name",
        ]

    def get_category(self, obj):
        return obj.category_code.category_code if obj.category_code else None

    def get_category_name(self, obj):
        return obj.category_code.name if obj.category_code else None


class DefectTypeListSerializer(serializers.ModelSerializer):
    """Simplified serializer for list views"""

    category = serializers.SerializerMethodField()
    category_name = serializers.SerializerMethodField()

    class Meta:
        model = DefectType
        fields = [
            "defect_code",
            "name",
            "is_active",
            "display_order",
            "category",
            "category_name",
        ]

    def get_category(self, obj):
        return obj.category_code.category_code if obj.category_code else None

    def get_category_name(self, obj):
        return obj.category_code.name if obj.category_code else None


class DefectSerializer(serializers.ModelSerializer):
    class Meta:
        model = UniqueDefect
        fields = [
            "id",
            "dpu_id",
            "train_id",
            "wagon_id",
            "wagon_type",
            "loco_no",
            "mvis_total_axles",
            "mvis_train_speed",
            "dfis_train_id",
            "tagged_wagon_id",
            "tagged_bogie_id",
            "side",
            "defect_image",
            "defect_code",
            "action_taken",
            "remarks",
            "start_ts",
            "field_report",
            "ts",
        ]


# defects/serializers.py
class DefectFeedbackAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = DefectFeedbackAttachment
        fields = [
            "id",
            "defect",
            "file",
            "original_filename",
            "uuid_reference",
            "file_url",
            "download_url",
            "uploaded_at",
        ]
        read_only_fields = ["uploaded_at", "original_filename", "uuid_reference"]
        extra_kwargs = {
            "file": {"required": True, "write_only": True},
            "defect": {"required": True},
        }

    def get_file_url(self, obj):
        """Original file URL (direct media access)"""
        request = self.context.get("request")
        if obj.file and request:
            return request.build_absolute_uri(obj.file.url)
        return None

    def get_download_url(self, obj):
        """Secure download URL using UUID reference"""
        request = self.context.get("request")
        if obj.uuid_reference and request:
            return request.build_absolute_uri(
                f"/api/defects/defect-feedback-attachments/download/{obj.uuid_reference}/"
            )
        return None

    def create(self, validated_data):
        # ✅ Extract file and set original filename BEFORE saving
        file_obj = validated_data.get("file")
        if file_obj and hasattr(file_obj, "name"):
            validated_data["original_filename"] = file_obj.name

        return super().create(validated_data)
