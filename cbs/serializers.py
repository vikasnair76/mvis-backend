from rest_framework import serializers
from .models import *
from defects.models import DefectInfo
from django.contrib.auth.models import User, Group


class TrainConsolidatedInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = TrainConsolidatedInfo
        fields = "__all__"


class HealthInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = HealthInfo
        fields = "__all__"


class DefectInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = DefectInfo
        fields = "__all__"


class LeftWagonInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeftWagonInfo
        fields = "__all__"


class UserProfileSerializer(serializers.ModelSerializer):
    """Serializer for UserProfile (phone, profile_image only)"""

    class Meta:
        model = UserProfile
        fields = ["phone", "profile_image"]


class UserSerializer(serializers.ModelSerializer):
    """
    Full user serializer including profile and roles from auth_group.
    Replaces the old userDetailsSerializer.
    """

    profile = UserProfileSerializer(read_only=True)
    roles = serializers.SerializerMethodField()
    phone = serializers.SerializerMethodField()
    profile_image = serializers.SerializerMethodField()
    firstname = serializers.CharField(source="first_name", read_only=True)
    lastname = serializers.CharField(source="last_name", read_only=True)
    active = serializers.BooleanField(source="is_active", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "firstname",
            "lastname",
            "active",
            "phone",
            "profile_image",
            "roles",
            "profile",
        ]

    def get_roles(self, obj):
        """Return roles as a list from auth_group"""
        return list(obj.groups.values_list("name", flat=True))

    def get_phone(self, obj):
        """Get phone from profile if exists"""
        if hasattr(obj, "profile"):
            return obj.profile.phone
        return None

    def get_profile_image(self, obj):
        """Get profile_image from profile if exists"""
        if hasattr(obj, "profile") and obj.profile.profile_image:
            return obj.profile.profile_image.url
        return None


class MissedInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = MissedInfo
        fields = "__all__"
