from rest_framework import serializers
from datetime import datetime


class DDMMYYYYDateField(serializers.DateField):
    """
    DateField that enforces dd-mm-yyyy format for both input and output.
    """

    def __init__(self, **kwargs):
        kwargs["input_formats"] = ["%d-%m-%Y"]
        kwargs["format"] = "%d-%m-%Y"
        super().__init__(**kwargs)

    def to_internal_value(self, value):
        if isinstance(value, str):
            try:
                return datetime.strptime(value, "%d-%m-%Y").date()
            except ValueError:
                self.fail("invalid", format="dd-mm-yyyy")
        return super().to_internal_value(value)

    def to_representation(self, value):
        if value is None:
            return value
        return value.strftime("%d-%m-%Y")
