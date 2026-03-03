"""
*****************************************************************************
*File : views.py
*Module : Dashboard Backend
*Purpose : Cyber Signalling UI APIs
*Author : Kausthubha N K
*Copyright : Copyright 2021, Lab to Market Innovations Private Limited
*****************************************************************************
"""

from cbs.views.user import *
from cbs.views.yard_performance import *
from cbs.views.dashboard import *
from cbs.views.train_information import *
from django.shortcuts import render
from cbs.models import *
from rest_framework.views import APIView
from rest_framework.response import Response
from django.contrib.auth.hashers import make_password
from cbs.serializers import *
from django.db.models import Count, Sum, F, Max
from django.db.models.functions import TruncMonth
import time
import numpy as np
from django.utils import timezone
from datetime import datetime, timedelta
from datetime import timedelta
from django.utils import timezone
from calendar import monthrange
from django.http import HttpResponse
from datetime import date
from django.db.models import Count
from django.core.exceptions import ObjectDoesNotExist
from django.contrib.auth import authenticate
from django.contrib.auth.hashers import check_password
from django.contrib import messages
from itertools import chain
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework_simplejwt.views import TokenObtainPairView


import logging
import traceback

logger = logging.getLogger("django")


def index(request):
    return render(request, template_name="index.html")
