import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cbs_cloud.settings")
django.setup()

from rest_framework_api_key.models import APIKey


def create_key():
    api_key, key = APIKey.objects.create_key(name="test-sms-client")
    print(f"API_KEY:{key}")


if __name__ == "__main__":
    create_key()
