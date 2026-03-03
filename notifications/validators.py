"""
Phone number validators for SMS notifications.
"""

import re
from typing import List, Tuple


class PhoneNumberValidator:
    """Validates and formats Indian phone numbers."""

    EXPECTED_LENGTH = 10

    def validate_and_format(
        self, phone_numbers_str: str
    ) -> Tuple[List[str], List[str]]:
        """
        Validate and format comma-separated phone numbers.

        Args:
            phone_numbers_str: Comma-separated phone numbers (e.g., "9876543210,9123456789")

        Returns:
            Tuple of (valid_numbers, invalid_numbers)
        """
        valid_numbers = []
        invalid_numbers = []

        if not isinstance(phone_numbers_str, str):
            return valid_numbers, invalid_numbers

        # Split by comma and strip whitespace
        raw_numbers = [
            num.strip() for num in phone_numbers_str.split(",") if num.strip()
        ]

        for number in raw_numbers:
            cleaned = self._clean_number(number)
            if self._is_valid(cleaned):
                valid_numbers.append(cleaned)
            else:
                invalid_numbers.append(number)

        return valid_numbers, invalid_numbers

    def _clean_number(self, number: str) -> str:
        """Remove non-digit characters and strip country code if present."""
        # Remove all non-digit characters
        digits_only = re.sub(r"\D", "", number)

        # If number starts with 91 and is 12 digits, remove the 91
        if digits_only.startswith("91") and len(digits_only) == 12:
            digits_only = digits_only[2:]

        return digits_only

    def _is_valid(self, number: str) -> bool:
        """Check if cleaned number is exactly 10 digits."""
        return len(number) == self.EXPECTED_LENGTH and number.isdigit()
