"""
*****************************************************************************
*File : views.py
*Module : Dashboard Backend
*Purpose : Report APIs
*Author : Kausthubha N K
*Copyright : Copyright 2021, Lab to Market Innovations Private Limited
*****************************************************************************
"""

from django.shortcuts import render
from cbs.models import *
from defects.models import DefectInfo
from rest_framework.views import APIView
from rest_framework.response import Response
from django.contrib.auth.hashers import make_password
from cbs.serializers import *
from django.db.models import Count, Sum, F, Max
from django.db.models.functions import TruncMonth
import time
from django.db.models import Q
import numpy as np
from django.utils import timezone

# import datetime
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
from django.db import models
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework_simplejwt.views import TokenObtainPairView
import psycopg2
from io import StringIO
import os
from dotenv import load_dotenv

from cbs.server_timing.middleware import TimedService, timed, timed_wrapper
from collections import Counter
from . import views
from cbs.views import dashboard

import logging
import traceback
import sys

# Load environment variables from .env file
load_dotenv()

logger = logging.getLogger("django")

SELECT = 1
UPDATE = 2
INSERT = 3
INSERT_RET = 4

unprocessed_qry = (
    "select to_timestamp (tci.entry_time)::date as dt, \n"
    "COUNT(DISTINCT tci.train_id) as unprocessed_trains\n"
    "FROM train_consolidated_info tci \n"
    "WHERE tci.train_processed=False AND tci.entry_time BETWEEN {} AND {} \n"
    "GROUP BY 1 \n"
    "ORDER BY 1 DESC;"
)

maint_qry = (
    "select to_timestamp (tci.entry_time)::date as dt, \n"
    "(COUNT(DISTINCT tci.train_id) filter(where tci.train_processed=True)) "
    "as total_trains_processed, \n"
    "(COUNT(DISTINCT tci.train_id) filter(where tci.train_processed=False))  "
    "as total_trains_unprocessed, \n"
    "(COUNT(DISTINCT tpi.train_id) filter (where tpi.wheel_status_left=2 or "
    "tpi.wheel_status_right=2)) as trains_with_maintenance_alerts, \n"
    "COUNT(tci.total_axles) as total_axles, \n"
    "((COUNT(tpi.wheel_status_left) filter (where tpi.wheel_status_left=2)) + "
    "(COUNT(tpi.wheel_status_right) filter (where tpi.wheel_status_right=2))) "
    "as maint_alerts \n"
    "FROM train_processed_info tpi, train_consolidated_info tci \n"
    "WHERE tci.entry_time BETWEEN {} AND {} AND train_type like '{}' "
    "AND tci.train_id=tpi.train_id\n"
    "GROUP BY 1 \n"
    "ORDER BY 1 DESC;"
)

critical_qry = (
    "select to_timestamp (tci.entry_time)::date as dt, \n"
    "(COUNT(DISTINCT tci.train_id) filter(where tci.train_processed=True)) "
    " as total_trains_processed, \n"
    "(COUNT(DISTINCT tci.train_id) filter(where tci.train_processed=False)) "
    "as total_trains_unprocessed, \n"
    "(COUNT(DISTINCT tpi.train_id) filter (where tpi.wheel_status_left=3 or "
    "tpi.wheel_status_right=3)) as trains_with_critical_alerts, \n"
    "COUNT(tci.total_axles) as total_axles, \n"
    "((COUNT(tpi.wheel_status_left) filter (where tpi.wheel_status_left=3)) + "
    "(COUNT(tpi.wheel_status_right) filter (where tpi.wheel_status_right=3))) "
    "as crit_alerts \n"
    "FROM train_processed_info tpi, train_consolidated_info tci \n"
    "WHERE tci.entry_time BETWEEN {} AND {} AND train_type like '{}' AND "
    "tci.train_id=tpi.train_id \n"
    "GROUP BY 1 \n"
    "ORDER BY 1 DESC;"
)

"""
both_qry = ('select to_timestamp (tci.entry_time)::date as dt, \n'
    '(COUNT(DISTINCT tci.train_id) filter(where tci.train_processed=True)) '
    'as total_trains_processed, \n'
    '(COUNT(DISTINCT tci.train_id) filter(where tci.train_processed=False)) '
    'as total_trains_unprocessed, \n'
    'sum(tci.total_axles) as total_axles \n'
    'FROM train_consolidated_info tci \n'
    'WHERE tci.entry_time BETWEEN {} AND {} AND tci.direction like \'{}\' '    
    'GROUP BY 1 \n'
    'ORDER BY 1 DESC;')

"""
both_qry = (
    "select to_timestamp (mpi.ts)::date as dt, \n"
    "(COUNT(DISTINCT mpi.train_id)) "
    "as total_trains_processed, \n"
    "sum(mpi.mvis_total_axles) as total_axles \n"
    "FROM mvis_processed_info mpi \n"
    "WHERE mpi.ts BETWEEN {} AND {}  "
    "GROUP BY 1 \n"
    "ORDER BY 1 DESC;"
)

get_mpi_total_axles_qry = (
    "select distinct mpi.train_id, mpi.mvis_total_axles \n"
    "FROM mvis_processed_info mpi \n"
    "WHERE mpi.ts BETWEEN {} AND {} ;"
)

""" 
consolidated_both_qry = ('select tci.train_id as tid, \n'
     'tci.dfis_train_id as dfis_id, tci.direction as direction, \n'
     'to_char(to_timestamp (tci.entry_time), \'dd-mm-yyyy hh24:mi:ss\') as entry_time,\n'
     'to_char(to_timestamp (tci.exit_time), \'dd-mm-yyyy hh24:mi:ss\') as exit_time,\n'
     'tci.train_speed as train_speed, tci.total_axles as axles \n'
     'FROM train_consolidated_info tci \n'
     'WHERE tci.train_id like \'{}\' AND tci.direction like \'{}\' \n'
     'GROUP BY 1,2,3,4,5,6,7\n'
     'ORDER BY 1 DESC;')
"""

consolidated_both_qry = (
    "select mpi.train_id as tid, \n"
    "mpi.dfis_train_id as dfis_id,  \n"
    "mpi.mvis_train_speed as train_speed, mpi.mvis_total_axles as axles \n"
    "FROM mvis_processed_info mpi \n"
    "WHERE mpi.train_id like '{}'  \n"
    "GROUP BY 1,2,3,4\n"
    "ORDER BY 1 DESC;"
)

# start - consolidated info with FWILD info + MVIS info
""" 
train_consolidated_both_qry = ('select tci.train_id as tid, \n'
     'tci.dfis_train_id as dfis_id, tci.direction as direction, \n'
     'to_char(to_timestamp (tci.entry_time), \'dd-mm-yyyy hh24:mi:ss\') as entry_time,\n'
     'to_char(to_timestamp (tci.exit_time), \'dd-mm-yyyy hh24:mi:ss\') as exit_time,\n'
     'tci.train_speed as train_speed, tci.total_axles as axles,\n'
     '((COUNT(tpi.wheel_status_left) filter (where tpi.wheel_status_left=2)) + '
     '(COUNT(tpi.wheel_status_right) filter (where tpi.wheel_status_right=2))) '
     'as maint_wheels ,\n'
     '((COUNT(tpi.wheel_status_left) filter (where tpi.wheel_status_left=3)) + '
     '(COUNT(tpi.wheel_status_right) filter (where tpi.wheel_status_right=3))) '
     'as critical_wheels \n'
     'FROM train_consolidated_info tci, train_processed_info tpi\n'
     'WHERE tci.train_id = \'{}\' AND train_type like \'{}\' '
     '\n'
     'GROUP BY 1,2,3,4,5,6,7\n'
     'ORDER BY 1;')
"""
# end - consolidated info with FWILD info + MVIS info

""" #with FWILD
train_consolidated_both_qry = ('select tci.train_id as tid, \n'
     'tci.dfis_train_id as dfis_id, tci.direction as direction, \n'
     'to_char(to_timestamp (tci.entry_time), \'dd-mm-yyyy hh24:mi:ss\') as entry_time,\n'
     'to_char(to_timestamp (tci.exit_time), \'dd-mm-yyyy hh24:mi:ss\') as exit_time,\n'
     'tci.train_speed as train_speed, tci.total_axles as axles \n'
     'FROM train_consolidated_info tci\n'
     'WHERE tci.train_id = \'{}\' AND train_type like \'{}\' '
     '\n'
     'GROUP BY 1,2,3,4,5,6,7\n'
     'ORDER BY 1;')
"""

train_consolidated_both_qry = (
    "select mpi.train_id as tid, \n"
    "mpi.dfis_train_id as dfis_id, \n"
    "mpi.mvis_train_speed as train_speed, mpi.mvis_total_axles as axles \n"
    "FROM mvis_processed_info mpi\n"
    "WHERE mpi.train_id = '{}' "
    "\n"
    "GROUP BY 1,2,3,4\n"
    "ORDER BY 1;"
)

train_entry_with_dfis = (
    "select mpi.train_id as tid, \n"
    "mpi.dfis_train_id as dfis_id \n"
    "FROM mvis_processed_info mpi\n"
    "WHERE mpi.dfis_train_id = '{}' "
    "\n"
    "GROUP BY 1,2\n"
    "ORDER BY 1;"
)

train_dfis_both_qry = (
    "select tci.train_id as tid, \n"
    "tci.dfis_train_id as dfis_id, tci.direction as direction, \n"
    "to_char(to_timestamp (tci.entry_time), 'dd-mm-yyyy hh24:mi:ss') as entry_time,\n"
    "to_char(to_timestamp (tci.exit_time), 'dd-mm-yyyy hh24:mi:ss') as exit_time,\n"
    "tci.train_speed as train_speed, tci.total_axles as axles,\n"
    "((COUNT(tpi.wheel_status_left) filter (where tpi.wheel_status_left=2)) + "
    "(COUNT(tpi.wheel_status_right) filter (where tpi.wheel_status_right=2))) "
    "as maint_wheels ,\n"
    "((COUNT(tpi.wheel_status_left) filter (where tpi.wheel_status_left=3)) + "
    "(COUNT(tpi.wheel_status_right) filter (where tpi.wheel_status_right=3))) "
    "as critical_wheels \n"
    "FROM train_consolidated_info tci, train_processed_info tpi\n"
    "WHERE tci.dfis_train_id = '{}' AND train_type like '{}' "
    "and tci.train_id = tpi.train_id\n"
    "GROUP BY 1,2,3,4,5,6,7\n"
    "ORDER BY 1;"
)

train_with_dfis_qry = (
    "select mpi.train_id as tid, \n"
    "mpi.dfis_train_id as dfis_id, \n"
    "mpi.mvis_train_speed as train_speed, mpi.mvis_total_axles as axles, mpi.loco_no\n"
    "FROM mvis_processed_info mpi\n"
    "WHERE mpi.dfis_train_id = '{}'  "
    "GROUP BY 1,2,3,4,5\n"
    "ORDER BY 1;"
)

train_det_qry = (
    "select tpi.axle_id, tpi.rake_id, tpi.axle_speed,\n"
    "tpi.avg_dyn_load_left, tpi.max_dyn_load_left, tpi.ilf_left, tpi.wheel_status_left,\n"
    "tpi.avg_dyn_load_right, tpi.max_dyn_load_right, tpi.ilf_right, tpi.wheel_status_right, \n"
    "tpi.lateral_load_left, tpi.lateral_load_right\n"
    "from  train_processed_info tpi\n"
    "WHERE  tpi.train_id='{}' \n"
    "group by 1,2,3,4,5,6,7,8,9,10,11,12,13 order by 1;\n"
)

train_dfis_qry = (
    "select tpi.axle_id, tpi.rake_id, tpi.axle_speed,\n"
    "tpi.avg_dyn_load_left, tpi.max_dyn_load_left, tpi.ilf_left, tpi.wheel_status_left,\n"
    "tpi.avg_dyn_load_right, tpi.max_dyn_load_right, tpi.ilf_right, tpi.wheel_status_right, \n"
    "tpi.lateral_load_left, tpi.lateral_load_right\n"
    "from  train_processed_info tpi\n"
    "WHERE  tpi.train_id='{}' \n"
    "group by 1,2,3,4,5,6,7,8,9,10,11,12,13 order by 1;\n"
)

train_defect_qry = (
    "select tpi.axle_id, to_char(to_timestamp (tpi.ts), 'dd-mm-yyyy hh24:mi:ss') as axle_timestamp, \n"
    "tpi.rake_id, tpi.axle_speed, \n"
    "tpi.max_dyn_load_left, tpi.max_dyn_load_right, tpi.ilf_left, tpi.ilf_right,\n"
    "tpi.wheel_status_left, tpi.wheel_status_right \n"
    "from  train_processed_info tpi\n"
    "WHERE  tpi.train_id='{}' AND (tpi.wheel_status_left>=2 OR tpi.wheel_status_right>=2) \n"
    "group by 1,2,3,4,5,6,7,8,9,10 order by 1;\n"
)

mvis_defect_qry = (
    "select DISTINCT ON (mpi.defect_image) to_char(to_timestamp (mpi.ts), 'dd-mm-yyyy hh24:mi:ss') as dt, mpi.tagged_wagon_id, mpi.tagged_bogie_id, mpi.side, \n"
    "mpi.wagon_id, mpi.wagon_type, mpi.defect_image, \n"
    "mpi.defect_code, mpi.action_taken, mpi.loco_no \n"
    "from mvis_processed_info mpi\n"
    "WHERE mpi.train_id='{}' AND mpi.defect_code like '{}' \n"
    "GROUP BY 1,2,3,4,5,6,7,8,9,10 \n"
    "ORDER BY 7, \n"
    "cast(NULLIF(regexp_replace(mpi.tagged_wagon_id, '\D', '', 'g'), '') AS integer), cast(NULLIF(regexp_replace(mpi.tagged_bogie_id, '\D', '', 'g'), '') AS bigint);"
)  # integer

# mvis_summary_defect_qry = ('select '
#'to_timestamp(mpi.ts)::date as dt, mpi.tagged_wagon_id, mpi.tagged_bogie_id, mpi.side, \n'
#'mpi.defect_image, \n'
#'mpi.defect_code, mpi.action_taken, mlwi.wagon_id, mlwi.wagon_type \n'
#'from mvis_processed_info mpi, mvis_left_wagon_info mlwi\n'
#'WHERE mpi.train_id=\'{}\' AND mpi.defect_code like \'{}\' \n'
#'AND mlwi.tagged_wagon_id = mpi.tagged_wagon_id AND mlwi.train_id=\'{}\' \n'
#'GROUP BY 1,2,3,4,5,6,7,8,9 \n'
#'ORDER BY \n'
# "cast(NULLIF(regexp_replace(mpi.tagged_wagon_id, '\D', '', 'g'), '') AS integer), cast(NULLIF(regexp_replace(mpi.tagged_bogie_id, '\D', '', 'g'), '') AS integer);")

mvis_summary_defect_qry = (
    "select to_timestamp(mpi.ts)::date as dt, mpi.tagged_wagon_id, mpi.tagged_bogie_id, mpi.side, \n"
    "mpi.defect_image, \n"
    "mpi.defect_code, mpi.action_taken \n"
    "from mvis_processed_info mpi\n"
    "WHERE mpi.train_id='{}' AND mpi.defect_code like '{}' \n"
    "GROUP BY 1,2,3,4,5,6,7 \n"
    "ORDER BY \n"
    "cast(NULLIF(regexp_replace(mpi.tagged_wagon_id, '\D', '', 'g'), '') AS integer), cast(NULLIF(regexp_replace(mpi.tagged_bogie_id, '\D', '', 'g'), '') AS bigint);"
)

mvis_update_feedback_qry = (
    "update mvis_processed_info set action_taken = '{}' \n"
    "WHERE train_id = '{}' AND defect_image = '{}' ; \n"
)

train_mvis_defect_qry = (
    "select to_timestamp (mpi.ts)::date as dt, (COUNT(mpi.defect_image) filter (where mpi.defect_image != '-' )), \n"
    "(COUNT(DISTINCT mpi.train_id)) as train_cnt  \n"
    "from mvis_processed_info mpi \n"
    "WHERE mpi.ts BETWEEN {} AND {} AND mpi.defect_code like '{}'  \n"
    "group by 1 order by 1 DESC;\n"
)


"""
train_wise_mvis = ('select mpi.train_id as t_id, to_timestamp (mpi.start_ts)::date as dt, (COUNT(DISTINCT mpi.defect_image) filter (where mpi.defect_image != \'-\' )) \n'
'from mvis_processed_info mpi\n'
'WHERE mpi.train_id like \'{}\' AND mpi.defect_code like \'{}\' \n'
'group by 1,2 order by 2 DESC;\n')
"""

# train_wise_mvis = (
#     "select mpi.train_id as t_id, to_timestamp (mpi.start_ts)::date as dt, mpi.tagged_wagon_id, mpi.side \n"
#     "from mvis_processed_info mpi\n"
#     "WHERE mpi.train_id like '{}' AND mpi.defect_code like '{}' AND mpi.defect_image != '-' \n"
#     "group by 1,2,3,4 order by 2 DESC;\n"
# )
train_wise_mvis = (
    "select mpi.train_id as t_id, to_timestamp (mpi.start_ts)::date as dt, mpi.tagged_wagon_id, mpi.side, mpi.defect_code, mpi.action_taken \n"
    "from mvis_processed_info mpi\n"
    "WHERE mpi.train_id like '{}' AND mpi.defect_code like '{}' AND mpi.defect_image != '-' \n"
    "group by 1,2,3,4,5,6 order by 1 DESC;\n"
)

"""
# extra tpi is not required for train id list
get_tci_train_ids = ('select tci.train_id as tid, to_timestamp (tci.entry_time)::date as dt, 0 \n'
'FROM train_consolidated_info tci\n'
'WHERE tci.train_id like \'{}\' AND train_type like \'{}\' '
'\n'
'GROUP BY 1,2 \n'
'ORDER BY 1 DESC;')
"""

# get mpi train IDs
get_tci_train_ids = (
    "select mpi.train_id as tid, 0 \n"
    "FROM mvis_processed_info mpi\n"
    "WHERE mpi.train_id like '{}' "
    "\n"
    "GROUP BY 1,2 \n"
    "ORDER BY 1 DESC;"
)


mvis_left_wagon_qry = (
    "select mlwi.tagged_wagon_id, mlwi.side, \n"
    "mlwi.wagon_id, mlwi.wagon_type \n"
    "from mvis_processed_info mpi, mvis_left_wagon_info mlwi\n"
    "WHERE mlwi.train_id='{}' \n"
    "AND mpi.train_id = mlwi.train_id \n"
    "GROUP BY 1,2,3,4 \n"
    "ORDER BY \n"
    "cast(NULLIF(regexp_replace(mlwi.tagged_wagon_id, '\D', '', 'g'), '') AS integer);"
)

mvis_right_wagon_qry = (
    "select mrwi.tagged_wagon_id, mrwi.side, \n"
    "mrwi.wagon_id, mrwi.wagon_type \n"
    "from mvis_processed_info mpi, mvis_right_wagon_info mrwi\n"
    "WHERE mrwi.train_id='{}' \n"
    "AND mpi.train_id = mrwi.train_id \n"
    "GROUP BY 1,2,3,4 \n"
    "ORDER BY \n"
    "cast(NULLIF(regexp_replace(mrwi.tagged_wagon_id, '\D', '', 'g'), '') AS integer);"
)

mvis_feedback_count_qry = (
    "select to_timestamp(mpi.ts)::date as dt, (COUNT(mpi.action_taken) filter (where mpi.action_taken != '-' )) "
    "as feedback_available_count, \n"
    "(COUNT(mpi.action_taken) filter (where mpi.action_taken = 'TRUE DEFECT' )) "
    "as true_count, \n"
    "(COUNT(mpi.action_taken) filter (where mpi.action_taken = 'FALSE POSITIVE' )) "
    "as false_count \n"
    "FROM mvis_processed_info mpi \n"
    "WHERE mpi.ts BETWEEN {} AND {} AND mpi.defect_code like '{}' "
    "GROUP BY 1 \n"
    "ORDER BY 1 DESC; "
)

# train_wise_mvis_feedback_qry = (
#     "select mpi.train_id as t_id, to_timestamp (mpi.ts)::date as dt, (COUNT(mpi.action_taken) filter (where mpi.action_taken != '-' )) "
#     "as feedback_available_count, \n"
#     "(COUNT(mpi.action_taken) filter (where mpi.action_taken = 'TRUE DEFECT' )) "
#     "as true_count, \n"
#     "(COUNT(mpi.action_taken) filter (where mpi.action_taken = 'FALSE POSITIVE' )) "
#     "as false_count \n"
#     "from mvis_processed_info mpi\n"
#     "WHERE mpi.train_id like '{}' AND mpi.defect_code like '{}' \n"
#     "group by 1,2 order by 1 DESC;\n"
# )

# train_wise_mvis_feedback_qry = ('select DISTINCT mpi.train_id as t_id, to_timestamp (mpi.start_ts)::date as dt, (COUNT(mpi.action_taken) filter (where mpi.action_taken != \'-\' )) '
#     'as feedback_available_count, \n'
# 	'(COUNT(mpi.action_taken) filter (where mpi.action_taken = \'TRUE DEFECT\' )) '
#     'as true_count, \n'
#     '(COUNT(mpi.action_taken) filter (where mpi.action_taken = \'FALSE POSITIVE\' )) '
#     'as false_count \n'
#     'from mvis_processed_info mpi\n'
#     'WHERE mpi.train_id like \'{}\' AND mpi.defect_code like \'{}\' \n'
#     'group by 1,2 order by 1 DESC;\n')

train_wise_mvis_feedback_qry = (
    "SELECT "
    "t_id, "
    "SUM(feedback_available_count) AS feedback_available_count, "
    "SUM(true_count) AS true_count, "
    "SUM(false_count) AS false_count "
    "FROM ("
    "    SELECT "
    "        mpi.train_id AS t_id, "
    "        COUNT(DISTINCT CONCAT(mpi.tagged_wagon_id, mpi.side, mpi.defect_code)) FILTER (WHERE mpi.action_taken != '-') AS feedback_available_count, "
    "        COUNT(DISTINCT CONCAT(mpi.tagged_wagon_id, mpi.side, mpi.defect_code)) FILTER (WHERE mpi.action_taken = 'TRUE DEFECT') AS true_count, "
    "        COUNT(DISTINCT CONCAT(mpi.tagged_wagon_id, mpi.side, mpi.defect_code)) FILTER (WHERE mpi.action_taken = 'FALSE POSITIVE') AS false_count "
    "    FROM mvis_processed_info mpi "
    "    WHERE mpi.train_id LIKE '{}' "
    "      AND mpi.defect_code LIKE '{}' "
    "    GROUP BY mpi.train_id, TO_TIMESTAMP(mpi.start_ts)::date "
    ") subquery "
    "GROUP BY t_id "
    "ORDER BY t_id DESC;"
)


# Report : Consolidated Report
class train_information(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):

        storage = messages.get_messages(request)
        storage.used = True
        current_start_date = request.data.get("start")
        current_end_date = request.data.get("end")
        alarm_type = request.data.get("alarmtype")
        direction = request.data.get("dir")
        defect_type = request.data.get("defType")
        train_type = "All"
        consol_rep = {}
        dfis_id_rep = {}
        mvis_result_rep = {}
        mvis_result = []
        mvis_feedback_count_rep = {}
        total_axles = 0

        if (
            current_start_date != None
            and current_end_date != None
            and alarm_type != ""
            and current_start_date != ""
            and current_end_date != ""
        ):
            if current_end_date >= current_start_date:
                current_start_date_time = current_start_date  # + ' 00:00:00'
                current_end_date_time = current_end_date  # + ' 23:59:59'

                p = "%d-%m-%Y"  # %H:%M:%S'
                epoch_start = time.mktime(time.strptime(current_start_date_time, p))
                epoch_end = time.mktime(time.strptime(current_end_date_time, p))
                print("epoch_start", epoch_start, "epoch_end", epoch_end)

                qry_str1 = unprocessed_qry.format(epoch_start, epoch_end)
                column_names1, result1 = views.db_queries.exec_db_query(
                    SELECT, qry_str1
                )

                if result1 == None:
                    result1 = 0

                if alarm_type == "FWILD Maintenance":
                    qry_str = maint_qry
                    alm_type = "Maintenance"
                    rpt_str = "train_maint_report"

                elif alarm_type == "FWILD Critical":
                    qry_str = critical_qry
                    alm_type = "Critical"
                    rpt_str = "train_crit_report"

                elif alarm_type == "MVIS Alerts":
                    alm_type = "MVIS"

                else:
                    qry_str = both_qry
                    alm_type = "Both"
                    rpt_str = "train_alerts_report"
                tr_type = ""
                if train_type == "All":
                    tr_type = tr_type + "%"
                else:
                    tr_type = tr_type + train_type

                dirn = ""
                if direction == "All":
                    dirn = dirn + "%"
                else:
                    dirn = dirn + direction

                defType = ""
                if defect_type == "All":
                    defType = defType + "%"
                else:
                    defType = defType + defect_type

                formated_qry_str = qry_str.format(epoch_start, epoch_end, dirn, tr_type)
                column_names, result = views.db_queries.exec_db_query(
                    SELECT, formated_qry_str
                )

                get_mpi_total_axles_qry_str = get_mpi_total_axles_qry.format(
                    epoch_start, epoch_end
                )
                column_names_axles, each_total_axles = views.db_queries.exec_db_query(
                    SELECT, get_mpi_total_axles_qry_str
                )
                for tup in each_total_axles:
                    # Check if the second value in the tuple is not None
                    if tup[1] is not None:
                        # Add the non-None value to the sum
                        total_axles += tup[1]

                mvis_formated_qry_str = train_mvis_defect_qry.format(
                    epoch_start, epoch_end, defType
                )
                column_names, mvis_result = views.db_queries.exec_db_query(
                    SELECT, mvis_formated_qry_str
                )

                # mvis_feedback_count_qry_str = mvis_feedback_count_qry.format(epoch_start, epoch_end, dirn, defType)
                mvis_feedback_count_qry_str = mvis_feedback_count_qry.format(
                    epoch_start, epoch_end, defType
                )
                column_names_fb, mvis_feedback_count = views.db_queries.exec_db_query(
                    SELECT, mvis_feedback_count_qry_str
                )

                day_delta = timedelta(days=1)
                final_result = []

                start_date = datetime.strptime(current_start_date, "%d-%m-%Y")
                end_date = datetime.strptime(current_end_date, "%d-%m-%Y")
                for i in range((end_date - start_date).days + 1):
                    cur_date = start_date + i * day_delta
                    cur_date_str = cur_date.strftime("%Y-%m-%d")

                    proc_index = 0
                    unproc_index = 0
                    proc_matched = False
                    unproc_matched = False

                    if result != None:
                        while proc_index < len(result):
                            if str(result[proc_index][0]) == cur_date_str:
                                proc_matched = True
                                break
                            proc_index = proc_index + 1

                    while unproc_index < len(result1):
                        if str(result1[unproc_index][0]) == cur_date_str:
                            unproc_matched = True
                            break
                        unproc_index = unproc_index + 1

                    if proc_matched is True:
                        lst = list(result[proc_index])
                        if unproc_matched is True:
                            lst[2] = lst[2] + result1[unproc_index][1]

                    else:
                        if alarm_type == "Both":
                            lst = [cur_date, 0, 0, 0, 0, 0, 0]
                        else:
                            lst = [cur_date, 0, 0, 0, 0, 0]
                        if unproc_matched is True:
                            lst[2] = result1[unproc_index][1]
                    # if unproc_index < len(result1):
                    if (
                        unproc_index < len(result1)
                        and (direction != "UP")
                        and (direction != "DOWN")
                    ):
                        lst[1] = result1[unproc_index][1] + lst[1]
                    final_result.append(tuple(lst))

                print("final_result", final_result)

                consol_rep = {"result": result, "total_axles": total_axles}
                # consol_rep = { 'result': final_result }
                # mvis_result_rep = { 'mvis_result': mvis_result }
                if mvis_result != None:
                    if len(mvis_result) > 0:
                        mvis_result_rep = {"mvis_result": mvis_result}
                        mvis_feedback_count_rep = {
                            "mvis_feedback_count": mvis_feedback_count
                        }
                    else:
                        mvis_result_rep = {"mvis_result": [0, 0]}
                        mvis_feedback_count_rep = {"mvis_feedback_count": [0, 0, 0]}
                else:
                    print("mvis_result is None")

                start_date = datetime.strptime(current_start_date_time, p).strftime(
                    "%d-%m-%Y %H:%M:%S"
                )
                end_date = datetime.strptime(current_end_date_time, p).strftime(
                    "%d-%m-%Y %H:%M:%S"
                )

                if len(final_result) == 0:
                    return start_date

            else:
                pass

        if request.data.get("dfisId"):

            dfis_train_id = request.data.get("dfisId")
            train_id = request.data.get("trainId")
            train_type = "All"

            mvis_result_rep = {}
            consolidated_result = {}
            mvis_feedback_count_rep = {}

            qry_temp = train_entry_with_dfis
            tr_type = ""
            if train_type == "All":
                tr_type = tr_type + "%"
            else:
                tr_type = tr_type + train_type

            train_entry_with_dfis_str = qry_temp.format(dfis_train_id)
            ted_column_names, ted_result = views.db_queries.exec_db_query(
                SELECT, train_entry_with_dfis_str
            )
            trainID = ted_result[0][0]

            # trainID = DefectInfo.objects.get(dfis_train_id=dfis_train_id).train_id.last() #works

            if trainID:
                trainID = trainID
            else:
                trainID = None
                print("No matching DefectInfo found for the given dfis_train_id.")

            detail_qry_str = train_det_qry.format(trainID)
            detail_column_names, detail_result = views.db_queries.exec_db_query(
                SELECT, detail_qry_str
            )

            defect_qry_str = train_defect_qry.format(trainID)
            defect_column_names, defect_result = views.db_queries.exec_db_query(
                SELECT, defect_qry_str
            )

            mvis_defect_qry_str = mvis_defect_qry.format(trainID, "%")
            mvis_defect_column_names, mvis_defect_result = (
                views.db_queries.exec_db_query(SELECT, mvis_defect_qry_str)
            )

            dfis_id_rep = {
                "consolidated_result": consolidated_result,
                "detail_result": detail_result,
                "defect_result": defect_result,
                "mvis_defect_result": mvis_defect_result,
            }

            print("dfis_id_rep", dfis_id_rep)

        entryexit = {
            "final_result": consol_rep,
            "mvis_result": mvis_result_rep,
            "mvis_feedback": mvis_feedback_count_rep,
            "dfis_id_rep": dfis_id_rep,
        }

        return Response(entryexit)


# Report : Consolidated Train Wise Report
class train_wise(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):

        logger.warning("c", time.time())
        t1_start = time.time()

        train_date = request.data.get("train_date")
        direction = request.data.get("dir")
        # defect_type = request.data.get('defType')
        train_type = "All"
        train_wise_rep = {}
        mvis_train_cnt = []
        mvis_fb_cnt = []
        train_wise_feedback_rep = {}
        new_mvis_train_list = [] * len(mvis_train_cnt)

        if request.data.get("dir") is None:
            direction = "All"
        else:
            direction = request.data.get("dir")
        if request.data.get("defType") is None:
            defect_type = "All"
        else:
            defect_type = request.data.get("defType")

        req_date = train_date.split("-")
        month = req_date[1]
        day_str = req_date[2]
        if len(day_str) == 1:
            day_str = "0" + day_str
        year = req_date[0]

        date_str = day_str + "-" + month + "-" + year
        search_tids = "T" + year + month + day_str + "%"

        qry_temp = consolidated_both_qry
        ret_table = "alert_table"
        alert_type = "Both"

        tr_type = ""
        if train_type == "All":
            tr_type = tr_type + "%"
        else:
            tr_type = tr_type + train_type

        dirn = ""
        if direction == "All":
            dirn = dirn + "%"
        else:
            dirn = dirn + direction

        defType = ""
        if defect_type == "All":
            defType = defType + "%"
        else:
            defType = defType + defect_type

        qry_str = qry_temp.format(search_tids, dirn)  # , tr_type
        column_names, result = views.db_queries.exec_db_query(SELECT, qry_str)
        print("rresult: ", result)

        get_tci_train_ids_qry_str = get_tci_train_ids.format(search_tids, tr_type)
        column_names, train_id_list = views.db_queries.exec_db_query(
            SELECT, get_tci_train_ids_qry_str
        )

        for indx in range(len(train_id_list)):
            mvis_train_cnt.append(train_id_list[indx])
            mvis_fb_cnt.append(train_id_list[indx])

        mvis_formated_qry_str = train_wise_mvis.format(search_tids, defType)
        column_names, mvis_result = views.db_queries.exec_db_query(
            SELECT, mvis_formated_qry_str
        )
        print("mvis_resulttt: ", mvis_result)

        mvis_result_reduced = dashboard.Point.reduce_duplicates(mvis_result)
        mvis_result = dashboard.Point.process_reduced_duplicates(mvis_result_reduced)

        train_wise_mvis_feedback_qry_str = train_wise_mvis_feedback_qry.format(
            search_tids, defType
        )
        column_names_fb, train_wise_feedback_result = views.db_queries.exec_db_query(
            SELECT, train_wise_mvis_feedback_qry_str
        )

        print("train_wise_feedback_resulttttttttttttttt: ", train_wise_feedback_result)

        if mvis_train_cnt != None and mvis_result != None:
            for indxOuter in range(len(mvis_train_cnt)):
                for indx in range(len(mvis_result)):
                    try:
                        ind_mvis = [y[0] for y in mvis_train_cnt].index(
                            mvis_result[indx][0]
                        )
                        mvis_train_cnt[ind_mvis] = (
                            mvis_result[indx][0],
                            mvis_result[indx][1],
                            mvis_result[indx][2],
                        )
                        mvis_fb_cnt[ind_mvis] = (
                            train_wise_feedback_result[indx][0],
                            train_wise_feedback_result[indx][1],
                            train_wise_feedback_result[indx][2],
                            train_wise_feedback_result[indx][3],
                            # train_wise_feedback_result[indx][4],
                        )
                    except ValueError:
                        print(ind_mvis, "is not in list")

        print("mvis_train_cnt: ", mvis_fb_cnt)
        train_wise_rep = {"result": result}
        train_mvis_rep = {"mvis_result": mvis_train_cnt}
        if defect_type == "All":
            train_wise_feedback_rep = {
                "train_wise_feedback_result": train_wise_feedback_result
            }
        else:
            train_wise_feedback_rep = {"train_wise_feedback_result": mvis_fb_cnt}

        # print("Feedback2:", train_wise_feedback_result)

        trainWise = {
            "final_result": train_wise_rep,
            "mvis_result": train_mvis_rep,
            "train_wise_feedback": train_wise_feedback_rep,
        }
        # logger.warning('e1', time.time())
        t1_end = time.time()
        t1_diff = t1_end - t1_start

        print("diff: ", t1_diff)
        print("**************************\n")
        print("trainWise: ", trainWise)
        sys.stdout.flush()
        print("**************************\n")

        return Response(trainWise)


# Report : Consolidated Train Detailed Report
class train_detailed(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):

        trainID = request.data.get("trainId")
        train_date = request.data.get("train_date")
        mvis_defect_code = request.data.get("")
        # defect_type = request.data.get('defType')
        qry_temp = train_consolidated_both_qry
        ret_table = "alert_table"
        alert_type = "Both"
        train_type = "All"
        if request.data.get("defType") is None:
            defect_type = "All"
        else:
            defect_type = request.data.get("defType")

        req_date = train_date.split("-")
        month = req_date[1]
        day_str = req_date[2]
        if len(day_str) == 1:
            day_str = "0" + day_str
        year = req_date[0]

        date_str = day_str + "-" + month + "-" + year
        search_tids = "T" + year + month + day_str + "%"

        tr_type = ""
        if train_type == "All":
            tr_type = tr_type + "%"
        else:
            tr_type = tr_type + train_type

        defType = ""
        if defect_type == "All":
            defType = defType + "%"
        else:
            defType = defType + defect_type

        consolidated_qry_str = qry_temp.format(trainID, tr_type)
        consolidated_column_names, consolidated_result = views.db_queries.exec_db_query(
            SELECT, consolidated_qry_str
        )

        # detail_qry_str = train_det_qry.format(trainID)
        # detail_column_names, detail_result = views.db_queries.exec_db_query(SELECT, detail_qry_str)

        defect_qry_str = train_defect_qry.format(trainID)
        defect_column_names, defect_result = views.db_queries.exec_db_query(
            SELECT, defect_qry_str
        )

        mvis_defect_qry_str = mvis_defect_qry.format(trainID, defType)
        mvis_defect_column_names, mvis_defect_result = views.db_queries.exec_db_query(
            SELECT, mvis_defect_qry_str
        )

        mvis_left_wagon_qry_str = mvis_left_wagon_qry.format(trainID)
        mvis_defect_column_names, mvis_left_wagon_result = (
            views.db_queries.exec_db_query(SELECT, mvis_left_wagon_qry_str)
        )

        mvis_right_wagon_qry_str = mvis_right_wagon_qry.format(trainID)
        mvis_defect_column_names, mvis_right_wagon_result = (
            views.db_queries.exec_db_query(SELECT, mvis_right_wagon_qry_str)
        )

        try:
            mvis_time = DefectInfo.objects.filter(train_id=trainID).latest("ts").ts
            print("mvis_time", mvis_time)
        except ObjectDoesNotExist:
            mvis_time = 0
            print("exception raised!")

        train_detailed = {
            "consolidated_result": consolidated_result,
            "defect_result": defect_result,
            "mvis_defect_result": mvis_defect_result,
            "mvis_left_wagon_result": mvis_left_wagon_result,
            "mvis_right_wagon_result": mvis_right_wagon_result,
        }

        trainDetailed = {"final_result": train_detailed, "mvis_time": mvis_time}

        return Response(trainDetailed)


# MVIS Defect Summary Response


class mvis_defect_summary(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):

        trainID = request.data.get("trainId")
        mvis_defect_code = request.data.get("mvis_defect_code")

        mvis_defect_summary_res = {}

        mvis_summary_qry_str = mvis_summary_defect_qry.format(trainID, mvis_defect_code)
        mvis_defect_summary_column_names, mvis_defect_summary_result = (
            views.db_queries.exec_db_query(SELECT, mvis_summary_qry_str)
        )

        mvis_defect_summary_res = {
            "mvis_defect_summary_result": mvis_defect_summary_result
        }

        mvisDefectSummaryRes = {"final_result": mvis_defect_summary_res}

        return Response(mvisDefectSummaryRes)


class mvis_update_feedback(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):

        trainID = request.data.get("trainId")
        def_img = request.data.get("def_img")
        act_tkn = request.data.get("act_tkn")
        print(trainID, def_img, act_tkn)
        print("both obtained")
        mvis_update_feedback_res = {}

        mvis_update_feedback_res = DefectInfo.objects.filter(
            train_id=trainID, defect_image=def_img
        ).update(action_taken=act_tkn)

        print("mvis_update_feedback_res", mvis_update_feedback_res)

        # mvis_feedback_qry_str = mvis_update_feedback_qry.format(act_tkn, trainID, def_img)
        # mvis_feedback_column_names, mvis_feedback_result = views.db_queries.exec_db_query(SELECT, mvis_feedback_qry_str)

        # mvis_update_feedback_res = {'mvis_feedback_result': mvis_feedback_result}

        mvisUpdateFeedbackRes = {"final_result": mvis_update_feedback_res}

        return Response(mvisUpdateFeedbackRes)


class db_queries(APIView):

    def exec_db_query(qry_type, query_str):
        import os

        ps_connection = None
        cursor = None
        try:
            ps_connection = psycopg2.connect(
                user=os.getenv("DB_USER"),
                password=os.getenv("DB_PASSWORD"),
                host=os.getenv("DB_HOST"),
                port=os.getenv("DB_PORT"),
                database=os.getenv("DB_NAME"),
            )
            cursor = ps_connection.cursor()
            cursor.execute(query_str)
            if qry_type == SELECT or qry_type == INSERT_RET:
                col_names = [desc[0] for desc in cursor.description]
                result_tbl = cursor.fetchall()

                buf = StringIO()
                buf.close()
                if qry_type == INSERT_RET:
                    ps_connection.commit()
                return col_names, result_tbl
            elif qry_type == UPDATE:
                ps_connection.commit()
                return True
        except (Exception, psycopg2.DatabaseError) as ex:
            return None, None

        finally:
            # closing database connection.
            if ps_connection:
                cursor.close()
                ps_connection.close()
                logger.info(f"PostgreSQL connection is closed")
