from rest_framework import serializers
from .validators import PhoneNumberValidator


class SendSMSSerializer(serializers.Serializer):
    phone_numbers = serializers.CharField(
        help_text="Comma-separated phone numbers, each 10 digits"
    )
    message = serializers.CharField(
        max_length=1000, help_text="The SMS message content"
    )

    def validate_phone_numbers(self, value):
        """
        Validate phone numbers using the dedicated validator.
        """
        validator = PhoneNumberValidator()
        valid_numbers, invalid_numbers = validator.validate_and_format(value)

        if invalid_numbers:
            raise serializers.ValidationError(
                f"Invalid phone numbers found: {', '.join(invalid_numbers)}. "
                "Numbers must be 10 digits."
            )

        if not valid_numbers:
            raise serializers.ValidationError("No valid phone numbers provided.")

        return valid_numbers
