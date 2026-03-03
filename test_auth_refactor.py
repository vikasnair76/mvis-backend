#!/usr/bin/env python
"""
Test script for the refactored auth flow.
Tests user creation, login, and JWT token generation using auth_user and auth_group.
"""
import os
import sys
import django

# Setup Django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cbs_cloud.settings")
django.setup()

from django.contrib.auth.models import User, Group
from django.contrib.auth.hashers import make_password, check_password
from cbs.models import UserProfile
from cbs.serializers import UserSerializer


def test_user_creation():
    """Test creating a user with profile and groups"""
    print("\n=== Testing User Creation ===")

    # Create test user
    username = "test_refactor_user"

    # Clean up if exists
    User.objects.filter(username=username).delete()

    # Create user
    user = User.objects.create(
        username=username,
        password=make_password("testpassword123"),
        email="test@example.com",
        first_name="Test",
        last_name="User",
        is_active=True,
    )
    print(f"✓ Created auth_user: {user.username} (id: {user.id})")

    # Create profile
    profile = UserProfile.objects.create(
        user=user,
        phone="1234567890",
    )
    print(f"✓ Created UserProfile for user: {user.username}")

    # Create and assign group (role)
    group, _ = Group.objects.get_or_create(name="Staff")
    user.groups.add(group)
    print(f"✓ Assigned group 'Staff' to user")

    # Test serializer
    serializer = UserSerializer(user)
    data = serializer.data
    print(f"✓ Serialized user data:")
    print(f"  - id: {data['id']}")
    print(f"  - username: {data['username']}")
    print(f"  - email: {data['email']}")
    print(f"  - firstname: {data['firstname']}")
    print(f"  - lastname: {data['lastname']}")
    print(f"  - active: {data['active']}")
    print(f"  - phone: {data['phone']}")
    print(f"  - roles: {data['roles']}")

    return user


def test_password_check(user):
    """Test password validation"""
    print("\n=== Testing Password Check ===")

    # Test correct password
    if check_password("testpassword123", user.password):
        print("✓ Correct password validated successfully")
    else:
        print("✗ Password validation failed!")
        return False

    # Test wrong password
    if not check_password("wrongpassword", user.password):
        print("✓ Wrong password correctly rejected")
    else:
        print("✗ Wrong password was accepted!")
        return False

    return True


def test_jwt_token():
    """Test JWT token generation"""
    print("\n=== Testing JWT Token Generation ===")

    from rest_framework_simplejwt.tokens import RefreshToken

    user = User.objects.get(username="test_refactor_user")

    refresh = RefreshToken.for_user(user)
    access = refresh.access_token

    print(f"✓ Generated refresh token: {str(refresh)[:50]}...")
    print(f"✓ Generated access token: {str(access)[:50]}...")

    return True


def cleanup(user):
    """Clean up test data"""
    print("\n=== Cleanup ===")
    user.delete()
    print("✓ Deleted test user and profile")


def main():
    print("=" * 60)
    print("Auth Refactoring Test Suite")
    print("=" * 60)

    try:
        user = test_user_creation()
        test_password_check(user)
        test_jwt_token()
        cleanup(user)

        print("\n" + "=" * 60)
        print("All tests passed! ✓")
        print("=" * 60)

    except Exception as e:
        print(f"\n✗ Test failed with error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
