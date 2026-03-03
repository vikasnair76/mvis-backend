"""
*****************************************************************************
*File : views.py
*Module : Dashboard Backend
*Purpose : Cyber Signalling UI APIs
*Author : Kausthubha N K, Sumankumar Panchal
*Copyright : Copyright 2021, Lab to Market Innovations Private Limited
*****************************************************************************
"""

from django.conf import settings
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from django.shortcuts import render
from cbs.models import *
from defects.models import DefectInfo
from rest_framework.views import APIView
from rest_framework.response import Response
from django.contrib.auth.hashers import make_password
from cbs.serializers import *
from django.db.models import Count, Sum, F, Max
import time
import numpy as np
from datetime import datetime, timedelta, date
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
from . import views
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework_simplejwt.views import TokenObtainPairView

from cbs.server_timing.middleware import TimedService, timed, timed_wrapper
from django.db.models.functions import TruncDate, TruncMonth

from django.db.models import Q

import logging
import traceback
import calendar
import ast

logger = logging.getLogger("django")

info_with_dfis = ""
info_with_remarks = ""

SELECT = 1
UPDATE = 2
INSERT = 3
INSERT_RET = 4

week_train_count_qry = (
    "select to_timestamp (mpi.ts)::date as dt, \n"
    "(COUNT(DISTINCT mpi.train_id)) "
    "as total_trains_processed \n"
    "FROM mvis_processed_info mpi \n"
    "WHERE mpi.ts BETWEEN {} AND {} \n"
    "GROUP BY 1 \n"
    "ORDER BY 1 ASC;"
)

week_defect_count_qry = (
    "select to_timestamp(mpi.ts)::date as dt, \n"
    "(COUNT(mpi.defect_code)) as train_defects \n"
    "FROM mvis_processed_info mpi \n"
    "WHERE mpi.ts BETWEEN {} AND {} AND mpi.defect_code != '-' \n"
    "GROUP BY 1 \n"
    "ORDER BY 1 ASC;"
)

train_dfis_both_qry = (
    "select to_timestamp(mpi.ts)::date as dt, mpi.wagon_id as wag_id, mpi.wagon_type as wag_type,\n"
    "mpi.train_id as tid, mpi.tagged_wagon_id as tw_id, mpi.tagged_bogie_id as tb_id, mpi.defect_code as mdc, mpi.side as defect_side \n"
    "FROM mvis_processed_info mpi \n"
    "WHERE mpi.ts BETWEEN {} AND {} AND mpi.defect_code != '-' \n"
    "GROUP BY 1,2,3,4,5,6,7,8 \n"
    "ORDER BY 1;"
)

current_day_qry = (
    "select tci.train_id as tid, \n"
    "tci.dfis_train_id as dfis_id, tci.direction as direction, \n"
    "tci.entry_time as entry_time,\n"
    "tci.exit_time as exit_time,\n"
    "tci.train_speed as train_speed FROM train_consolidated_info tci \n"
    "WHERE tci.entry_time BETWEEN {} AND {} \n"
    "GROUP BY 1,2,3,4,5,6 \n"
    "ORDER BY 1 ASC LIMIT 3;"
)
"""
train_mvis_defect_qry = ('select to_timestamp (mpi.ts)::date as dt,(COUNT(mpi.defect_image) filter(where tci.direction like \'{}\')) \n'
'from train_consolidated_info tci, mvis_processed_info mpi\n'
'WHERE mpi.ts BETWEEN {} AND {} AND mpi.defect_code like \'{}\' \n'
'AND tci.train_id = mpi.train_id \n'
'group by 1 order by 1 ASC;\n')
"""
mvis_left_wagon_qry = (
    "select mlwi.tagged_wagon_id, mlwi.side, \n"
    "mlwi.wagon_id, mlwi.wagon_type \n"
    "from mvis_processed_info mpi, mvis_left_wagon_info mlwi\n"
    "WHERE mpi.train_id = mlwi.train_id \n"
    "GROUP BY 1,2,3,4 \n"
    "ORDER BY \n"
    "cast(NULLIF(regexp_replace(mlwi.tagged_wagon_id, '\D', '', 'g'), '') AS integer);"
)

train_mvis_defect_qry = (
    "select to_timestamp (mpi.ts)::date as dt, (COUNT(mpi.defect_image) filter (where mpi.defect_image != '-' )), \n"
    "(COUNT(DISTINCT mpi.train_id)) as train_cnt  \n"
    "from mvis_processed_info mpi \n"
    "WHERE mpi.ts BETWEEN {} AND {} AND mpi.defect_code like '{}'  \n"
    "group by 1 order by 1 ASC;\n"
)

"""
mvis_feedback_count_qry = ('select to_timestamp(mpi.ts)::date as dt, (COUNT(mpi.action_taken) filter (where mpi.action_taken != \'-\')) '
    'as feedback_available_count, \n'
	'(COUNT(mpi.action_taken) filter (where mpi.action_taken = \'TRUE DEFECT\')) ' 
    'as true_count, \n'
    '(COUNT(mpi.action_taken) filter (where mpi.action_taken = \'FALSE POSITIVE\')) '
    'as false_count \n'
    'FROM train_consolidated_info tci, mvis_processed_info mpi \n'
    'WHERE mpi.ts BETWEEN {} AND {} AND tci.direction like \'{}\' AND mpi.defect_code like \'{}\' '
    'AND tci.train_id=mpi.train_id \n'
    'GROUP BY 1 \n'
    'ORDER BY 1 DESC; ')
"""

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
    "ORDER BY 1 ASC; "
)

get_mpi_total_axles_qry = (
    "select distinct mpi.train_id, mpi.mvis_total_axles \n"
    "FROM mvis_processed_info mpi \n"
    "WHERE mpi.ts BETWEEN {} AND {} ;"
)

# mvis_truecount_qry = ('select to_timestamp(mpi.ts)::date as dt, mpi.train_id, \n'
#         'mpi.tagged_wagon_id, mpi.tagged_bogie_id, mpi.side, \n'
#     'mpi.wagon_id, mpi.wagon_type, mpi.defect_image, \n'
#     'mpi.defect_code, mpi.action_taken, mpi.loco_no \n'
#     'FROM mvis_processed_info mpi \n'
#     'WHERE mpi.ts BETWEEN {} AND {} AND mpi.defect_code like \'{}\' AND mpi.action_taken = \'TRUE DEFECT\' \n'
#     'ORDER BY 1 ASC;')
mvis_truecount_qry = (
    "select to_timestamp(mpi.ts)::date as dt, mpi.train_id, \n"
    "mpi.tagged_wagon_id, mpi.tagged_bogie_id, mpi.side, \n"
    "mpi.wagon_id, mpi.wagon_type, mpi.defect_image, \n"
    "mpi.defect_code, mpi.action_taken, mpi.loco_no \n"
    "FROM mvis_processed_info mpi \n"
    "WHERE mpi.ts BETWEEN {} AND {} AND (mpi.defect_code like '{}' OR mpi.defect_code like '{}') AND mpi.action_taken = 'TRUE DEFECT' \n"
    "ORDER BY 1 ASC;"
)

mvis_MissedAlerts_qry = (
    "select to_timestamp(mupi.ts)::date as dt, mupi.train_id, \n"
    "mupi.tagged_wagon_id, \n"
    "mupi.defect_code, mupi.defect_image, mupi.missed_remarks \n"
    "FROM mvis_unprocessed_info mupi \n"
    "WHERE mupi.ts BETWEEN {} AND {} \n"
    "ORDER BY 1 ASC;"
)


mvis_falsecount_qry = (
    "select to_timestamp(mpi.ts)::date as dt, mpi.train_id, \n"
    "mpi.tagged_wagon_id, mpi.tagged_bogie_id, mpi.side, \n"
    "mpi.wagon_id, mpi.wagon_type, mpi.defect_image, \n"
    "mpi.defect_code, mpi.action_taken, mpi.loco_no \n"
    "FROM mvis_processed_info mpi \n"
    "WHERE mpi.ts BETWEEN {} AND {} AND (mpi.defect_code like '{}' OR mpi.defect_code like '{}') AND mpi.action_taken = 'FALSE POSITIVE' \n"
    "ORDER BY 1 ASC;"
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

# mvis_fb_notGiven_qry = (
#     'SELECT to_timestamp(mpi.ts)::date AS dt, \n'
#     'mpi.train_id, mpi.tagged_wagon_id, mpi.side, \n'
#     'mpi.defect_image, mpi.action_taken, \n'
#     'mpi.loco_no, mpi.defect_code, mlwi.wagon_id \n'
#     'FROM mvis_processed_info mpi \n'
#     'JOIN (SELECT mlwi.tagged_wagon_id, mlwi.wagon_id \n'
#     'FROM mvis_processed_info mpi \n'
#     'JOIN mvis_left_wagon_info mlwi ON mpi.train_id = mlwi.train_id \n'
#     'WHERE mpi.action_taken = \'-\' AND mpi.defect_code != \'-\' \n'
#     'AND mpi.ts BETWEEN {} AND {} \n'
#     'GROUP BY mlwi.tagged_wagon_id, mlwi.wagon_id \n'
#     ') AS mlwi ON mpi.tagged_wagon_id = mlwi.tagged_wagon_id \n'
#     'WHERE mpi.ts BETWEEN {} AND {} AND mpi.action_taken = \'-\' AND mpi.defect_code != \'-\' \n'
#     'ORDER BY dt ASC;'
# )

# mvis_fb_notGiven_qry = ('select to_timestamp(mpi.ts)::date as dt, mpi.train_id, \n'
#         'mpi.tagged_wagon_id, mpi.side, \n'
#     'mpi.defect_image, \n'
#     'mpi.action_taken, mpi.loco_no, mpi.defect_code, mpi.tagged_bogie_id, mpi.field_report, mpi.remarks \n'
#     'FROM mvis_processed_info mpi \n'
#     'WHERE mpi.ts BETWEEN {} AND {} AND mpi.action_taken = \'-\' AND mpi.defect_code != \'-\' \n'
#     'ORDER BY 1 ASC;')

mvis_fb_notGiven_qry = (
    "SELECT DISTINCT ON (mpi.tagged_wagon_id, mpi.side, mpi.defect_code) "
    "TO_TIMESTAMP(mpi.ts)::date AS dt, mpi.train_id, \n"
    "mpi.tagged_wagon_id, mpi.side, \n"
    "mpi.defect_image, \n"
    "mpi.action_taken, mpi.loco_no, mpi.defect_code, mpi.tagged_bogie_id, mpi.field_report, mpi.remarks \n"
    "FROM mvis_processed_info mpi \n"
    "WHERE mpi.ts BETWEEN {} AND {} AND mpi.action_taken = '-' AND mpi.defect_code != '-' \n"
    "ORDER BY mpi.tagged_wagon_id, mpi.side, mpi.defect_code, mpi.ts ASC;"
)
false_positive_qry = (
    "select to_timestamp(mpi.ts)::date as dt, mpi.train_id, \n"
    "mpi.tagged_wagon_id, mpi.side, \n"
    "mpi.defect_image, \n"
    "mpi.action_taken, mpi.loco_no, mpi.defect_code, mpi.tagged_bogie_id, mpi.field_report, mpi.remarks \n"
    "FROM mvis_processed_info mpi \n"
    "WHERE mpi.ts BETWEEN {} AND {} AND mpi.action_taken = 'FALSE POSITIVE' \n"
    "ORDER BY 1 ASC;"
)

mvis_wagon_cnt_qry = (
    "SELECT COUNT(wagon_id) AS totalWagonCount \n"
    "FROM mvis_left_wagon_info mlwi \n"
    "WHERE  mlwi.train_id BETWEEN '{}' AND '{}' \n"
)

# mvis_fb_notGiven_qry = (
#     'SELECT to_timestamp(mpi.ts)::date AS dt, \n'
#     'mpi.train_id, mpi.tagged_wagon_id, mpi.side, \n'
#     'mlwi.wagon_id, mpi.defect_image, mpi.action_taken, \n'
#     'mpi.loco_no, mpi.defect_code \n'
#     'FROM mvis_processed_info mpi \n'
#     'JOIN \n'
#     '(SELECT mlwi.tagged_wagon_id, mlwi.wagon_id \n'
#     'FROM mvis_processed_info mpi \n'
#     'JOIN mvis_left_wagon_info mlwi ON mpi.train_id = mlwi.train_id \n'
#     'WHERE mpi.action_taken = \'-\' AND mpi.defect_code != \'-\' \n'
#     'AND mpi.ts BETWEEN {} AND {} \n'
#     'GROUP BY mlwi.tagged_wagon_id, mlwi.wagon_id \n'
#     ') AS mlwi ON mpi.tagged_wagon_id = mlwi.tagged_wagon_id \n'
#     'WHERE mpi.ts BETWEEN {} AND {} AND mpi.action_taken = \'-\' AND mpi.defect_code != \'-\' \n'
#     'ORDER BY dt ASC;'
# )

# mvis_mgr_default_qry = ('SELECT \n'
#   'TO_CHAR(DATE_TRUNC(\'month\', TO_TIMESTAMP(start_ts)), \'Mon\') AS month, \n'
#   'COALESCE(COUNT(DISTINCT train_id), 0) AS total_trains, \n'
#   'COALESCE(COUNT(action_taken) FILTER(WHERE defect_code like \'%\' and defect_image != \'-\'), 0) AS total_alerts, \n'
#   'COALESCE(COUNT(action_taken) FILTER(WHERE action_taken != \'-\'), 0) AS feedbackgiven, \n'
#   'COALESCE(SUM(CASE WHEN action_taken = \'TRUE DEFECT\' THEN 1 ELSE 0 END), 0) AS true_defect_count, \n'
#   'COALESCE(SUM(CASE WHEN action_taken = \'FALSE POSITIVE\' THEN 1 ELSE 0 END), 0) AS false_positive_count \n'
# 'FROM mvis_processed_info \n'
# 'WHERE \n'
#   'TO_TIMESTAMP(start_ts) >= DATE_TRUNC(\'month\', CURRENT_DATE - INTERVAL \'5 months\') \n'
#   'AND TO_TIMESTAMP(start_ts) < DATE_TRUNC(\'month\', CURRENT_DATE) + INTERVAL \'1 month\' \n'
# 'GROUP BY month ORDER BY \n'
#   'MIN(DATE_TRUNC(\'month\', TO_TIMESTAMP(start_ts))) DESC;')

mvis_mgr_default_qry = (
    "SELECT \n"
    "  TO_CHAR(DATE_TRUNC('month', TO_DATE(SUBSTRING(train_id FROM 2 FOR 8), 'YYYYMMDD')), 'Mon') AS month, \n"
    "  COALESCE(COUNT(DISTINCT train_id), 0) AS total_trains, \n"
    "  COALESCE(COUNT(CASE WHEN defect_code LIKE '%' AND defect_image != '-' THEN action_taken END), 0) AS total_alerts, \n"
    "  COALESCE(COUNT(CASE WHEN action_taken != '-' THEN action_taken END), 0) AS feedbackgiven, \n"
    "  COALESCE(SUM(CASE WHEN action_taken = 'TRUE DEFECT' THEN 1 ELSE 0 END), 0) AS true_defect_count, \n"
    "  COALESCE(SUM(CASE WHEN action_taken = 'FALSE POSITIVE' THEN 1 ELSE 0 END), 0) AS false_positive_count \n"
    "FROM \n"
    "  mvis_processed_info \n"
    "WHERE \n"
    "  SUBSTRING(train_id FROM 2 FOR 6) >= TO_CHAR(DATE_TRUNC('month', CURRENT_DATE - INTERVAL '5 months'), 'YYYYMM') AND \n"
    "  SUBSTRING(train_id FROM 2 FOR 6) < TO_CHAR(DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month', 'YYYYMM') \n"
    "GROUP BY \n"
    "  month \n"
    "ORDER BY \n"
    "  MIN(DATE_TRUNC('month', TO_DATE(SUBSTRING(train_id FROM 2 FOR 8), 'YYYYMMDD'))) DESC;"
)


# mvis_mgr_daterange_qry = ('SELECT \n'
#   'TO_CHAR(DATE_TRUNC(\'month\', TO_TIMESTAMP(start_ts)), \'Mon\') AS month, \n'
#   'COALESCE(COUNT(DISTINCT train_id), 0) AS total_trains, \n'
#   'COALESCE(COUNT(action_taken) FILTER(WHERE defect_code like \'%\' and defect_image != \'-\'), 0) AS total_alerts, \n'
#   'COALESCE(COUNT(action_taken) FILTER(WHERE action_taken != \'-\'), 0) AS feedbackgiven, \n'
#   'COALESCE(SUM(CASE WHEN action_taken = \'TRUE DEFECT\' THEN 1 ELSE 0 END), 0) AS true_defect_count, \n'
#   'COALESCE(SUM(CASE WHEN action_taken = \'FALSE POSITIVE\' THEN 1 ELSE 0 END), 0) AS false_positive_count \n'
# 'FROM mvis_processed_info \n'
# 'WHERE \n'
#   'TO_TIMESTAMP(start_ts) >= TO_TIMESTAMP({}) \n'
#   'AND TO_TIMESTAMP(start_ts) < TO_TIMESTAMP({}) \n'
# 'GROUP BY month ORDER BY \n'
#   'MIN(DATE_TRUNC(\'month\', TO_TIMESTAMP(start_ts))) DESC;')

mvis_mgr_daterange_qry = (
    "SELECT \n"
    "  TO_CHAR(DATE_TRUNC('month', TO_DATE(SUBSTRING(train_id FROM 2 FOR 8), 'YYYYMMDD')), 'Mon') AS month, \n"
    "  COALESCE(COUNT(DISTINCT train_id), 0) AS total_trains, \n"
    "  COALESCE(COUNT(action_taken) FILTER(WHERE defect_code LIKE '%' AND defect_image != '-'), 0) AS total_alerts, \n"
    "  COALESCE(COUNT(action_taken) FILTER(WHERE action_taken != '-'), 0) AS feedbackgiven, \n"
    "  COALESCE(SUM(CASE WHEN action_taken = 'TRUE DEFECT' THEN 1 ELSE 0 END), 0) AS true_defect_count, \n"
    "  COALESCE(SUM(CASE WHEN action_taken = 'FALSE POSITIVE' THEN 1 ELSE 0 END), 0) AS false_positive_count \n"
    "FROM mvis_processed_info \n"
    "WHERE \n"
    "  SUBSTRING(train_id FROM 2 FOR 6) >= '{}' \n"
    "  AND SUBSTRING(train_id FROM 2 FOR 6) < '{}' \n"
    "GROUP BY month ORDER BY \n"
    "  MIN(DATE_TRUNC('month', TO_DATE(SUBSTRING(train_id FROM 2 FOR 8), 'YYYYMMDD'))) DESC;"
)

# mvis_mgr_graphs_qry = ('SELECT \n'
#   'TO_CHAR(DATE_TRUNC(\'month\', TO_TIMESTAMP(start_ts)), \'Mon\') AS month, \n'
#   'COALESCE(COUNT(action_taken) FILTER(WHERE defect_code like \'%\' and defect_image != \'-\'), 0) AS total_alerts, \n'
#   'COALESCE(SUM(CASE WHEN action_taken = \'TRUE DEFECT\' THEN 1 ELSE 0 END), 0) AS true_defect_count \n'
# 'FROM mvis_processed_info \n'
# 'WHERE \n'
#   'TO_TIMESTAMP(start_ts) >= DATE_TRUNC(\'month\', CURRENT_DATE - INTERVAL \'2 months\') \n'
#   'AND TO_TIMESTAMP(start_ts) < DATE_TRUNC(\'month\', CURRENT_DATE) + INTERVAL \'1 month\' \n'
#   'AND defect_code = \'{}\' \n'
# 'GROUP BY month \n'
# 'ORDER BY MIN(DATE_TRUNC(\'month\', TO_TIMESTAMP(start_ts))) DESC;')
mvis_mgr_graphs_qry = (
    "SELECT \n"
    "  months.month AS month, \n"
    "  COALESCE(total_alerts, 0) AS total_alerts, \n"
    "  COALESCE(true_defect_count, 0) AS true_defect_count \n"
    "FROM \n"
    "  ( \n"
    "    SELECT \n"
    "      TO_CHAR(DATE_TRUNC('month', CURRENT_DATE - (INTERVAL '1 month' * generate_series(0, 2))), 'Mon') AS month \n"
    "  ) months \n"
    "LEFT JOIN \n"
    "  ( \n"
    "    SELECT \n"
    "      TO_CHAR(DATE_TRUNC('month', TO_DATE(SUBSTRING(train_id FROM 2 FOR 8), 'YYYYMMDD')), 'Mon') AS month, \n"
    "      COALESCE(COUNT(action_taken) FILTER(WHERE defect_code LIKE '%' AND defect_image != '-'), 0) AS total_alerts, \n"
    "      COALESCE(SUM(CASE WHEN action_taken = 'TRUE DEFECT' THEN 1 ELSE 0 END), 0) AS true_defect_count \n"
    "    FROM mvis_processed_info \n"
    "    WHERE \n"
    "      SUBSTRING(train_id FROM 2 FOR 6) >= TO_CHAR(DATE_TRUNC('month', CURRENT_DATE - INTERVAL '2 months'), 'YYYYMM') \n"
    "      AND SUBSTRING(train_id FROM 2 FOR 6) < TO_CHAR(DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month', 'YYYYMM') \n"
    "      AND defect_code = '{}' \n"
    "    GROUP BY month \n"
    "  ) data \n"
    "ON months.month = data.month \n"
    "ORDER BY TO_DATE('01-' || months.month || '-2000', 'DD-Mon-YYYY') DESC;"
)


# mvis_mgr_graphs_daterange_qry = ('SELECT \n'
#   'TO_CHAR(DATE_TRUNC(\'month\', TO_TIMESTAMP(start_ts)), \'Mon\') AS month, \n'
#   'COALESCE(COUNT(action_taken) FILTER(WHERE defect_code like \'%\' and defect_image != \'-\'), 0) AS total_alerts, \n'
#   'COALESCE(SUM(CASE WHEN action_taken = \'TRUE DEFECT\' THEN 1 ELSE 0 END), 0) AS true_defect_count \n'
# 'FROM mvis_processed_info \n'
# 'WHERE \n'
#   'TO_TIMESTAMP(start_ts) >= TO_TIMESTAMP({}) \n'
#   'AND TO_TIMESTAMP(start_ts) < TO_TIMESTAMP({}) \n'
#   'AND defect_code = \'{}\' \n'
# 'GROUP BY month \n'
# 'ORDER BY MIN(DATE_TRUNC(\'month\', TO_TIMESTAMP(start_ts))) DESC;')
# mvis_mgr_graphs_daterange_qry = (
#     'SELECT \n'
#     '  TO_CHAR(DATE_TRUNC(\'month\', TO_DATE(SUBSTRING(train_id FROM 2 FOR 8), \'YYYYMMDD\')), \'Mon\') AS month, \n'
#     '  COALESCE(COUNT(action_taken) FILTER(WHERE defect_code LIKE \'%\' AND defect_image != \'-\'), 0) AS total_alerts, \n'
#     '  COALESCE(SUM(CASE WHEN action_taken = \'TRUE DEFECT\' THEN 1 ELSE 0 END), 0) AS true_defect_count \n'
#     'FROM mvis_processed_info \n'
#     'WHERE \n'
#     '  SUBSTRING(train_id FROM 2 FOR 6) >= \'{}\' \n'
#     '  AND SUBSTRING(train_id FROM 2 FOR 6) < \'{}\' \n'
#     '  AND defect_code = \'{}\' \n'
#     'GROUP BY month \n'
#     'ORDER BY MIN(DATE_TRUNC(\'month\', TO_DATE(SUBSTRING(train_id FROM 2 FOR 8), \'YYYYMMDD\'))) DESC;'
# )
mvis_mgr_graphs_daterange_qry = (
    "SELECT DISTINCT ON (months.month)\n"
    "  months.month AS month,\n"
    "  COALESCE(total_alerts, 0) AS total_alerts,\n"
    "  COALESCE(true_defect_count, 0) AS true_defect_count\n"
    "FROM\n"
    "  (\n"
    "    SELECT\n"
    "      TO_CHAR(DATE_TRUNC('month', TO_DATE('{}', 'YYYYMM')), 'Mon') AS month\n"
    "    FROM\n"
    "      generate_series(\n"
    "        (SELECT DATE_TRUNC('month', TO_DATE('{}', 'YYYYMM'))),\n"
    "        (SELECT DATE_TRUNC('month', TO_DATE('{}', 'YYYYMM'))),\n"
    "        INTERVAL '1 month'\n"
    "      ) AS months\n"
    "  ) months\n"
    "LEFT JOIN\n"
    "  (\n"
    "    SELECT\n"
    "      TO_CHAR(DATE_TRUNC('month', TO_DATE(SUBSTRING(train_id FROM 2 FOR 6), 'YYYYMM')), 'Mon') AS month,\n"
    "      COUNT(CASE WHEN defect_code = '{}' THEN 1 END) AS total_alerts,\n"
    "      COUNT(CASE WHEN defect_code = '{}' AND action_taken = 'TRUE DEFECT' THEN 1 END) AS true_defect_count\n"
    "    FROM mvis_processed_info\n"
    "    WHERE\n"
    "      SUBSTRING(train_id FROM 2 FOR 6) >= '{}'\n"
    "      AND SUBSTRING(train_id FROM 2 FOR 6) < '{}'\n"
    "      AND defect_code = '{}'\n"
    "    GROUP BY month\n"
    "  ) data\n"
    "ON months.month = data.month\n"
    "AND data.month IS NOT NULL\n"
    "ORDER BY months.month;"
)


mvis_total_count_qry = (
    "select COUNT(DISTINCT(mpi.train_id)) as tid \n"
    "FROM mvis_processed_info mpi \n"
    "WHERE mpi.train_id BETWEEN '{}' AND '{}' \n"
    "ORDER BY 1 DESC;"
)

# mvis_total_count_qry = ('select COUNT(DISTINCT(mpi.train_id)) as tid \n'
#      'FROM mvis_processed_info mpi \n'
#      'WHERE mpi.start_ts between {} AND {} \n'
#      'ORDER BY 1 DESC;')


# mvis_def_cnt_qry = ('select COUNT(mpi.defect_image) from mvis_processed_info mpi \n'
#     'where mpi.ts between {} AND {} AND mpi.defect_code like \'{}\' AND mpi.defect_image != \'-\';')

# mvis_true_cnt_qry = ('SELECT COALESCE ((select COUNT(mpi.defect_image) from mvis_processed_info mpi \n'
#     'where mpi.ts between {} AND {} AND defect_code like \'{}\' AND action_taken != \'-\' AND mpi.defect_image != \'-\' \n'
#     'AND mpi.action_taken = \'TRUE DEFECT\' group by action_taken), 0) as true_cnt; ')

# mvis_false_cnt_qry = ('SELECT COALESCE ((select COUNT(mpi.defect_image) from mvis_processed_info mpi \n'
#     'where mpi.ts between {} AND {} AND defect_code like \'{}\' AND action_taken != \'-\' AND mpi.defect_image != \'-\' \n'
#     'AND mpi.action_taken = \'FALSE POSITIVE\' group by action_taken), 0) as false_cnt; ')

# mvis_def_cnt_qry = ('select COUNT(mpi.defect_image) from mvis_processed_info mpi \n'
#     'where mpi.train_id BETWEEN \'{}\' AND \'{}\' AND mpi.defect_code like \'{}\' AND mpi.defect_image != \'-\';')


# updated one
mvis_def_cnt_qry = (
    "select COUNT( distinct (train_id,mpi.tagged_wagon_id,mpi.side,mpi.defect_code)) from mvis_processed_info mpi \n"
    "where mpi.train_id BETWEEN '{}' AND '{}' AND mpi.defect_code like '{}' AND mpi.defect_image != '-';"
)

mvis_true_cnt_qry = (
    "SELECT COALESCE ((select COUNT(distinct (train_id,mpi.tagged_wagon_id,mpi.side,mpi.defect_code)) from mvis_processed_info mpi \n"
    "where mpi.train_id BETWEEN '{}' AND '{}' AND defect_code like '{}' AND action_taken != '-' AND mpi.defect_image != '-' \n"
    "AND mpi.action_taken = 'TRUE DEFECT' group by action_taken), 0) as true_cnt; "
)

# mvis_false_cnt_qry = ('SELECT COALESCE ((select COUNT(distinct (train_id,mpi.tagged_wagon_id,mpi.side,mpi.defect_code)) from mvis_processed_info mpi \n'
#     'where mpi.train_id BETWEEN \'{}\' AND \'{}\' AND defect_code like \'{}\' AND action_taken != \'-\' AND mpi.defect_image != \'-\' \n'
#     'AND mpi.action_taken = \'FALSE POSITIVE\' group by action_taken), 0) as false_cnt; ')

mvis_false_cnt_qry = (
    "SELECT COUNT(DISTINCT CONCAT(mpi.train_id, mpi.tagged_wagon_id, mpi.side, mpi.defect_code)) AS false_cnt "
    "FROM mvis_processed_info mpi "
    "WHERE mpi.train_id BETWEEN '{}' AND '{}' "
    "AND mpi.defect_code LIKE '{}' "
    "AND mpi.action_taken = 'FALSE POSITIVE' "
    "AND mpi.defect_image != '-' "
    "AND NOT EXISTS ("
    "    SELECT 1 "
    "    FROM mvis_processed_info mpi_true "
    "    WHERE mpi_true.train_id = mpi.train_id "
    "    AND mpi_true.tagged_wagon_id = mpi.tagged_wagon_id "
    "    AND mpi_true.side = mpi.side "
    "    AND mpi_true.defect_code = mpi.defect_code "
    "    AND mpi_true.action_taken = 'TRUE DEFECT' "
    ");"
)


class Dashboard(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        """dashboard post api"""

        start_time = time.time()
        start_date = request.data.get("start1")
        end_date = request.data.get("end1")
        start_date, end_date = views.Dashboard.convert_date_epoch(
            self, start_date, end_date
        )
        # if start_date is not None:
        #     start_date = Point.convert_datetime_to_epoch(start_date)

        # if end_date is not None:
        #     end_date = Point.convert_datetime_to_epoch(end_date)

        """get the week dates"""
        numdays = 7

        """Train count for a Week"""
        todayStart, todayEnd = Point.calc_epoch_start_end(self, 0)
        current_day_rep = []
        week_date_list = []
        tr_date = []
        def_date = []
        week_train_count_list = []
        week_defect_count_list = []
        week_train_count_dict = {}
        current_whole_info = []

        qry_str = current_day_qry
        current_day_info_qry_str = qry_str.format(todayStart, todayEnd)
        current_day_info_column_names, current_day_info_result = (
            views.db_queries.exec_db_query(SELECT, current_day_info_qry_str)
        )

        qry_temp = train_dfis_both_qry
        defect_day_info_qry_str = qry_temp.format(todayStart, todayEnd)
        defect_day_info_column_names, defect_day_info_result = (
            views.db_queries.exec_db_query(SELECT, defect_day_info_qry_str)
        )

        current_day_train_count = (
            DefectInfo.objects.filter(ts__gte=todayStart, ts__lte=todayEnd)
            .order_by("-ts")
            .values("train_id")
            .distinct()
            .count()
        )  # .exclude(train_processed=False)

        weekStart, weekEnd = Point.calc_epoch_start_end(self, numdays - 1)

        current_week_train_count_mvis = (
            DefectInfo.objects.filter(ts__gte=weekStart, ts__lte=todayEnd)
            .order_by("-ts")
            .values("train_id")
            .distinct()
            .count()
        )

        qry_temp = mvis_mgr_default_qry  # mvis_def_cnt_qry
        mvis_def_cnt_qry_str = qry_temp.format(start_date, end_date)
        mvis_def_cnt_qry_column_names, monthDefectCount = (
            views.db_queries.exec_db_query(SELECT, mvis_def_cnt_qry_str)
        )

        #         defect_code = ['003', '009', '004', '006', '007', '005', '008', '001', '002']

        # # Initialize an empty list to store all graphsValues
        #         all_graphs_values = []

        #         for x in range(9):
        #             mvis_mgr_graphs_qry_str = mvis_mgr_graphs_qry.format(defect_code[x])
        #             col_names, graphsValues = views.db_queries.exec_db_query(
        #                 SELECT, mvis_mgr_graphs_qry_str)

        #             # Append graphsValues to the all_graphs_values list
        #             all_graphs_values.append(graphsValues)
        #         print("GRAPHHH VALUESSSSSSSSSSSSSSSSSSSS:",all_graphs_values)
        defect_code = ["003", "009", "004", "006", "007", "005", "008", "001", "002"]

        # Initialize an empty dictionary to store graphsValues for each defect_code
        graphs_values_by_defect_code = {}

        for x in range(9):
            mvis_mgr_graphs_qry_str = mvis_mgr_graphs_qry.format(defect_code[x])
            col_names, graphsValues = views.db_queries.exec_db_query(
                SELECT, mvis_mgr_graphs_qry_str
            )

            # Store graphsValues in the dictionary with the corresponding defect_code as the key
            graphs_values_by_defect_code[defect_code[x]] = graphsValues

        # Now you can access the graphsValues for each defect_code separately
        def_1 = graphs_values_by_defect_code["003"]
        def_2 = graphs_values_by_defect_code["009"]
        def_3 = graphs_values_by_defect_code["004"]
        def_4 = graphs_values_by_defect_code["006"]
        def_5 = graphs_values_by_defect_code["007"]
        def_6 = graphs_values_by_defect_code["005"]
        def_7 = graphs_values_by_defect_code["008"]
        def_8 = graphs_values_by_defect_code["001"]
        def_9 = graphs_values_by_defect_code["002"]

        today = datetime.now()
        cur_date = today.day
        cur_year = today.year
        cur_month = today.month

        try:
            _, prev_month_days = monthrange(cur_year, cur_month - 1)
        except calendar.IllegalMonthError:
            print("Caught IllegalMonthError")
            prev_month_days = 12
        # For the change in year Dec 2022 to Jan 2023
        if cur_month > 1:
            prev_first_day = datetime(cur_year, cur_month - 1, 1)
            prev_last_day = datetime(cur_year, cur_month - 1, prev_month_days)
        else:
            prev_first_day = datetime(cur_year, cur_month, 1)
            prev_last_day = datetime(cur_year, cur_month, prev_month_days)
        prev_first_day = prev_first_day.strftime("%d-%m-%Y")
        prev_last_day = prev_last_day.strftime("%d-%m-%Y")

        prevMonthStart, prevMonthEnd = views.Dashboard.convert_date_epoch(
            self, prev_first_day, prev_last_day
        )

        _, cur_month_days = monthrange(cur_year, cur_month)
        cur_first_day = datetime(cur_year, cur_month, 1)
        cur_last_day = datetime(cur_year, cur_month, cur_month_days)
        cur_first_day = cur_first_day.strftime("%d-%m-%Y")
        cur_last_day = cur_last_day.strftime("%d-%m-%Y")

        curMonthStart, curMonthEnd = views.Dashboard.convert_date_epoch(
            self, cur_first_day, cur_last_day
        )

        prev_saturday_date, upcoming_friday_date, upcoming_friday_fulldate = (
            views.Dashboard.satandsun(today)
        )

        curSaturdayStart, curFridayEnd = views.Dashboard.convert_date_epoch(
            self, upcoming_friday_date, prev_saturday_date
        )

        prev_month_train_count = (
            DefectInfo.objects.filter(ts__range=(prevMonthStart, prevMonthEnd))
            .order_by("-ts")
            .values("train_id")
            .distinct()
            .exclude(ts=None)
            .count()
        )
        current_month_train_count = (
            DefectInfo.objects.filter(ts__range=(curMonthStart, todayEnd))
            .order_by("-ts")
            .values("train_id")
            .distinct()
            .exclude(ts=None)
            .count()
        )
        prev_week_train_count = (
            DefectInfo.objects.filter(ts__gte=weekStart, ts__lte=todayEnd)
            .order_by("-ts")
            .values("train_id")
            .distinct()
            .count()
        )

        """ No. of Defect counts """
        current_day_defect_count = (
            DefectInfo.objects.filter(ts__range=(todayStart, todayEnd))
            .order_by("-ts")
            .exclude(defect_code="-")
            .count()
        )
        prev_month_defect_count = (
            DefectInfo.objects.filter(ts__range=(prevMonthStart, prevMonthEnd))
            .order_by("-ts")
            .exclude(defect_code="-")
            .count()
        )

        current_month_qry_temp = train_dfis_both_qry
        defect_current_month_qry_str = current_month_qry_temp.format(
            curMonthStart, todayEnd
        )
        defect_current_month_column_names, current_month_defect_count_result = (
            views.db_queries.exec_db_query(SELECT, defect_current_month_qry_str)
        )

        prev_week_qry_temp = train_dfis_both_qry
        defect_prev_week_qry_str = prev_week_qry_temp.format(
            curSaturdayStart, curFridayEnd
        )
        defect_prev_week_column_names, prev_week_defect_count_result = (
            views.db_queries.exec_db_query(SELECT, defect_prev_week_qry_str)
        )

        """True counts"""
        current_day_true_count = (
            DefectInfo.objects.filter(
                ts__range=(todayStart, todayEnd),
                action_taken="TRUE DEFECT",
            )
            .order_by("-ts")
            .exclude(Q(defect_code="-") | Q(action_taken="-"))
            .count()
        )

        current_day_no_fb_count = (
            DefectInfo.objects.filter(
                ts__range=(start_date, end_date),
                action_taken="-",
            )
            .order_by("-ts")
            .exclude(defect_code="-")
            .count()
        )

        """FEEDBACK NOT GIVEN VALUES FOR DASHBOARD MAIN TABLE"""
        fb_not_given_qry_str = mvis_fb_notGiven_qry.format(start_date, end_date)

        fb_not_given_column_names, fb_not_given_result = views.db_queries.exec_db_query(
            SELECT, fb_not_given_qry_str
        )

        false_positive_qry_str = false_positive_qry.format(start_date, end_date)

        fb_not_given_column_names, false_positive_result = (
            views.db_queries.exec_db_query(SELECT, false_positive_qry_str)
        )

        # mvis_left_wagon_qry_str = mvis_left_wagon_qry.format()
        # mvis_defect_column_names, mvis_left_wagon_result = views.db_queries.exec_db_query(SELECT, mvis_left_wagon_qry_str)
        # print("WAGONNNNNNNNNN ID:",mvis_left_wagon_result)

        """False counts"""
        current_day_false_count = (
            DefectInfo.objects.filter(
                ts__range=(todayStart, todayEnd),
                action_taken="FALSE POSITIVE",
            )
            .order_by("-ts")
            .exclude(Q(defect_code="-") | Q(action_taken="-"))
            .count()
        )

        cur_day_wag_alm_cnt = TrainConsolidatedInfo.objects.filter(
            entry_time__range=(todayStart, todayEnd)
        ).values_list("total_axles", "total_bad_wheels")
        lst_wag_alm_cnt = list(cur_day_wag_alm_cnt)
        """ The number minus 6 axles for loco and then summed up """
        res_wag_alm_cnt = sum((wag_idx[0] - 6) for wag_idx in lst_wag_alm_cnt), sum(
            alm_idx[1] for alm_idx in lst_wag_alm_cnt
        )
        """ The number is divided by 4 to get wagon number """
        current_day_wagon_count = round((res_wag_alm_cnt[0]) / 4)
        current_day_alarm_count = res_wag_alm_cnt[1]

        prev_week_wag_alm_cnt = TrainConsolidatedInfo.objects.filter(
            entry_time__range=(curSaturdayStart, curFridayEnd)
        ).values_list("total_axles", "total_bad_wheels")
        lst_prev_wag_alm_cnt = list(prev_week_wag_alm_cnt)
        """ The number minus 6 axles for loco and then summed up """
        res_prev_wag_alm_cnt = sum(
            (wag_idx[0] - 6) for wag_idx in lst_prev_wag_alm_cnt
        ), sum(alm_idx[1] for alm_idx in lst_prev_wag_alm_cnt)
        prev_week_wagon_count = round(res_prev_wag_alm_cnt[0] / 4)
        prev_week_alarm_count = res_prev_wag_alm_cnt[1]

        prev_month_wag_alm_cnt = TrainConsolidatedInfo.objects.filter(
            entry_time__range=(prevMonthStart, prevMonthEnd)
        ).values_list("total_axles", "total_bad_wheels")
        lst_prev_month_wag_alm_cnt = list(prev_month_wag_alm_cnt)
        """ The number minus 6 axles for loco and then summed up """
        res_prev_month_wag_alm_cnt = sum(
            (wag_idx[0] - 6) for wag_idx in lst_prev_month_wag_alm_cnt
        ), sum(alm_idx[1] for alm_idx in lst_prev_month_wag_alm_cnt)
        prev_month_wagon_count = round(res_prev_month_wag_alm_cnt[0] / 4)
        prev_month_alarm_count = res_prev_month_wag_alm_cnt[1]

        current_month_wag_alm_cnt = TrainConsolidatedInfo.objects.filter(
            entry_time__range=(curMonthStart, todayEnd)
        ).values_list("total_axles", "total_bad_wheels")
        lst_cur_month_wag_alm_cnt = list(current_month_wag_alm_cnt)
        """ The number minus 6 axles for loco and then summed up """
        res_cur_month_wag_alm_cnt = sum(
            (wag_idx[0] - 6) for wag_idx in lst_cur_month_wag_alm_cnt
        ), sum(alm_idx[1] for alm_idx in lst_cur_month_wag_alm_cnt)
        current_month_wagon_count = round(res_cur_month_wag_alm_cnt[0] / 4)
        current_month_alarm_count = res_cur_month_wag_alm_cnt[1]

        week_startdate = datetime.strptime(prev_saturday_date, "%d-%m-%Y")
        week_enddate = datetime.strptime(upcoming_friday_date, "%d-%m-%Y")
        """ plus 1 to consider from saturday """
        numdays_week = (week_startdate - week_enddate).days + 1
        starting_month_date = datetime.today().date().replace(day=1)
        total_days = (datetime.today().date() - (starting_month_date)).days + 1
        week_date_list = self.calc_week_dates(total_days, datetime.today())

        first_day_epoch, current_day_epoch = Point.calc_epoch_start_end(self, 0)
        first_day_epoch, ignoredDate2 = Point.calc_epoch_start_end(self, total_days - 1)
        tfqs_start_time = time.time()
        train_formated_qry_str = week_train_count_qry.format(
            first_day_epoch, current_day_epoch
        )
        column_names, train_result = views.db_queries.exec_db_query(
            SELECT, train_formated_qry_str
        )
        tfqs_stop_time = time.time()

        dfqs_start_time = time.time()
        defect_formated_qry_str = week_defect_count_qry.format(
            first_day_epoch, current_day_epoch
        )
        column_names1, defect_result = views.db_queries.exec_db_query(
            SELECT, defect_formated_qry_str
        )

        for tr_idx in train_result:
            tr_date.append(tr_idx[0].strftime("%d-%m-%Y"))
            tr_date.reverse()
            week_train_count_list.append(tr_idx[1])

        for def_idx in defect_result:
            def_date.append(def_idx[0].strftime("%d-%m-%Y"))
            week_defect_count_list.append(def_idx[1])

        for indx, date in enumerate(week_date_list):
            if date not in tr_date:
                week_train_count_list.insert(indx, 0)
            if date not in def_date:
                week_defect_count_list.insert(indx, 0)
            else:
                pass

        for indxTrain in range(len(current_day_info_result)):
            current_train_id = current_day_info_result[indxTrain][0]
            for indxDefect in range(len(defect_day_info_result)):
                if current_train_id == defect_day_info_result[indxDefect][3]:
                    current_whole_info.append(
                        current_day_info_result[indxTrain]
                        + (
                            defect_day_info_result[indxDefect][4],
                            defect_day_info_result[indxDefect][5],
                            defect_day_info_result[indxDefect][6],
                            defect_day_info_result[indxDefect][7],
                        )
                    )
                else:
                    pass

        dashboardData = {
            "monthDefectCount": monthDefectCount,
            "def_1": def_1,
            "def_2": def_2,
            "def_3": def_3,
            "def_4": def_4,
            "def_5": def_5,
            "def_6": def_6,
            "def_7": def_7,
            "def_8": def_8,
            "def_9": def_9,
            "fb_not_given_result": fb_not_given_result,
            "false_positive_result": false_positive_result,
            "current_day_no_fb_count": current_day_no_fb_count,
            "current_day_false_count": current_day_false_count,
            "current_day_true_count": current_day_true_count,
            "current_day_train_info": current_whole_info,
            "current_day_train_count": current_day_train_count,
            "current_week_train_count": current_week_train_count_mvis,  # prev_week_train_count,
            # 'prev_week_train_count': prev_week_train_count,
            "prev_month_train_count": prev_month_train_count,
            "current_month_train_count": current_month_train_count,
            "current_day_defect_count": current_day_defect_count,
            "prev_week_defect_count": len(prev_week_defect_count_result),
            "prev_month_defect_count": prev_month_defect_count,
            "current_month_defect_count": len(current_month_defect_count_result),
            "current_day_wagon_count": current_day_wagon_count,
            "prev_week_wagon_count": prev_week_wagon_count,
            "prev_month_wagon_count": prev_month_wagon_count,
            "current_month_wagon_count": current_month_wagon_count,
            "current_day_alarm_count": current_day_alarm_count,
            "prev_week_alarm_count": prev_week_alarm_count,
            "prev_month_alarm_count": prev_month_alarm_count,
            "current_month_alarm_count": current_month_alarm_count,
            "week_date_list": week_date_list,
            "week_train_count_list": week_train_count_list,
            "week_defect_count_list": week_defect_count_list,
        }

        return Response(dashboardData)

    def calc_week_dates(self, numdays, friday_date):
        current_day = friday_date
        for x in range(0, numdays):
            dates_list = [
                datetime.strftime(current_day - timedelta(days=x), "%d-%m-%Y")
                for x in range(numdays)
            ]

            dates_list.reverse()

        return dates_list

    """ calculate the number of days to create the list """

    def calc_diff_days(self, epoch_start, epoch_end):
        dt1 = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(epoch_start))
        dt2 = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(epoch_end))
        date_format = "%Y-%m-%d %H:%M:%S"
        start_date = datetime.strptime(dt1, date_format)
        end_date = datetime.strptime(dt2, date_format)
        diffInDays = end_date - start_date
        num_of_days = diffInDays.days + 1

        return num_of_days

    def convert_date_epoch(self, date1, date2):
        p = "%d-%m-%Y"  # %H:%M:%S
        epoch_start = time.mktime(time.strptime(date1, p))
        epoch_end = time.mktime(time.strptime(date2, p)) + 86399

        return epoch_start, epoch_end

    def satandsun(input):
        d = input.toordinal()
        last = d - 6
        sunday = last - (last % 7) - 1
        saturday = sunday + 6
        sun_day = (date.fromordinal(sunday)).strftime("%d-%m-%Y")
        sat_day = input.strftime("%d-%m-%Y")
        sat_full_day_str = input.strftime("%Y-%m-%d %H:%M:%S.%f")
        sat_full_day = datetime.strptime(sat_full_day_str, "%Y-%m-%d %H:%M:%S.%f")

        return sat_day, sun_day, sat_full_day

    def get_duration(self, duration):
        hours = int(duration / 3600)
        minutes = int(duration % 3600 / 60)
        seconds = int((duration % 3600) % 60)
        return "{:02d}:{:02d}:{:02d}".format(hours, minutes, seconds)

    def yard_performance(self, epoch_start, epoch_end):
        """get unloaded torpedo count for each PS, total unloaded torpedo counts"""

        total_train_data = TrainConsolidatedInfo.objects.order_by("entry_time").exclude(
            exit_time=None
        )

        total_train_count = total_train_data.count()

        list_len = views.Dashboard.calc_diff_days(self, epoch_start, epoch_end)

        overall_train_count = [0] * list_len
        overall_defect_count = [0] * list_len
        overall_wagon_count = [0] * list_len
        overall_fwild_count = [0] * list_len
        res_wag_alm_cnt = [0] * list_len
        unloaded_latest_per_day = []
        defects_total_per_day = []

        """ for list_len days """
        if total_train_count != 0:
            # for iterator in pouring_section_list:
            for cntIndx in range(len(overall_train_count)):

                day_start = epoch_start + (86400 * cntIndx)
                day_end = day_start + (86399)

                trains_total_per_day = TrainConsolidatedInfo.objects.filter(
                    entry_time__gte=day_start, entry_time__lte=day_end
                ).order_by(
                    "entry_time"
                )  # .exclude(train_processed=False)

                defects_total_per_day = (
                    DefectInfo.objects.filter(ts__range=(day_start, day_end))
                    .order_by("-ts")
                    .exclude(ts=None, defect_code="-")
                )
                wagon_total_per_day = TrainConsolidatedInfo.objects.filter(
                    entry_time__range=(day_start, day_end)
                ).values_list("total_axles", "total_bad_wheels")
                lst_wag_alm_cnt = list(wagon_total_per_day)
                res_wag_alm_cnt[cntIndx] = sum(
                    (wag_idx[0] - 6) for wag_idx in lst_wag_alm_cnt
                ), sum(alm_idx[1] for alm_idx in lst_wag_alm_cnt)
                overall_wagon_count[cntIndx] = round(res_wag_alm_cnt[cntIndx][0] / 4)
                overall_fwild_count[cntIndx] = res_wag_alm_cnt[cntIndx][1]

                overall_train_count[cntIndx] = len(list(trains_total_per_day))
                overall_defect_count[cntIndx] = len(list(defects_total_per_day))
        else:
            pass

        return (
            overall_train_count,
            overall_defect_count,
            overall_wagon_count,
            overall_fwild_count,
        )


class DfisData(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        global info_with_dfis

        todayStart, todayEnd = Point.calc_epoch_start_end(self, 0)

        if request.data.get("dfisId"):

            dfis_train_id = request.data.get("dfisId")
            train_id = request.data.get("trainId")

            TrainConsolidatedInfo.objects.filter(train_id=train_id).update(
                dfis_train_id=dfis_train_id
            )
            info_with_dfis = TrainConsolidatedInfo.objects.filter(train_id=train_id)

        serializer2 = TrainConsolidatedInfoSerializer(info_with_dfis, many=True)

        dfisData = {
            "info_with_dfis": serializer2.data,
        }

        return Response(dfisData)


class remarksData(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        global info_with_remarks

        remarks = request.data.get("remarks")
        train_id = request.data.get("train_id")
        defect_img = request.data.get("defect_img")

        DefectInfo.objects.filter(train_id=train_id, defect_image=defect_img).update(
            remarks=remarks
        )
        info_with_remarks = DefectInfo.objects.filter(train_id=train_id)

        serializer2 = DefectInfoSerializer(info_with_remarks, many=True)

        remarksdata = {
            "info_with_remarks": serializer2.data,
        }

        return Response(remarksdata)


# class mvis_update_fied_report(APIView):
#     permission_classes = (IsAuthenticated,)

#     def post(self, request, *args, **kwargs):
#         global info_with_fr


#         field_report = request.data.get('field_report')
#         train_id = request.data.get('train_id')
#         defect_img = request.data.get('defect_img')

#         print("FIELD REPORTTTTT: ",field_report,train_id)

#         DefectInfo.objects.filter(
#             train_id=train_id,defect_image = defect_img).update(field_report=field_report)
#         info_with_fr= DefectInfo.objects.filter(
#             train_id=train_id)

#         serializer2 = DefectInfoSerializer(
#             info_with_fr, many=True)

#         fieldReportdata = {
#             'info_with_fr': serializer2.data,
#         }

#         return Response(fieldReportdata)


class mvis_update_field_report(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):

        train_id = request.data.get("train_id")
        defect_image = request.data.get("defect_image")
        field_report = request.data.get("field_report")
        print("DETAILSSSSSSSSSS : ", train_id, defect_image, field_report)

        mvis_update_field_report_res = {}

        mvis_update_field_report_res = DefectInfo.objects.filter(
            train_id=train_id, defect_image=defect_image
        ).update(field_report=field_report)

        print("mvis_update_feedback_res", mvis_update_field_report_res)

        # items_mvis_summary_qry_str = items_mvis_summary_qry.format(trainID, mvis_defect_code)
        # items_mvis_summary_qry_col_names, items_mvis_summary_res = views.db_queries.exec_db_query(SELECT, items_mvis_summary_qry_str)

        # print('items_mvis_summary_qry_res', items_mvis_summary_res)

        mvisfieldReportRes = {
            "final_result": mvis_update_field_report_res,
        }

        return Response(mvisfieldReportRes)


class mvis_update_missed_info(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        dateTime = request.data.get("dateTime")
        # startdate = request.data.get('startDate')
        # enddate = request.data.get('endDate')
        train_id = request.data.get("train_id")
        tagged_wagon_id = request.data.get("tagged_wagon_id")
        photo_file = request.FILES.get(
            "defect_image"
        )  # Changed from 'defect_image' to 'photo'
        missed_remarks = request.data.get("remarks")
        # DateStart, DateEnd = views.Dashboard.convert_date_epoch(self,startdate, enddate)

        if photo_file:
            # Save the file to the 'media/images' directory using Django's default storage backend
            saved_file_name = default_storage.save(
                settings.MEDIA_ROOT + "/images/" + photo_file.name,
                ContentFile(photo_file.read()),
            )

            # Extract just the filename (without path)
            photo_filename = photo_file.name.split("/")[-1]

        if request.data.get("defType") is None:
            defect_type = "All"
        else:
            defect_type = request.data.get("defType")

        defType = ""
        if defect_type == "All":
            defType = defType + "%"
        else:
            defType = defType + defect_type

        # Assuming 'Point.convert_datetime_to_epoch()' converts dateTime to epoch time
        date_time = Point.convert_datetime_to_epoch(dateTime)

        # Save the MissedInfo object
        mvis_update_missed_info_res = MissedInfo.objects.create(
            ts=date_time,
            train_id=train_id,
            tagged_wagon_id=tagged_wagon_id,
            defect_code=defType,
            defect_image=photo_filename,
            missed_remarks=missed_remarks,
        )

        print("mvis_update_feedback_res:", mvis_update_missed_info_res)

        # Serialize the saved object
        serializer2 = MissedInfoSerializer(mvis_update_missed_info_res)

        mvisMissedRes = {
            "final_result": serializer2.data,
        }

        return Response(mvisMissedRes)


class MissedCountDetails(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        if request.data.get("startDate"):
            start_date = request.data.get("startDate")
            end_date = request.data.get("endDate")

            DateStart, DateEnd = views.Dashboard.convert_date_epoch(
                self, start_date, end_date
            )

            mvis_MissedAlerts_qry_str = mvis_MissedAlerts_qry.format(DateStart, DateEnd)
            mvis_truecount_column_names, mvis_MissedAlerts_result = (
                views.db_queries.exec_db_query(SELECT, mvis_MissedAlerts_qry_str)
            )

            print("mvis_MissedAlerts_resulttttttt:", mvis_MissedAlerts_result)

            trainMissedCount = {
                "result": mvis_MissedAlerts_result,
            }

            return Response(trainMissedCount)


class DefectActionTaken(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        global info_with_defect_wagon

        todayStart, todayEnd = Point.calc_epoch_start_end(self, 0)

        if request.data.get("action_taken"):

            get_action_taken = request.data.get("action_taken")
            train_id = request.data.get("trainId")
            get_wagon_id = request.data.get("taggedWagonId")
            get_bogie_id = request.data.get("taggedBogieId")

            DefectInfo.objects.filter(
                train_id=train_id,
                tagged_wagon_id=get_wagon_id,
                tagged_bogie_id=get_bogie_id,
            ).update(action_taken=get_action_taken)
            info_with_defect_wagon = DefectInfo.objects.filter(train_id=train_id)

        serializer2 = DefectInfoSerializer(info_with_defect_wagon, many=True)

        defectActionData = {
            "info_with_defect_wagon": serializer2.data,
        }

        return Response(defectActionData)


class WagonData(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        global info_with_wagon

        todayStart, todayEnd = Point.calc_epoch_start_end(self, 0)

        if request.data.get("wagonId"):

            get_train_id = request.data.get("trainId")
            get_tagged_wagon_id = request.data.get("taggedWagonId")
            get_wagon_id = request.data.get("wagonId")

            LeftWagonInfo.objects.filter(
                train_id=get_train_id, tagged_wagon_id=get_tagged_wagon_id
            ).update(wagon_id=get_wagon_id)
            # obj = LeftWagonInfo.objects.get(train_id =get_train_id,tagged_wagon_id=get_tagged_wagon_id)
            # print(obj.wagon_id)
            # obj.wagon_id = get_wagon_id
            # obj.save()
            info_with_wagon = LeftWagonInfo.objects.filter(train_id=get_train_id)

        serializer2 = LeftWagonInfoSerializer(info_with_wagon, many=True)

        wagonData = {
            "info_with_wagon": serializer2.data,
        }

        return Response(wagonData)


class DefectInformation(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        """dashboard unloaded torpedo api"""

        numdays = 7
        get_week_dates = Dashboard.calc_week_dates(self, numdays)

        unloadedData = {
            "get_week_dates": get_week_dates,
        }

        return Response(unloadedData)


class Point(APIView):
    # permission_classes = (IsAuthenticated,)
    def post(self, request, *args, **kwargs):
        point_service = TimedService("point", "Point service")
        point_service.start()

        start_time = time.time()

        endS_time = time.time()
        pointData = {
            "start_time": start_time,
        }
        point_service.end()

        return Response(pointData)

    def reduce_duplicates(arr):
        my_dict = {}
        for tupple in arr:
            train_id = tupple[0]
            dt = tupple[1]
            wagon_no = tupple[2]
            side = tupple[3]
            key = train_id + wagon_no + side
            if key in my_dict:
                pass
            else:
                my_dict[key] = tupple
        res_arr = list(my_dict.values())
        return res_arr

    def process_reduced_duplicates(arr):
        my_dict = {}
        res_arr = []
        for tupple in arr:
            train_id = tupple[0]
            dt = tupple[1]
            if train_id not in my_dict:
                my_dict[train_id] = {"dt": dt, "count": 1}
            else:
                my_dict[train_id]["count"] += 1
        for k, v in my_dict.items():
            tup_res = (k, v["dt"], v["count"])
            res_arr.append(tup_res)

        return res_arr

    def calc_epoch_start_end(self, dateType):
        requested_date = datetime.strftime(datetime.now() - timedelta(dateType), "%d")
        requested_month = datetime.strftime(datetime.now() - timedelta(dateType), "%m")
        requested_year = datetime.strftime(datetime.now() - timedelta(dateType), "%Y")

        requested_dmy = (
            str(requested_date) + "-" + str(requested_month) + "-" + str(requested_year)
        )

        p = "%d-%m-%Y"
        requested_day_epoch_start = time.mktime(time.strptime(requested_dmy, p))
        # consider end date's time as 23:59:59
        requested_day_epoch_end = time.mktime(time.strptime(requested_dmy, p)) + 86399

        return requested_day_epoch_start, requested_day_epoch_end

    def convert_datetime_to_epoch(date_time_string):
        # Define the format of the input date and time string
        date_format = "%d-%m-%Y %H:%M:%S"

        # Parse the input string into a datetime object
        date_obj = datetime.strptime(date_time_string, date_format)

        # Convert the datetime object to epoch time
        epoch_time = time.mktime(date_obj.timetuple())

        return epoch_time


class HABD(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        """dashboard post api"""
        habd_results_arr = []
        habd_results_total = []
        totalAxleCount = 0
        totalWagonCount = 0
        totalSummary = []
        DETAIL_NAME = [
            "Hanging Part (side view)",
            "Hanging Part - Undercarriage",
            "Spring(s)",
            "Broken Spring(s)",
            "Axle box cover",
            "End cap screw(s)",
            "Yoke pin support plate bolts",
            "EM Pad",
            "Wagon Door",
        ]
        defect_code = ["003", "009", "004", "006", "007", "005", "008", "001", "002"]
        defect_mul_factor = [1, 1, 4, 4, 8, 8, 2, 8, 4]
        startDate = request.data.get("start")
        endDate = request.data.get("end")
        trainIdFormatStart = request.data.get("trainIdFormatStart")
        trainIdFormatEnd = request.data.get("trainIdFormatEnd")
        print("TRAIN ID FORMATTTTT:", trainIdFormatStart, trainIdFormatEnd)
        DateStart, DateEnd = views.Dashboard.convert_date_epoch(
            self, startDate, endDate
        )
        qry_str = train_mvis_defect_qry
        totalAxleCount = TrainConsolidatedInfo.objects.filter(
            entry_time__range=(DateStart, DateEnd)
        ).aggregate(
            Sum("total_axles")
        )  # .count()
        # totalWagonCount = LeftWagonInfo.objects.filter(ts__range=(DateStart, DateEnd)).count()
        totalWagonCount = (
            LeftWagonInfo.objects.filter(ts__range=(DateStart, DateEnd))
            .distinct("train_id")
            .distinct("wagon_id")
            .count()
        )

        # totalTrainsPassed = DefectInfo.objects.filter(train_id__startswith=trainIdFormat).distinct('train_id').count()
        mvis_total_count_qry_str = mvis_total_count_qry.format(
            trainIdFormatStart, trainIdFormatEnd
        )
        mvis_wagon_column_names, mvis_totalcount_result = (
            views.db_queries.exec_db_query(SELECT, mvis_total_count_qry_str)
        )
        totalTrainsPassed = (
            mvis_totalcount_result[0][0] if mvis_totalcount_result else 0
        )

        # totalTrainsPassed = DefectInfo.objects.filter(ts__range=(DateStart, DateEnd)).distinct('train_id').count()
        # totalDefectCount = DefectInfo.objects.filter(ts__range=(DateStart, DateEnd)).exclude(ts=None, defect_code='-').count()
        # totalDefectCount = DefectInfo.objects.filter(ts__range=(DateStart, DateEnd)).distinct('defect_image').exclude(defect_image='-', action_taken='-').count()
        # mvis_wagon_qry_str = mvis_wagon_cnt_qry.format(trainIdFormatStart, trainIdFormatEnd)
        # mvis_wagon_column_names, mvis_wagoncount_result = views.db_queries.exec_db_query(SELECT, mvis_wagon_qry_str)
        # totalWagonCount = mvis_wagoncount_result[0][0] if mvis_wagoncount_result else 0

        qry_temp = mvis_def_cnt_qry
        mvis_def_cnt_qry_str = qry_temp.format(
            trainIdFormatStart, trainIdFormatEnd, "%"
        )
        mvis_def_cnt_qry_column_names, totalDefectCount = (
            views.db_queries.exec_db_query(SELECT, mvis_def_cnt_qry_str)
        )

        habd_results_total.append(
            {
                "Name": "Total trains",
                "verified": 0,
                "detail": totalTrainsPassed,
                "feedback": "-",
                "true": "-",
                "false": "-",
                "percentageTrue": "-",
                "percentageFalse": "-",
            }
        )
        # habd_results_total.append({"Name":"Total axle passed", "verified": 0, "detail":totalAxleCount['total_axles__sum'],"feedback":"-", "true":"-","false":"-","percentageTrue":"-","percentageFalse":"-"})
        habd_results_arr.append(
            {
                "Name": "Summary",
                "verified": 0,
                "detail": totalDefectCount,
                "feedback": 0,
                "true": 0,
                "false": 0,
                "percentageTrue": 0,
                "percentageFalse": 0,
            }
        )
        for x in range(9):
            habd_info_qry_str_info_colums, habd_results = (
                views.db_queries.exec_db_query(
                    SELECT,
                    qry_temp.format(
                        trainIdFormatStart, trainIdFormatEnd, defect_code[x]
                    ),
                )
            )  # qry_str
            # habd_info_qry_str_info_colums,habd_trueFalse_result = views.db_queries.exec_db_query(
            # SELECT, mvis_feedback_count_qry.format(DateStart, DateEnd, defect_code[x]))
            # print('habd_trueFalse_result', habd_trueFalse_result)

            qry_True = mvis_true_cnt_qry
            mvis_true_cnt_qry_str = qry_True.format(
                trainIdFormatStart, trainIdFormatEnd, defect_code[x]
            )
            col_names_T, total_day_true = views.db_queries.exec_db_query(
                SELECT, mvis_true_cnt_qry_str
            )

            qry_False = mvis_false_cnt_qry
            mvis_false_cnt_qry_str = qry_False.format(
                trainIdFormatStart, trainIdFormatEnd, defect_code[x]
            )
            col_names_F, total_day_false = views.db_queries.exec_db_query(
                SELECT, mvis_false_cnt_qry_str
            )

            trueCount = 0
            falseCount = 0
            missedCount = 0
            defect_count = 0
            percentageTrue = 0
            percentageFalse = 0
            feedbackAvailable = 0
            verifiedCount = 0
            summaryVerifiedCount = 0

            verifiedCount = totalWagonCount * defect_mul_factor[x]

            # for count in (habd_trueFalse_result):
            #     trueCount = trueCount + count[2]
            #     falseCount = falseCount + count[3]
            #     feedbackAvailable = feedbackAvailable + count[1]

            trueCount = trueCount + total_day_true[0][0]
            falseCount = falseCount + total_day_false[0][0]
            feedbackAvailable = feedbackAvailable + trueCount + falseCount

            if habd_results is not None:
                for mvis_cnt in habd_results:
                    defect_count = defect_count + mvis_cnt[0]

            if defect_count == 0:
                percentageTrue = 0
                percentageFalse = 0
            else:
                percentageTrue = (trueCount * 100) / defect_count
                if verifiedCount != 0:
                    percentageFalse = (falseCount * 100) / (
                        verifiedCount - trueCount - 0
                    )
                else:
                    percentageFalse = 0

            resultObj = {
                "Name": DETAIL_NAME[x],
                "verified": verifiedCount,
                "detail": defect_count,
                "feedback": feedbackAvailable,
                "true": trueCount,
                "false": falseCount,
                "missedCount": missedCount,
                "percentageTrue": round(percentageTrue, 2),
                "percentageFalse": round(percentageFalse, 2),
            }
            habd_results_arr.append(resultObj)

            habdRes = {
                "habd_results_arr": habd_results_arr,
                "habd_results_total": habd_results_total,
            }

        return Response(habdRes)


# class HABDDETECTION(APIView):
#     permission_classes = (IsAuthenticated,)
#     def post(self, request, *args, **kwargs):
#         '''dashboard post api'''
#         habd_results_arr = []
#         habd_results_total = []
#         totalAxleCount = 0
#         totalWagonCount = 0
#         totalSummary = []
#         DETAIL_NAME = ['Hanging Part (side view)','Hanging Part - Undercarriage','Spring(s)','Broken Spring(s)','Axle box cover','End cap screw(s)','Yoke pin support plate bolts','EM Pad','Wagon Door']
#         defect_code = ['003', '009', '004', '006', '007', '005', '008', '001', '002']
#         defect_mul_factor = [1, 1, 4, 4, 8, 8, 2, 8, 4]
#         startDate = request.data.get('start')
#         endDate = request.data.get('end')
#         trainIdFormatStart = request.data.get('trainIdFormatStart')
#         trainIdFormatEnd = request.data.get('trainIdFormatEnd')
#         print("TRAIN ID FORMATTTTT:",trainIdFormatStart,trainIdFormatEnd)
#         DateStart, DateEnd = views.Dashboard.convert_date_epoch(self,startDate, endDate)
#         qry_str = train_mvis_defect_qry
#         totalAxleCount = TrainConsolidatedInfo.objects.filter(entry_time__range=(DateStart, DateEnd)).aggregate(Sum('total_axles')) #.count()
#         totalWagonCount = LeftWagonInfo.objects.filter(ts__range=(DateStart, DateEnd)).count()
#         # totalTrainsPassed = DefectInfo.objects.filter(train_id__startswith=trainIdFormat).distinct('train_id').count()
#         mvis_total_count_qry_str = mvis_total_count_qry.format(trainIdFormatStart, trainIdFormatEnd)
#         mvis_wagon_column_names, mvis_totalcount_result = views.db_queries.exec_db_query(SELECT, mvis_total_count_qry_str)
#         totalTrainsPassed = mvis_totalcount_result[0][0] if mvis_totalcount_result else 0

#         # totalTrainsPassed = DefectInfo.objects.filter(ts__range=(DateStart, DateEnd)).distinct('train_id').count()
#         #totalDefectCount = DefectInfo.objects.filter(ts__range=(DateStart, DateEnd)).exclude(ts=None, defect_code='-').count()
#         # totalDefectCount = DefectInfo.objects.filter(ts__range=(DateStart, DateEnd)).distinct('defect_image').exclude(defect_image='-', action_taken='-').count()
#         # mvis_wagon_qry_str = mvis_wagon_cnt_qry.format(DateStart, DateEnd)
#         # mvis_wagon_column_names, mvis_wagoncount_result = views.db_queries.exec_db_query(SELECT, mvis_wagon_qry_str)
#         # totalWagonCount = mvis_wagoncount_result[0][0] if mvis_wagoncount_result else 0

#         print("TOTAL TRAIN COUNT:", totalTrainsPassed)

#         qry_temp = mvis_def_cnt_qry_mgr
#         mvis_def_cnt_qry_str = qry_temp.format(trainIdFormatStart, trainIdFormatEnd, '%')
#         mvis_def_cnt_qry_column_names, totalDefectCount = views.db_queries.exec_db_query(
#             SELECT, mvis_def_cnt_qry_str)
#         print('totalDefectCount', totalDefectCount)

#         habd_results_total.append({"Name":"Total trains", "verified": 0, "detail":totalTrainsPassed, "feedback":"-", "true":"-","false":"-","percentageTrue":"-","percentageFalse":"-"})
#         # habd_results_total.append({"Name":"Total axle passed", "verified": 0, "detail":totalAxleCount['total_axles__sum'],"feedback":"-", "true":"-","false":"-","percentageTrue":"-","percentageFalse":"-"})
#         habd_results_arr.append({"Name":"Summary", "verified": 0, "detail":totalDefectCount ,"feedback":0, "true":0,"false":0,"percentageTrue":0,"percentageFalse":0})
#         for x in range(9):
#             habd_info_qry_str_info_colums,habd_results = views.db_queries.exec_db_query(
#             SELECT, qry_temp.format(trainIdFormatStart, trainIdFormatEnd, defect_code[x]))     #qry_str
#             # habd_info_qry_str_info_colums,habd_trueFalse_result = views.db_queries.exec_db_query(
#             # SELECT, mvis_feedback_count_qry.format(DateStart, DateEnd, defect_code[x]))
#             # print('habd_trueFalse_result', habd_trueFalse_result)

#             qry_True = mvis_true_cnt_qry_mgr
#             mvis_true_cnt_qry_str = qry_True.format(trainIdFormatStart, trainIdFormatEnd, defect_code[x])
#             col_names_T, total_day_true = views.db_queries.exec_db_query(
#                 SELECT, mvis_true_cnt_qry_str)
#             print('total_day_true', total_day_true, total_day_true[0][0])

#             qry_False = mvis_false_cnt_qry_mgr
#             mvis_false_cnt_qry_str = qry_False.format(trainIdFormatStart, trainIdFormatEnd, defect_code[x])
#             col_names_F, total_day_false = views.db_queries.exec_db_query(
#                 SELECT, mvis_false_cnt_qry_str)
#             print('total_day_true', total_day_false, total_day_false[0])

#             trueCount = 0
#             falseCount = 0
#             missedCount = 0
#             defect_count = 0
#             percentageTrue = 0
#             percentageFalse = 0
#             feedbackAvailable = 0
#             verifiedCount = 0
#             summaryVerifiedCount = 0

#             verifiedCount = totalWagonCount * defect_mul_factor[x]

#             # for count in (habd_trueFalse_result):
#             #     trueCount = trueCount + count[2]
#             #     falseCount = falseCount + count[3]
#             #     feedbackAvailable = feedbackAvailable + count[1]

#             trueCount = trueCount + total_day_true[0][0]
#             falseCount = falseCount + total_day_false[0][0]
#             feedbackAvailable = feedbackAvailable + trueCount + falseCount

#             if habd_results is not None:
#                 for mvis_cnt in habd_results:
#                     defect_count = defect_count + mvis_cnt[0]

#             if(defect_count == 0):
#                 percentageTrue = 0
#                 percentageFalse= 0
#             else:
#                 percentageTrue = (trueCount*100)/defect_count
#                 if(verifiedCount != 0):
#                     percentageFalse = (falseCount*100)/(verifiedCount - trueCount - 0)
#                 else:
#                     percentageFalse = 0

#             print('defect_count', defect_count)

#             resultObj = {"Name":DETAIL_NAME[x], "verified": verifiedCount, "detail":defect_count, "feedback":feedbackAvailable, "true":trueCount,"false":falseCount, "missedCount": missedCount, "percentageTrue":round(percentageTrue,2),"percentageFalse":round(percentageFalse,2)}
#             habd_results_arr.append(resultObj)

#             habdRes = {
#                 'habd_results_arr': habd_results_arr,
#                 'habd_results_total': habd_results_total
#             }

#         return Response(habdRes)


class HABDManager(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        """dashboard post api"""

        startDate = request.data.get("start1")
        date_obj1 = datetime.strptime(startDate, "%d-%m-%Y")
        yyyymm_start_string = date_obj1.strftime("%Y%m")

        endDate = request.data.get("end1")
        date_obj2 = datetime.strptime(endDate, "%d-%m-%Y")
        next_month_date = date_obj2 + timedelta(days=1)
        year = next_month_date.year
        month = next_month_date.month
        yyyymm_end_string = f"{year}{month:02d}"

        DateStart, DateEnd = views.Dashboard.convert_date_epoch(
            self, startDate, endDate
        )
        qry_temp = mvis_mgr_daterange_qry
        mvis_def_dr_qry_str = qry_temp.format(yyyymm_start_string, yyyymm_end_string)
        mvis_def_cnt_qry_column_names, monthDefectCount = (
            views.db_queries.exec_db_query(SELECT, mvis_def_dr_qry_str)
        )

        for x in range(9):

            habdMgrRes = {
                "monthDefectCount": monthDefectCount,
            }

        return Response(habdMgrRes)


class HABDManager2(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        """dashboard post api"""

        startDate = request.data.get("start1")
        endDate = request.data.get("end1")
        date_obj1 = datetime.strptime(startDate, "%d-%m-%Y")
        yyyymm_start_string = date_obj1.strftime("%Y%m")
        date_obj2 = datetime.strptime(endDate, "%d-%m-%Y")
        next_month_date = date_obj2 + timedelta(days=1)
        year = next_month_date.year
        month = next_month_date.month
        yyyymm_end_string = f"{year}{month:02d}"
        # DateStart, DateEnd = views.Dashboard.convert_date_epoch(self,startDate, endDate)
        defect_code = ["003", "009", "004", "006", "007", "005", "008", "001", "002"]

        graphs_values_by_defect_code = {}

        for x in range(9):
            mvis_mgr_graphs_daterange_qry_str = mvis_mgr_graphs_daterange_qry.format(
                yyyymm_start_string,
                yyyymm_start_string,
                yyyymm_end_string,
                defect_code[x],
                defect_code[x],
                yyyymm_start_string,
                yyyymm_end_string,
                defect_code[x],
            )
            col_names, graphsValues = views.db_queries.exec_db_query(
                SELECT, mvis_mgr_graphs_daterange_qry_str
            )

            # Store graphsValues in the dictionary with the corresponding defect_code as the key
            graphs_values_by_defect_code[defect_code[x]] = graphsValues

        # Now you can access the graphsValues for each defect_code separately
        for defect, values in graphs_values_by_defect_code.items():
            pass  # Each defect has been processed

        def_1 = graphs_values_by_defect_code["003"]
        def_2 = graphs_values_by_defect_code["009"]
        def_3 = graphs_values_by_defect_code["004"]
        def_4 = graphs_values_by_defect_code["006"]
        def_5 = graphs_values_by_defect_code["007"]
        def_6 = graphs_values_by_defect_code["005"]
        def_7 = graphs_values_by_defect_code["008"]
        def_8 = graphs_values_by_defect_code["001"]
        def_9 = graphs_values_by_defect_code["002"]

        habdMgrRes2 = {
            "def_1": def_1,
            "def_2": def_2,
            "def_3": def_3,
            "def_4": def_4,
            "def_5": def_5,
            "def_6": def_6,
            "def_7": def_7,
            "def_8": def_8,
            "def_9": def_9,
        }

        return Response(habdMgrRes2)


class trueCountDetails(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        if request.data.get("start"):
            start_date = request.data.get("start")
            end_date = request.data.get("end")
            def_code1 = request.data.get("defCode1")
            def_code2 = request.data.get("defCode2")

            DateStart, DateEnd = views.Dashboard.convert_date_epoch(
                self, start_date, end_date
            )

            mvis_truecount_qry_str = mvis_truecount_qry.format(
                DateStart, DateEnd, def_code1, def_code2
            )
            mvis_truecount_column_names, mvis_truecount_result = (
                views.db_queries.exec_db_query(SELECT, mvis_truecount_qry_str)
            )

            trainTrueCount = {
                "mvis_truecount_result": mvis_truecount_result,
            }

            return Response(trainTrueCount)


class falseCountDetails(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        if request.data.get("start"):
            start_date = request.data.get("start")
            end_date = request.data.get("end")
            def_code1 = request.data.get("defCode1")
            def_code2 = request.data.get("defCode2")

            DateStart, DateEnd = views.Dashboard.convert_date_epoch(
                self, start_date, end_date
            )

            mvis_falsecount_qry_str = mvis_falsecount_qry.format(
                DateStart, DateEnd, def_code1, def_code2
            )
            mvis_truecount_column_names, mvis_falsecount_result = (
                views.db_queries.exec_db_query(SELECT, mvis_falsecount_qry_str)
            )

            trainFalseCount = {
                "mvis_falsecount_result": mvis_falsecount_result,
            }

            return Response(trainFalseCount)


class upload_photo(APIView):
    def post(self, request, format=None):
        photo_file = request.FILES.get("photo")
        if photo_file:
            # Save the file to the 'media/images' directory using Django's default storage backend
            saved_file_name = default_storage.save(
                settings.MEDIA_ROOT + "/images/" + photo_file.name,
                ContentFile(photo_file.read()),
            )
            return Response(
                {"message": "Photo uploaded successfully", "file_name": saved_file_name}
            )
        else:
            return Response({"message": "No photo uploaded"}, status=400)
