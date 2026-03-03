from django.http import JsonResponse
from django.db import connection
from django.views.decorators.http import require_http_methods
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from datetime import datetime, timedelta
import json
import logging
from defects.validators import get_dpu_id_from_request, get_valid_defect_codes_for_dpu

logger = logging.getLogger(__name__)


@api_view(["GET"])
def summary_report(request):
    """
    Generate summary report for defects within a date range.

    Query Parameters:
    - start_date: Start date in DD-MM-YYYY format (inclusive)
    - end_date: End date in DD-MM-YYYY format (inclusive)
    - is_active: Filter defect_types by is_active status (default: true)
    - is_deleted: Filter by is_deleted status (default: false)
    - generated_by: Filter by generated_by field (default: both 'manual' and 'system')

    Returns:
    - JSON response with summary statistics and defect breakdown
    """
    start_date = request.GET.get("start_date")
    end_date = request.GET.get("end_date")

    # Get filter parameters with defaults
    is_active_param = request.GET.get("is_active", "true").lower()
    is_deleted_param = request.GET.get("is_deleted", "false").lower()
    generated_by_param = request.GET.get("generated_by", "").lower()

    # Get optional dpu_id filter
    try:
        dpu_id = get_dpu_id_from_request(request, required=False)
    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    # Validate required parameters
    if not start_date or not end_date:
        return Response(
            {"error": "start_date and end_date parameters are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        # Validate and parse date format (dd-mm-yyyy)
        start_date_obj = datetime.strptime(start_date, "%d-%m-%Y")
        end_date_obj = datetime.strptime(end_date, "%d-%m-%Y")
    except ValueError:
        return Response(
            {"error": "Invalid date format. Use DD-MM-YYYY"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Convert dates to train_id format
    start_train_id = f"T{start_date_obj.strftime('%Y%m%d')}000000"
    end_train_id = f"T{end_date_obj.strftime('%Y%m%d')}235959"

    # Build WHERE clause for dpu_id filtering
    dpu_id_condition_defects = ""
    dpu_id_condition_trains = ""
    dpu_id_condition_wagons = ""
    dpu_id_condition_types = ""  # Filter defect_types by defect_locations mapping
    if dpu_id:
        # Filter unique_defects by dpu_id column
        dpu_id_condition_defects = f"AND ud.dpu_id = '{dpu_id}'"
        # Filter train_count by dpu_id
        dpu_id_condition_trains = f"AND dpu_id = '{dpu_id}'"
        # Filter wagon_count by dpu_id (via mvis_processed_info)
        dpu_id_condition_wagons = f"AND mpi.dpu_id = '{dpu_id}'"
        # Filter defect_types to only show defect codes mapped to this location
        dpu_id_condition_types = f"AND dt.defect_code IN (SELECT defect_code FROM defect_locations WHERE dpu_id = '{dpu_id}')"

    # Build WHERE clause for is_active filtering
    is_active_condition = ""
    if is_active_param in ["true", "1", "yes"]:
        is_active_condition = "AND dt.is_active = TRUE"
    elif is_active_param in ["false", "0", "no"]:
        is_active_condition = "AND dt.is_active = FALSE"
    # If 'both' or not specified, no condition is added (show all records)

    # Build WHERE clause for is_deleted filtering
    is_deleted_condition = ""
    if is_deleted_param in ["false", "0", "no"]:
        is_deleted_condition = "AND ud.is_deleted = FALSE"
    elif is_deleted_param in ["true", "1", "yes"]:
        is_deleted_condition = "AND ud.is_deleted = TRUE"
    # If 'both' or not specified, no condition is added (show all records)

    # Build WHERE clause for generated_by filtering
    generated_by_condition = ""
    if generated_by_param == "manual":
        generated_by_condition = "AND ud.generated_by = 'manual'"
    elif generated_by_param == "system":
        generated_by_condition = "AND ud.generated_by = 'system'"
    # If not specified, show both (no additional condition)

    # Raw SQL query for summary report
    query = f"""
    WITH defect_stats AS (
    SELECT
        dt.defect_code as defect_code,
        dt.name as defect_name,
        dt.multiplier_factor,
        dt.is_active as is_active,
        dt.display_order as display_order,
        dc.category_code as category_code,
        dc.name as category_name,
        COUNT(ud.defect_image) as defect_count,
        SUM(CASE WHEN ud.action_taken = 'TRUE-CRITICAL' AND ud.field_report = 'TRUE-CRITICAL' THEN 1 ELSE 0 END) as true_critical_alerts,
        SUM(CASE WHEN ud.action_taken = 'TRUE-MAINTENANCE' AND ud.field_report = 'TRUE-MAINTENANCE' THEN 1 ELSE 0 END) as true_maintenance_alerts,
        SUM(CASE WHEN ud.action_taken = 'FALSE' AND ud.field_report = 'FALSE' THEN 1 ELSE 0 END) as false_alerts,
        SUM(CASE WHEN ud.action_taken = 'NON-STD ALERTS' AND ud.field_report = 'NON-STD ALERTS' THEN 1 ELSE 0 END) as non_std_alerts,
        SUM(CASE WHEN (
            ud.action_taken IS NOT NULL AND 
            ud.field_report IS NOT NULL AND 
            ud.action_taken != '-' AND 
            ud.field_report != '-') THEN 1 ELSE 0 END) as total_acknowledged, 
        SUM(CASE WHEN (ud.defect_image IS NOT NULL AND (
                COALESCE(ud.action_taken, '-') = '-' OR 
                COALESCE(ud.field_report, '-') = '-')) THEN 1 ELSE 0 END) as total_pending,
        SUM(CASE WHEN (
                ud.action_taken IS NOT NULL AND 
                ud.field_report IS NOT NULL AND
                ud.action_taken !='-' AND 
                ud.field_report !='-' AND 
                ud.action_taken != ud.field_report) THEN 1 ELSE 0 END) as feedback_mismatched
    FROM defect_types dt
    LEFT JOIN defect_categories dc ON dt.category_code = dc.category_code 
    LEFT JOIN unique_defects ud ON dt.defect_code = ud.defect_code
        AND ud.train_id >= %s
        AND ud.train_id <= %s
        {is_deleted_condition}
        {generated_by_condition}
        {dpu_id_condition_defects}
    WHERE 1=1
    {is_active_condition}
    {dpu_id_condition_types}
    GROUP BY dt.defect_code, dt.name, dt.multiplier_factor, dt.is_active, dt.display_order, dc.category_code, dc.name
),
wagon_count AS (
    SELECT COUNT(DISTINCT (mlwi.train_id, mlwi.tagged_wagon_id)) AS total_wagons
    FROM mvis_left_wagon_info mlwi
    WHERE mlwi.tagged_wagon_id != '-'
    AND mlwi.train_id >= %s
    AND mlwi.train_id <= %s
    AND EXISTS (
        SELECT 1 FROM mvis_processed_info mpi 
        WHERE mpi.train_id = mlwi.train_id
        {dpu_id_condition_wagons}
    )
),    
train_count AS (
    SELECT COUNT(DISTINCT train_id) AS total_trains
    FROM mvis_processed_info
    WHERE train_id >= %s
    AND train_id <= %s
    {dpu_id_condition_trains}
)
SELECT
    json_build_object(
        'summary', json_build_object(
            'total_trains', (SELECT total_trains FROM train_count),
            'total_wagons', (SELECT total_wagons FROM wagon_count),
            'total_defects', (SELECT SUM(defect_count) FROM defect_stats),
            'total_true_critical_alerts', (SELECT SUM(true_critical_alerts) FROM defect_stats),
            'total_true_maintenance_alerts', (SELECT SUM(true_maintenance_alerts) FROM defect_stats),
            'total_false_alerts', (SELECT SUM(false_alerts) FROM defect_stats),
            'total_non_std_alerts', (SELECT SUM(non_std_alerts) FROM defect_stats),
            'total_acknowledged_alerts', (SELECT SUM(total_acknowledged) FROM defect_stats), 
            'total_pending_alerts', (SELECT SUM(total_pending) FROM defect_stats),
            'total_feedback_mismatched',(SELECT SUM(feedback_mismatched) FROM defect_stats)
        ),
        'defect_breakdown', json_agg(
            json_build_object(
                'defect_code', defect_code,
                'defect_name', defect_name,
                'multiplier_factor', multiplier_factor,
                'category_code', category_code,
                'category_name', category_name,
                'defect_count', defect_count,
                'true_critical_alerts', true_critical_alerts,
                'true_maintenance_alerts', true_maintenance_alerts,
                'false_alerts', false_alerts,
                'non_std_alerts', non_std_alerts,
                'total_acknowledged', total_acknowledged,
                'total_pending', total_pending,
                'feedback_mismatched', feedback_mismatched,
                'total_units', ROUND((SELECT total_wagons FROM wagon_count) * multiplier_factor, 2),
                'is_active', is_active,
                'display_order', display_order
            )
        )
    ) as api_response
FROM defect_stats;
    """

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                query,
                [
                    start_train_id,
                    end_train_id,  # For defect_stats
                    start_train_id,
                    end_train_id,  # For wagon_count
                    start_train_id,
                    end_train_id,  # For train_count
                ],
            )
            result = cursor.fetchone()

            if result and result[0]:
                # Add start_date and end_date in dd-mm-yyyy format to the response
                response_data = result[0]
                response_data["start_date"] = start_date
                response_data["end_date"] = end_date
                return Response(response_data, status=status.HTTP_200_OK)
            else:
                # Return empty structure if no data found
                return Response(
                    {
                        "summary": {
                            "total_trains": 0,
                            "total_wagons": 0,
                            "total_defects": 0,
                            "total_true_critical_alerts": 0,
                            "total_true_maintenance_alerts": 0,
                            "total_false_alerts": 0,
                            "total_non_std_alerts": 0,
                            "total_acknowledged_alerts": 0,
                            "total_pending_alerts": 0,
                            "total_feedback_mismatched": 0,
                        },
                        "defect_breakdown": [],
                        "start_date": start_date,
                        "end_date": end_date,
                    },
                    status=status.HTTP_200_OK,
                )

    except Exception as e:
        # NOTE: This block will now catch the PostgreSQL syntax error.
        # The 'Database error' message in the HTTP 500 response will contain the specific SQL error.
        logger.error(f"Error in summary_report: {e}")
        return Response(
            {"error": f"Database error: {str(e)}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# consolidated_report function remains unchanged as the error was in summary_report
@api_view(["GET"])
def consolidated_report(request):
    """
    Generate summary report for defects within a date range.

    Query Parameters:
    - start_date: Start date in DD-MM-YYYY or YYYY-MM-DD format (inclusive)
    - defect_code: Filter by specific defect code
    - category_code: Filter by category code (groups multiple defect codes)

    Returns:
    - JSON response with summary statistics and defect breakdown
    """
    start_date = request.GET.get("start_date")
    raw_defect_code = request.GET.get("defect_code")
    raw_category_code = request.GET.get("category_code")

    # Get optional dpu_id filter
    try:
        dpu_id = get_dpu_id_from_request(request, required=False)
    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    # Get valid defect codes for dpu_id filtering
    valid_dpu_defect_codes = None
    if dpu_id:
        valid_dpu_defect_codes = get_valid_defect_codes_for_dpu(dpu_id)
        if not valid_dpu_defect_codes:
            # No valid defect codes for this dpu_id - return empty result
            return Response(
                {
                    "status": "success",
                    "data": [],
                    "total_records": 0,
                    "start_date": start_date,
                    "message": "No defects configured for this dpu_id",
                },
                status=status.HTTP_200_OK,
            )

    # Determine if user wants ALL trains or only trains matching a specific filter
    # show_all_trains = True  → No defect/category filter, show every train for the date
    # show_all_trains = False → Specific defect or category selected, show only matching trains
    show_all_trains = False

    # Handle category_code with priority over defect_code
    if raw_category_code and raw_category_code not in ["", "All", "all"]:
        # Category filter: get all defect codes for this category
        from defects.models import DefectType

        category_defects = list(
            DefectType.objects.filter(
                category_code=raw_category_code, is_active=True
            ).values_list("defect_code", flat=True)
        )

        # Filter by dpu_id if provided
        if valid_dpu_defect_codes is not None:
            category_defects = [code for code in category_defects if code in valid_dpu_defect_codes]

        if category_defects:
            codes_list = ",".join([f"'{code}'" for code in category_defects])
            defect_code = f"({codes_list})"
            use_in_clause = True
        else:
            defect_code = "%"
            use_in_clause = False
            show_all_trains = True

    elif raw_defect_code is None or raw_defect_code in ["", "All", "all"]:
        # No specific defect filter - show ALL trains
        show_all_trains = True
        if valid_dpu_defect_codes is not None:
            codes_list = ",".join([f"'{code}'" for code in valid_dpu_defect_codes])
            defect_code = f"({codes_list})"
            use_in_clause = True
        else:
            defect_code = "%"
            use_in_clause = False
    else:
        # Specific defect_code selected - show only trains with this defect
        if valid_dpu_defect_codes is not None and raw_defect_code not in valid_dpu_defect_codes:
            return Response(
                {"error": f"Defect code '{raw_defect_code}' is not valid for dpu_id '{dpu_id}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        defect_code = raw_defect_code
        use_in_clause = False

    # Validate required parameters
    if not start_date:
        return Response(
            {"error": "start_date parameters are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Accept both DD-MM-YYYY and YYYY-MM-DD
    parsed_date = None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y"):
        try:
            parsed_date = datetime.strptime(start_date, fmt)
            break
        except ValueError:
            continue
    if not parsed_date:
        return Response(
            {"error": "Invalid date format. Use DD-MM-YYYY or YYYY-MM-DD"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Use YYYY-MM-DD for further processing
    start_date_str = parsed_date.strftime("%Y-%m-%d")

    start_train_id = f"T{start_date_str.replace('-', '')}000000"
    end_train_id = f"T{start_date_str.replace('-', '')}235959"

    # Build dpu_id condition for filtering
    dpu_id_condition = ""
    if dpu_id:
        dpu_id_condition = f"AND dpu_id = '{dpu_id}'"

    # Build WHERE clauses based on filter type
    if show_all_trains:
        # No defect/category filter: include ALL trains in the date range
        where_clause_train = f"is_deleted = false {dpu_id_condition}"
    elif use_in_clause:
        # Category filter: only trains that have defects in the selected category
        where_clause_train = f"is_deleted = false {dpu_id_condition} AND train_id IN (SELECT DISTINCT train_id FROM mvis_processed_info WHERE defect_code IN {defect_code} AND defect_code != '-' AND defect_code IS NOT NULL AND is_deleted = false {dpu_id_condition})"
    else:
        # Specific defect_code filter: only trains that have this specific defect
        where_clause_train = f"is_deleted = false {dpu_id_condition} AND train_id IN (SELECT DISTINCT train_id FROM mvis_processed_info WHERE defect_code = %s AND defect_code != '-' AND defect_code IS NOT NULL AND is_deleted = false {dpu_id_condition})"

    if use_in_clause:
        # For category/dpu filter: use IN clause for defect matching
        where_clause_defect = f"mpi.defect_code IN {defect_code}"
    else:
        # For single defect or no filter: use LIKE logic for defect matching
        where_clause_defect = f"(%s = '%%' OR mpi.defect_code = %s)"

    # Raw SQL query for consolidated report with alerts, pending alerts and defects
    query = f"""
        WITH train_alerts AS (
            -- Alert count for each train using unique defect logic
            SELECT 
                a.train_id,
                a.dfis_train_id,
                b.train_speed,
                a.alert_count
            FROM (
                SELECT 
                    dt.train_id,
                    dt.dfis_train_id, 
                    COUNT(ac.defect_code) as alert_count
                FROM (
                    SELECT DISTINCT train_id, dfis_train_id
                    FROM mvis_processed_info
                    WHERE train_id >= %s AND train_id <= %s
                        AND is_deleted = false
                        AND {where_clause_train}
                ) dt
                LEFT OUTER JOIN (
                SELECT DISTINCT 
                    mpi.train_id, 
                    mpi.defect_code, 
                    mpi.defect_image, 
                    mpi.side, 
                    mpi.tagged_wagon_id, 
                    mpi.tagged_bogie_id
                FROM mvis_processed_info mpi
                INNER JOIN defect_types dt_inner ON mpi.defect_code = dt_inner.defect_code
                WHERE mpi.defect_code != '-' 
                    AND mpi.defect_code IS NOT NULL
                    AND {where_clause_defect}
                    AND mpi.is_deleted = false
                    AND dt_inner.is_active = true
                    {dpu_id_condition.replace('dpu_id', 'mpi.dpu_id')}
                ) ac ON dt.train_id = ac.train_id
                GROUP BY dt.train_id, dt.dfis_train_id
            ) a
            JOIN (
                SELECT DISTINCT train_id, AVG(mvis_train_speed) as train_speed
                FROM mvis_processed_info
                WHERE train_id >= %s AND train_id <= %s
                    {dpu_id_condition}
                GROUP BY train_id
            ) b ON a.train_id = b.train_id
        ),
        train_defects AS (
            -- Get all defects for each train
            SELECT 
                train_id,
                json_agg(
                    json_build_object(
                        'defect_code', defect_code,
                        'defect_image', defect_image,
                        'action_taken', action_taken,
                        'remarks', remarks
                    )
                ) as defects
            FROM (
                SELECT DISTINCT 
                    train_id, 
                    defect_code, 
                    defect_image,
                    action_taken, 
                    remarks
                FROM mvis_processed_info
                WHERE defect_code != '-'
                    AND train_id >= %s
                    AND train_id <= %s
                    AND is_deleted = false
                    {dpu_id_condition}
                    AND {where_clause_defect.replace('mpi.', '')}
                ORDER BY train_id, defect_code
            ) t
            GROUP BY train_id
        ),
        train_pending AS (
            -- Pending alerts for each train
            SELECT 
                mpi.train_id, 
                COUNT(DISTINCT (mpi.defect_code, mpi.defect_image, mpi.action_taken)) as pending_count
            FROM mvis_processed_info mpi
            INNER JOIN defect_types dt_pd ON mpi.defect_code = dt_pd.defect_code
            WHERE mpi.train_id >= %s
                AND mpi.train_id <= %s
                AND mpi.defect_code != '-'
                AND {where_clause_defect}
                AND (
                    COALESCE(mpi.action_taken, '-') = '-' OR
                    COALESCE(mpi.field_report, '-') = '-'
                    )
                AND mpi.is_deleted = false
                AND dt_pd.is_active = true
                {dpu_id_condition.replace('dpu_id', 'mpi.dpu_id')}
            GROUP BY mpi.train_id
        )
        SELECT json_agg(
            json_build_object(
                'train_id', ta.train_id,
                'dfis_train_id', ta.dfis_train_id,
                'direction', 'UP',
                'train_speed', ta.train_speed,
                'alert_count', ta.alert_count,
                'pending_alerts', COALESCE(tp.pending_count, 0),
                'defects', COALESCE(td.defects, '[]'::json)
            ) ORDER BY ta.train_id
        )
        FROM train_alerts ta
        LEFT JOIN train_defects td ON ta.train_id = td.train_id
        LEFT JOIN train_pending tp ON ta.train_id = tp.train_id;
    """

    try:
        with connection.cursor() as cursor:
            # Build parameters based on filter type
            if use_in_clause:
                # Category/dpu IN clause: all defect codes are hardcoded in the query, no %s for them
                params = [
                    start_train_id,
                    end_train_id,
                    start_train_id,
                    end_train_id,
                    start_train_id,
                    end_train_id,
                    start_train_id,
                    end_train_id,
                ]
            elif show_all_trains:
                # No defect filter, all trains: where_clause_train has no %s,
                # but where_clause_defect has 2x %s per usage (3 usages)
                params = [
                    start_train_id,
                    end_train_id,
                    # where_clause_defect in train_alerts LEFT JOIN
                    defect_code,
                    defect_code,
                    start_train_id,
                    end_train_id,
                    # train_defects CTE
                    start_train_id,
                    end_train_id,
                    defect_code,
                    defect_code,
                    # train_pending CTE
                    start_train_id,
                    end_train_id,
                    defect_code,
                    defect_code,
                ]
            else:
                # Specific defect_code: where_clause_train has 1x %s,
                # where_clause_defect has 2x %s per usage (3 usages)
                params = [
                    start_train_id,
                    end_train_id,
                    # where_clause_train subquery defect_code
                    defect_code,
                    # where_clause_defect in train_alerts LEFT JOIN
                    defect_code,
                    defect_code,
                    start_train_id,
                    end_train_id,
                    # train_defects CTE
                    start_train_id,
                    end_train_id,
                    defect_code,
                    defect_code,
                    # train_pending CTE
                    start_train_id,
                    end_train_id,
                    defect_code,
                    defect_code,
                ]

            cursor.execute(query, params)
            result = cursor.fetchone()

            if result and result[0]:
                return Response(
                    {
                        "status": "success",
                        "data": result[0],
                        "total_records": len(result[0]) if result[0] else 0,
                        "start_date": start_date,
                    },
                    status=status.HTTP_200_OK,
                )
            else:
                return Response(
                    {
                        "status": "success",
                        "data": [],
                        "total_records": 0,
                        "start_date": start_date,
                        "message": "No data found for the specified criteria",
                    },
                    status=status.HTTP_200_OK,
                )

    except Exception as e:
        import traceback

        logger.error(f"Database error: {traceback.format_exc()}")
        return Response(
            {"error": f"Database error: {str(e)}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
