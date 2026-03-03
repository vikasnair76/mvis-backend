"""
*****************************************************************************
*File : user.py
*Module : Dashboard Backend
*Purpose : User Authentication and Management APIs
*Author : Kausthubha N K
*Copyright : Copyright 2021, Lab to Market Innovations Private Limited
*****************************************************************************
"""

from django.shortcuts import render
from cbs.models import UserProfile
from rest_framework.views import APIView
from rest_framework.response import Response
from django.contrib.auth.hashers import make_password, check_password
from cbs.serializers import UserSerializer, UserProfileSerializer
from django.db.models import Count, Sum, F, Max
from django.db.models.functions import TruncMonth
import time
import numpy as np
from django.utils import timezone
from datetime import datetime, timedelta
from calendar import monthrange
from django.http import HttpResponse
from datetime import date
from django.db.models import Count
from django.core.exceptions import ObjectDoesNotExist
from django.contrib.auth import authenticate
from django.contrib import messages
from itertools import chain, count

from cbs.server_timing.middleware import TimedService, timed, timed_wrapper
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.conf import settings
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework_simplejwt.views import TokenObtainPairView
from django.contrib.auth.models import User, Group

import logging
import traceback

logger = logging.getLogger("django")


class adminView(APIView):
    """
    API View for user management (create, update, list users).
    Uses Django's auth_user and auth_group for authentication and roles.
    """

    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        userRegistration_service = TimedService("user_registration", "User service")
        userRegistration_service.start()

        details = {}
        user_id_details = {}
        update_users = {}
        user_1 = {}
        password1 = None
        details_email = {}

        email = request.data.get("email")
        phone = request.data.get("phone")
        password = request.data.get("password")
        username = request.data.get("username")
        firstName = request.data.get("firstName")
        lastName = request.data.get("lastName")
        roles = request.data.get("roles", [])
        active = request.data.get("active")
        formData = request.data.get("formData")

        # Get user by ID if provided
        if request.data.get("userID"):
            user_id = request.data.get("userID")
            try:
                user_obj = User.objects.get(id=user_id)
                user_id_details = User.objects.filter(id=user_id)
            except User.DoesNotExist:
                user_id_details = User.objects.none()

        # Update existing user
        if request.data.get("flag") == "false":
            email1 = request.data.get("email")
            phone1 = request.data.get("phone")
            password1 = request.data.get("password")
            username1 = request.data.get("username")
            firstName1 = request.data.get("firstName")
            lastName1 = request.data.get("lastName")
            roles1 = request.data.get("roles", [])
            active1 = request.data.get("active")
            profileImage1 = request.data.get("editedData")
            user_id1 = request.data.get("userID")

            if active1 == "true":
                active1 = True
            else:
                active1 = False

            try:
                # Update auth_user
                update_user = User.objects.get(id=user_id1)

                if password1 and password1 != "":
                    update_user.password = make_password(password1)

                update_user.email = email1
                update_user.username = username1
                update_user.first_name = firstName1
                update_user.last_name = lastName1
                update_user.is_active = active1
                update_user.save()

                # Update or create UserProfile
                profile, created = UserProfile.objects.get_or_create(user=update_user)
                profile.phone = phone1
                if profileImage1:
                    profile.profile_image = profileImage1
                profile.save()

                # Update roles via auth_group
                if roles1:
                    update_user.groups.clear()
                    for role_name in roles1:
                        group, _ = Group.objects.get_or_create(name=role_name)
                        update_user.groups.add(group)

                user_1 = User.objects.filter(id=user_id1)

            except User.DoesNotExist:
                logger.warning(f"User with id {user_id1} not found for update")

        # Check if username exists
        username_check = User.objects.filter(username=username).exists()

        # Create new user
        if request.data.get("flag") == "true":
            if active == "true":
                active = True
            else:
                active = False

            if not username_check:
                # Create auth_user
                new_user = User.objects.create(
                    username=username,
                    password=make_password(password),
                    email=email,
                    first_name=firstName,
                    last_name=lastName,
                    is_active=active,
                    is_staff=False,
                    is_superuser=False,
                    date_joined=timezone.now(),
                )

                # Create UserProfile
                UserProfile.objects.create(
                    user=new_user,
                    phone=phone,
                    profile_image=formData,
                )

                # Assign roles via auth_group
                if roles:
                    for role_name in roles:
                        group, _ = Group.objects.get_or_create(name=role_name)
                        new_user.groups.add(group)

                logger.info(f"Created new user: {username} with roles: {roles}")

        # Get all users with email
        details = (
            User.objects.filter(email__isnull=False)
            .select_related("profile")
            .prefetch_related("groups")
        )
        serializer = UserSerializer(details, many=True)
        user_id_serializer = UserSerializer(user_id_details, many=True)
        user_1_ser = UserSerializer(user_1, many=True)

        details_email["completeDetails"] = serializer.data
        details_email["username_check"] = username_check
        details_email["user_id_details"] = user_id_serializer.data

        userRegistration_service.end()

        return Response(details_email)


class MyTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Custom JWT serializer that includes user roles from auth_group in the token.
    """

    def validate(self, attrs):
        try:
            data = super(TokenObtainPairSerializer, self).validate(attrs)
            refresh = self.get_token(self.user)
            data["refresh"] = str(refresh)

            if self.user.is_superuser:
                new_token = refresh.access_token
                new_token.set_exp(
                    lifetime=settings.SIMPLE_JWT["SUPERUSER_TOKEN_LIFETIME"]
                )
                data["access"] = str(new_token)
            else:
                data["access"] = str(refresh.access_token)

            # Include user info in response
            data["user"] = {
                "id": self.user.id,
                "username": self.user.username,
                "email": self.user.email,
                "first_name": self.user.first_name,
                "last_name": self.user.last_name,
                "is_active": self.user.is_active,
                "roles": list(self.user.groups.values_list("name", flat=True)),
            }

            # Add profile info if exists
            if hasattr(self.user, "profile"):
                data["user"]["phone"] = self.user.profile.phone
                data["user"]["profile_image"] = (
                    self.user.profile.profile_image.url
                    if self.user.profile.profile_image
                    else None
                )

            return data
        except Exception as ex:
            logger.error(f"Token validation exception: {ex}")
            raise


class LoginSerializer(TokenObtainPairSerializer):
    """
    Serializer for the new professional login endpoint.
    Returns a flat JSON structure with tokens and user details.
    Uses email for authentication instead of username.
    """

    username_field = 'email'

    def validate(self, attrs):
        try:
            # Get email and password from request
            email = attrs.get('email')
            password = attrs.get('password')

            # Look up user by email
            try:
                user = User.objects.get(email=email)
            except User.DoesNotExist:
                from rest_framework_simplejwt.exceptions import AuthenticationFailed
                raise AuthenticationFailed('No active account found with the given credentials')

            # Authenticate using username (Django's authenticate uses username)
            self.user = authenticate(
                request=self.context.get('request'),
                username=user.username,
                password=password
            )

            if self.user is None or not self.user.is_active:
                from rest_framework_simplejwt.exceptions import AuthenticationFailed
                raise AuthenticationFailed('No active account found with the given credentials')

            refresh = self.get_token(self.user)

            # Start with token data
            response_data = {
                "refresh": str(refresh),
            }

            if self.user.is_superuser:
                new_token = refresh.access_token
                new_token.set_exp(
                    lifetime=settings.SIMPLE_JWT["SUPERUSER_TOKEN_LIFETIME"]
                )
                response_data["access"] = str(new_token)
            else:
                response_data["access"] = str(refresh.access_token)

            # Add user details to the flat response
            response_data.update(
                {
                    "userid": self.user.id,
                    "username": self.user.username,
                    "email": self.user.email,
                    "firstname": self.user.first_name,
                    "lastname": self.user.last_name,
                    "roles": list(self.user.groups.values_list("name", flat=True)),
                }
            )

            # Add profile info if exists
            if hasattr(self.user, "profile"):
                response_data["phone"] = self.user.profile.phone
                response_data["profile_image"] = (
                    self.user.profile.profile_image.url
                    if self.user.profile.profile_image
                    else None
                )
            else:
                response_data["phone"] = None
                response_data["profile_image"] = None

            return response_data
        except Exception as ex:
            logger.error(f"Login validation exception: {ex}")
            raise


class MyTokenObtainPairView(TokenObtainPairView):
    serializer_class = MyTokenObtainPairSerializer


class LoginView(TokenObtainPairView):
    """
    New professional login endpoint.
    """

    serializer_class = LoginSerializer


class authView(APIView):
    """
    API View for user authentication (login).
    Uses Django's auth_user for validation via authenticate().
    """

    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        authView_service = TimedService("authentication", "Authentication service")
        authView_service.start()

        useremail = request.data.get("useremail")
        userpwd = request.data.get("userpwd")

        passwordMatched = ""
        ip = ""

        # Get IP address
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            ip = x_forwarded_for.split(",")[0]
        else:
            ip = request.META.get("REMOTE_ADDR")

        # Handle password reset
        resetemail = resetpwd = None
        if request.data.get("firstname") or request.data.get("lastname"):
            firstName = request.data.get("firstname")
            lastName = request.data.get("lastname")
            resetemail = request.data.get("resetEmail")
            resetpwd = request.data.get("resetPwd")

            if resetemail:
                try:
                    user_to_update = User.objects.get(email=resetemail)
                    user_to_update.first_name = firstName
                    user_to_update.last_name = lastName
                    user_to_update.save()
                except User.DoesNotExist:
                    logger.warning(f"User with email {resetemail} not found for update")

            if resetpwd:
                try:
                    user_to_update = User.objects.get(first_name=firstName)
                    user_to_update.password = make_password(resetpwd)
                    user_to_update.first_name = firstName
                    user_to_update.last_name = lastName
                    user_to_update.save()
                except User.DoesNotExist:
                    logger.warning(
                        f"User with firstname {firstName} not found for password reset"
                    )

        # Authenticate user
        try:
            # First find user by email
            db_user = User.objects.get(email=useremail)

            if db_user:
                if check_password(userpwd, db_user.password):
                    passwordMatched = 1
                else:
                    passwordMatched = 0
        except User.DoesNotExist:
            logger.warning(f"User with email {useremail} not found")
            passwordMatched = 0

        # Get user data for response
        db_users = (
            User.objects.filter(email=useremail)
            .select_related("profile")
            .prefetch_related("groups")
        )
        serializer = UserSerializer(db_users, many=True)

        authUser = {
            "passwordMatched": passwordMatched,
            "loggedUser": serializer.data,
            "user_ip": ip,
        }

        authView_service.end()

        return Response(authUser)
