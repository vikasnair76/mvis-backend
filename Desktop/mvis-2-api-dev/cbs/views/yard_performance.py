"""
*****************************************************************************
*File : views.py
*Module : Dashboard Backend
*Purpose : Cyber Signalling UI APIs
*Author : Kausthubha N K
*Copyright : Copyright 2021, Lab to Market Innovations Private Limited
*****************************************************************************
"""

from django.shortcuts import render
from numpy.lib.function_base import select
from cbs.models import *
from rest_framework.views import APIView
from rest_framework.response import Response
from django.contrib.auth.hashers import make_password
from cbs.serializers import *
from django.db.models import Count, Sum, F, Max, query
from django.db.models.functions import TruncMonth
import time
import numpy as np
from django.utils import timezone

# import datetime
from datetime import datetime, timedelta
from datetime import timedelta
from django.utils import timezone
import calendar
from django.http import HttpResponse

# from datetime import date
import datetime
from django.db.models import Count
from django.core.exceptions import ObjectDoesNotExist
from django.contrib.auth import authenticate
from django.contrib.auth.hashers import check_password
from django.contrib import messages
from itertools import chain
from . import views
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework_simplejwt.views import TokenObtainPairView

from cbs.server_timing.middleware import TimedService, timed, timed_wrapper

import logging
import traceback

logger = logging.getLogger("django")

SELECT = 1
UPDATE = 2
INSERT = 3
INSERT_RET = 4

current_day_qry = (
    "select tci.train_id as tid, \n"
    "tci.dfis_train_id as dfis_id, tci.direction as direction, \n"
    "tci.entry_time as entry_time,\n"
    "tci.total_axles as total_axles,\n"
    "tci.train_speed as train_speed FROM train_consolidated_info tci \n"
    "WHERE tci.entry_time BETWEEN {} AND {} \n"
    "GROUP BY 1,2,3,4,5,6 \n"
    "ORDER BY 1 DESC;"
)

train_dfis_both_qry = (
    "select to_timestamp(mpi.ts)::date as dt, \n"
    "tci.train_id as tid, mpi.tagged_wagon_id as tw_id, mpi.tagged_bogie_id as tb_id, mpi.defect_code as mdc, mpi.side as defect_side \n"
    "FROM train_consolidated_info tci, mvis_processed_info mpi \n"
    "WHERE mpi.ts BETWEEN {} AND {} AND mpi.defect_code != '-' \n"
    "AND tci.train_id = mpi.train_id \n"
    "GROUP BY 1,2,3,4,5,6 \n"
    "ORDER BY 1;"
)


# Used for Month View
class total_trains(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):

        total_train_service = TimedService(
            "yard_perf_total_train", "Total Train service"
        )
        total_train_service.start()

        trains_total = train_trace.objects.filter(
            section_status="occupied",
            direction="in",
            torpedo_status="loaded",
            torpedo_axle_count=16,
        ).filter(
            section_id__in=["S21", "S22", "S23"]
        )  # , ts__range = (epoch_start, epoch_end)
        trains_count = trains_total.count()
        serializer1 = section_permissionSerializer(trains_total, many=True)
        serializer2 = trains_count

        trains = {
            "trains_total": serializer1.data,
            "trains_count": serializer2,
        }
        total_train_service.end()

        return Response(trains)


# Used for Month View


class unloaded_torpedo(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        unloaded_torpedo_service = TimedService(
            "yard_perf_unloaded_torpedo", "Unloaded Torpedo service"
        )
        unloaded_torpedo_service.start()

        torpedo_unloaded = train_trace.objects.filter(
            section_status="occupied",
            direction="in",
            torpedo_status="loaded",
            torpedo_axle_count=16,
        ).filter(
            section_id__in=["S1", "S2", "S3", "S4"]
        )  # , ts__range = (epoch_start, epoch_end)
        torpedo_count = torpedo_unloaded.count()
        serializer1 = section_permissionSerializer(torpedo_unloaded, many=True)
        serializer2 = torpedo_count

        unloaded = {
            "torpedo_unloaded": serializer1.data,
            "torpedo_count": serializer2,
        }
        unloaded_torpedo_service.end()

        return Response(unloaded)


# Yard Performance - Month (Calendar) View
class YardView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        monthView_service = TimedService("yard_perf_month_view", "Month View service")
        monthView_service.start()

        try:
            user_Month = request.data.get("monthVal")  # month taken from UI
            user_Year = request.data.get("yearVal")

            yard = ""

            userMonthVal = int(user_Month)
            userYearVal = int(user_Year)

            _, num_days = calendar.monthrange(user_Year, int(user_Month))
            first_day = datetime.date(userYearVal, userMonthVal, 1)
            last_day = datetime.date(userYearVal, userMonthVal, num_days)
            first_date = first_day.strftime("%d-%m-%Y")
            last_date = last_day.strftime("%d-%m-%Y")

            p = "%d-%m-%Y"
            epoch_start = time.mktime(time.strptime(first_date, p))
            epoch_end = time.mktime(time.strptime(last_date, p)) + 86399

            list_len = views.Dashboard.calc_diff_days(self, epoch_start, epoch_end)
            month_count = [0] * list_len
            point_month_count = [0] * 9

            (
                get_overall_count,
                overall_defect_count,
                get_overall_wagon_count,
                get_overall_fwild_count,
            ) = views.Dashboard.yard_performance(self, epoch_start, epoch_end)

            yard = {
                "countTorpedo": get_overall_count,
                "countMvis": overall_defect_count,
                "countWagon": get_overall_wagon_count,
                "countFwild": get_overall_fwild_count,
            }

        except TypeError:
            logger.info(f"None received for month and year!")
            pass

        monthView_service.end()

        return Response(yard)


# Yard Performance - Day View


class DayView1(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        dayView_service = TimedService("yard_perf_day_view", "Day View service")
        dayView_service.start()
        yard_train_count = yard_performance.objects.values("exit_ts").count()
        selectedYear = request.data.get("yearT")
        selectedMonth = request.data.get("monT1")
        selectedDate = request.data.get("dateT")

        query_day = []
        dayView_entryTS_Arr = []
        dayView_exitTS_Arr = []
        dayView_unloadEntryTS_Arr = []
        dayView_unloadExitTS_Arr = []

        yardInd = 0
        yardIndCnt = 0
        _, num_days = calendar.monthrange(int(selectedYear), int(selectedMonth))
        first_day = datetime.date(int(selectedYear), int(selectedMonth), 1)
        last_day = datetime.date(int(selectedYear), int(selectedMonth), num_days)
        first_date = first_day.strftime("%d-%m-%Y")
        last_date = last_day.strftime("%d-%m-%Y")

        p = "%d-%m-%Y"
        epoch_start = time.mktime(time.strptime(first_date, p))
        epoch_end = time.mktime(time.strptime(last_date, p)) + 86399

        (
            ps1_count,
            ps2_count,
            ps3_count,
            ps4_count,
            get_week_count,
            get_today_count,
            get_yesterday_count,
            get_overall_count,
            get_overall_query,
        ) = views.Dashboard.yard_performance(self, epoch_start, epoch_end)

        (
            avg_week_unloading,
            avg_today_unloading,
            avg_yesterday_unloading,
            avg_week_unloading_time,
            avg_month_unloading_time,
        ) = views.Dashboard.avg_unloading_time(self, epoch_start, epoch_end)

        (
            avg_waiting_time,
            avg_today_waiting,
            avg_yesterday_waiting,
            avg_month_waiting_time,
            longer_waiting_time,
        ) = views.Dashboard.avg_waiting_time(self, epoch_start, epoch_end)
        while yardInd < yard_train_count:

            yardIndCnt = yardIndCnt + 1
            try:
                exit_epoch_dict = yard_performance.objects.values().get(id=yardIndCnt)

                # CONVERTING DICT to ARRAY
                rowData = list(exit_epoch_dict.items())
                rowArray = np.array(rowData)

                # EXTRACT 2nd INDEX OF ARRAY AND SAVE IN NEW ARRAY
                rowArrayVal = np.array(rowArray[:, 1])
                yardInd = yardInd + 1

                if not (None in rowArrayVal):

                    # 4 = Exit_ts(Train exit timestamp) ##%Y-%m-%d %H:%M:%S
                    rowTS_Month = time.strftime(
                        "%m", time.localtime(float(rowArrayVal[3]))
                    )
                    rowTS_Year = time.strftime(
                        "%Y", time.localtime(float(rowArrayVal[3]))
                    )
                    rowTS_Date = time.strftime(
                        "%d", time.localtime(float(rowArrayVal[3]))
                    )

                    if str(selectedDate) == "None":
                        logger.info("NONE CASE")

                    else:

                        if (
                            (str(rowTS_Month) == str(selectedMonth))
                            and (str(rowTS_Year) == str(selectedYear))
                            and (str(rowTS_Date) == str(selectedDate))
                        ):
                            dateStrFormat = (
                                rowTS_Year + "-" + rowTS_Month + "-" + rowTS_Date
                            )

                            # query_day.append(yard_performance.objects.values().get(id=yardInd+1))
                            query_day.append(exit_epoch_dict)

                            # TRAIN TIME = EXIT - ENTRY
                            dayView_entryTS_Arr.append(rowArrayVal[3])
                            dayView_exitTS_Arr.append(rowArrayVal[4])
                            dayView_unloadEntryTS_Arr.append(rowArrayVal[5])
                            dayView_unloadExitTS_Arr.append(rowArrayVal[6])

                        else:
                            pass

            except yard_performance.DoesNotExist:
                logger.debug("yard_performance table: record does not exist")

        day_train_count = yard_performance.objects.values("exit_ts").count()
        day_unloaded = yard_performance.objects.values("unload_exit_ts").count()
        dayData = {
            "countTorpedo": get_overall_count[int(selectedDate) - 1],
            "avgUnloadingTime": avg_month_unloading_time[int(selectedDate) - 1],
            "avgWaitingTime": avg_month_waiting_time[int(selectedDate) - 1],
            "dayView_entryTS_Arr": dayView_entryTS_Arr,
            "dayView_exitTS_Arr": dayView_exitTS_Arr,
            "dayView_unloadEntryTS_Arr": dayView_unloadEntryTS_Arr,
            "dayView_unloadExitTS_Arr": dayView_unloadExitTS_Arr,
        }
        dayView_service.end()

        return Response(dayData)


class DayView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        dayView_service = TimedService("yard_perf_day_view", "Day View service")
        dayView_service.start()
        yard_train_count = (
            TrainConsolidatedInfo.objects.order_by("entry_time")
            .exclude(exit_time=None)
            .count()
        )

        selectedYear = request.data.get("yearT")
        selectedMonth = request.data.get("monT1")
        selectedDate = request.data.get("dateT")

        current_whole_info = []
        yardInd = 0
        yardIndCnt = 0
        _, num_days = calendar.monthrange(int(selectedYear), int(selectedMonth))
        first_day = datetime.date(int(selectedYear), int(selectedMonth), 1)
        last_day = datetime.date(int(selectedYear), int(selectedMonth), num_days)
        first_date = first_day.strftime("%d-%m-%Y")
        last_date = last_day.strftime("%d-%m-%Y")

        p = "%d-%m-%Y"
        epoch_start = time.mktime(time.strptime(first_date, p))
        epoch_end = time.mktime(time.strptime(last_date, p)) + 86399

        currentDayStart = datetime.date(
            int(selectedYear), int(selectedMonth), int(selectedDate)
        )
        currentDayStart = currentDayStart.strftime("%d-%m-%Y")
        currentDayEnd = datetime.date(
            int(selectedYear), int(selectedMonth), int(selectedDate)
        )
        currentDayEnd = currentDayEnd.strftime("%d-%m-%Y")
        epoch_current_start = time.mktime(time.strptime(currentDayStart, p))
        epoch_current_end = time.mktime(time.strptime(currentDayEnd, p)) + 86399

        (
            get_overall_count,
            overall_defect_count,
            get_overall_wagon_count,
            get_overall_fwild_count,
        ) = views.Dashboard.yard_performance(self, epoch_start, epoch_end)

        qry_str = current_day_qry
        current_day_info_qry_str = qry_str.format(
            epoch_current_start, epoch_current_end
        )
        current_day_info_column_names, current_day_info_result = (
            views.db_queries.exec_db_query(SELECT, current_day_info_qry_str)
        )

        qry_temp = train_dfis_both_qry
        defect_day_info_qry_str = qry_temp.format(
            epoch_current_start, epoch_current_end
        )
        defect_day_info_column_names, defect_day_info_result = (
            views.db_queries.exec_db_query(SELECT, defect_day_info_qry_str)
        )

        for indxTrain in range(len(current_day_info_result)):
            current_train_id = current_day_info_result[indxTrain][0]
            for indxDefect in range(len(defect_day_info_result)):
                if current_train_id == defect_day_info_result[indxDefect][1]:
                    current_whole_info.append(
                        current_day_info_result[indxTrain]
                        + (
                            defect_day_info_result[indxDefect][2],
                            defect_day_info_result[indxDefect][3],
                            defect_day_info_result[indxDefect][4],
                            defect_day_info_result[indxDefect][5],
                        )
                    )
                else:
                    pass

        dayData = {
            "train_movements": current_day_info_result,
            "countTrain": get_overall_count[int(selectedDate) - 1],
            "countMvis": overall_defect_count[int(selectedDate) - 1],
            "countWagon": get_overall_wagon_count[int(selectedDate) - 1],
            "countFwild": get_overall_fwild_count[int(selectedDate) - 1],
        }
        dayView_service.end()

        return Response(dayData)
