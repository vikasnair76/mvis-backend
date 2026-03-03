from rest_framework import serializers
from cbs.fields import DDMMYYYYDateField


class SummaryReportSerializer(serializers.Serializer):
    """Serializer for summary report response"""

    summary = serializers.DictField()
    defect_breakdown = serializers.ListField()

    def to_representation(self, instance):
        """Custom representation for the summary report"""
        return {
            "summary": instance.get("summary", {}),
            "defect_breakdown": instance.get("defect_breakdown", []),
        }


# To fully enforce, use DDMMYYYYDateField for any date fields in future serializers.
