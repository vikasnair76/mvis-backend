import re
import traceback
import logging
import pytz  # for timezone conversion
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from defects.models import DefectInfo as MvisProcessedInfo
from cbs.models import LeftWagonInfo as MvisLeftWagonInfo
from defects.models import DefectType, UniqueDefect
from defects.validators import get_dpu_id_from_request
from django.db.models import OuterRef, Subquery, F
from django.http import StreamingHttpResponse
import redis
import os
import json


logger = logging.getLogger(__name__)


def train_event_stream(request):
    """
    Server-Sent Events endpoint for train updates.
    Connects to Redis and listens on the 'train-events' channel.
    Supports optional location_id query parameter for location-specific events.
    """

    def event_stream():
        redis_client = None
        pubsub = None
        try:
            # Get optional location_id for location-specific channel
            location_id = request.GET.get("location_id")
            channel = f"train-events:{location_id}" if location_id else "train-events"

            redis_client = redis.Redis(
                host=os.getenv("REDIS_HOST"),
                port=int(os.getenv("REDIS_PORT")),
                db=int(os.getenv("REDIS_DB")),
                password=os.getenv("REDIS_PASSWORD"),
                decode_responses=True,
                socket_timeout=10,
                socket_connect_timeout=5,
            )
            pubsub = redis_client.pubsub()
            pubsub.subscribe(channel)
            yield f": connected to {channel} SSE endpoint\n\n".encode("utf-8")
            import time
            from datetime import datetime

            try:
                while True:
                    message = pubsub.get_message(timeout=None)
                    if message is None:
                        continue  # No message, continue polling

                    if message["type"] == "message":
                        try:
                            event_data = json.loads(message["data"])
                            event_type = event_data.get("event_type", "message")

                            # Always send a unique event_id for every event
                            event_id = event_data.get("event_id")
                            if event_id is None:
                                event_id = int(time.time() * 1000)

                            # Add timestamp (ISO format, like defects SSE)
                            timestamp = event_data.get("timestamp")
                            if not timestamp:
                                timestamp = datetime.utcnow().isoformat()

                            # Use payload if present, else send the whole event_data as data
                            payload_data = event_data.get("payload", {})
                            full_data = {
                                **payload_data,
                                "event_id": event_id,
                                "timestamp": timestamp,
                            }
                            yield f"id: {event_id}\n".encode("utf-8")
                            yield f"event: {event_type}\n".encode("utf-8")
                            yield f"data: {json.dumps(full_data)}\n\n".encode("utf-8")

                        except (json.JSONDecodeError, KeyError):
                            continue

            except redis.RedisError as e:
                yield f'event: error\ndata: {{"error": "Redis error: {str(e)}"}}\n\n'.encode(
                    "utf-8"
                )
            except Exception as e:
                yield f'event: error\ndata: {{"error": "Connection error: {str(e)}"}}\n\n'.encode(
                    "utf-8"
                )
            finally:
                # Ensure the pubsub connection is closed
                if pubsub:
                    try:
                        pubsub.close()
                    except Exception:
                        pass  # Ignore errors on close

        except Exception as e:
            yield f'event: error\ndata: {{"error": "Connection error: {str(e)}"}}\n\n'.encode(
                "utf-8"
            )

    response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["Connection"] = "keep-alive"
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Headers"] = "Cache-Control"
    return response


class TrainDetailView(APIView):
    """
    API endpoint to get detailed train info by train_id using Django ORM

    Query parameters:
    - is_active (true/false): Filter by defect type active status
    - generated_by (system/manual): Filter by generation method
    - is_deleted (true/false): Filter by deletion status
    """

    permission_classes = [AllowAny]

    def get(self, request, train_id, *args, **kwargs):
        try:
            # Get query parameters
            is_active = request.query_params.get("is_active")
            generated_by = request.query_params.get("generated_by")
            is_deleted = request.query_params.get("is_deleted")

            # Get optional dpu_id filter
            dpu_id = get_dpu_id_from_request(request, required=False)

            # Query 1: Train basic information - apply is_deleted filter
            train_query = MvisProcessedInfo.objects.filter(train_id=train_id)

            # Filter by dpu_id if provided
            if dpu_id:
                train_query = train_query.filter(dpu_id=dpu_id)

            # Filter by is_deleted if specified
            if is_deleted is not None:
                if is_deleted.lower() == "true":
                    train_query = train_query.filter(is_deleted=True)
                elif is_deleted.lower() == "false":
                    train_query = train_query.filter(is_deleted=False)
            else:
                # Default behavior: only non-deleted records
                train_query = train_query.filter(is_deleted=False)

            train_data = (
                train_query.order_by("-ts")
                .values(
                    "train_id",
                    "loco_no",
                    "dfis_train_id",
                    "mvis_total_axles",
                    "ts",
                    "mvis_train_speed",
                )
                .first()
            )

            if not train_data:
                return Response({"detail": f"Train not found: {train_id}"}, status=404)

            # Query 2: Get total wagon count
            total_wagons = (
                MvisLeftWagonInfo.objects.filter(train_id=train_id)
                .values("train_id", "tagged_wagon_id")
                .distinct()
                .count()
            )

            # Query 3: Get defects with related data (flexible filtering)

            # Build defect type subqueries based on is_active parameter
            if is_active is not None:
                if is_active.lower() == "true":
                    defect_type_filter = {
                        "defect_code": OuterRef("defect_code"),
                        "is_active": True,
                    }
                elif is_active.lower() == "false":
                    defect_type_filter = {
                        "defect_code": OuterRef("defect_code"),
                        "is_active": False,
                    }
                else:
                    defect_type_filter = {"defect_code": OuterRef("defect_code")}
            else:
                # Default: only active defect types
                defect_type_filter = {
                    "defect_code": OuterRef("defect_code"),
                    "is_active": True,
                }

            defect_name_subquery = DefectType.objects.filter(
                **defect_type_filter
            ).values("name")[:1]

            multiplier_factor_subquery = DefectType.objects.filter(
                **defect_type_filter
            ).values("multiplier_factor")[:1]

            # ADDED: Subqueries for category information
            category_code_subquery = (
                DefectType.objects.filter(**defect_type_filter)
                .select_related("category_code")
                .values("category_code__category_code")[:1]
            )

            category_name_subquery = (
                DefectType.objects.filter(**defect_type_filter)
                .select_related("category_code")
                .values("category_code__name")[:1]
            )

            # Check if defect type exists with the specified criteria
            defect_type_exists_subquery = DefectType.objects.filter(
                **defect_type_filter
            ).values("pk")[:1]

            wagon_info_qs = MvisLeftWagonInfo.objects.filter(
                train_id=OuterRef("train_id"),
                tagged_wagon_id=OuterRef("tagged_wagon_id"),
            ).order_by("-id")

            # Build defects queryset with flexible filtering
            defects_query = UniqueDefect.objects.filter(train_id=train_id)

            # Filter by dpu_id if provided
            if dpu_id:
                defects_query = defects_query.filter(dpu_id=dpu_id)

            # Filter by is_deleted if specified
            if is_deleted == "true":
                defects_query = defects_query.filter(is_deleted=True)
            elif is_deleted == "false":
                defects_query = defects_query.filter(is_deleted=False)
            elif is_deleted == "both":
                # No filtering - show both deleted and non-deleted
                pass
            else:
                # Invalid value, default to false
                defects_query = defects_query.filter(is_deleted=False)

            # Filter by generated_by if specified
            if generated_by is not None:
                if generated_by.lower() == "system":
                    defects_query = defects_query.filter(generated_by="system")
                elif generated_by.lower() == "manual":
                    defects_query = defects_query.filter(generated_by="manual")

            defects_qs = defects_query.annotate(
                defect_name=Subquery(defect_name_subquery),
                multiplier_factor=Subquery(multiplier_factor_subquery),
                category_code=Subquery(category_code_subquery),
                category_name=Subquery(category_name_subquery),
                defect_type_exists=Subquery(defect_type_exists_subquery),
                wagon_no=Subquery(wagon_info_qs.values("wagon_id")[:1]),
                wagon_position=Subquery(wagon_info_qs.values("tagged_wagon_id")[:1]),
            ).filter(
                defect_type_exists__isnull=False
            )  # Only include defects with matching defect types

            defects = []
            for defect in defects_qs:
                defect_image = (
                    f"/api/images/{defect.defect_image}" if defect.defect_image else None
                )
                defect_name = getattr(defect, "defect_name", None)
                multiplier_factor = getattr(defect, "multiplier_factor", None)
                category_code = getattr(defect, "category_code", None)
                category_name = getattr(defect, "category_name", None)
                wagon_no = getattr(defect, "wagon_no", None) or defect.tagged_wagon_id
                wagon_position = (
                    getattr(defect, "wagon_position", None) or defect.tagged_wagon_id
                )
                defects.append(
                    {
                        "id": defect.id,
                        "train_id": defect.train_id,
                        "side": defect.side,
                        "defect_code": defect.defect_code,
                        "defect_name": defect_name,
                        "multiplier_factor": multiplier_factor,
                        "category_code": category_code,
                        "category_name": category_name,
                        "wagon_no": wagon_no,
                        "wagon_position": wagon_position,
                        "defect_image": defect_image,
                        "action_taken": defect.action_taken,
                        "field_report": defect.field_report,
                        "remarks": defect.remarks,
                        "generated_by": getattr(defect, "generated_by", None),
                        "ts": defect.ts,
                    }
                )

            wagons_data = list(
                MvisLeftWagonInfo.objects.filter(train_id=train_id)
                .values("tagged_wagon_id", "wagon_id", "wagon_type")
                .distinct()
            )

            # Sort wagons by numeric part of tagged_wagon_id
            def get_sort_key(wagon):
                tagged_id = wagon["tagged_wagon_id"] or ""
                numeric_part = re.sub(r"[^0-9]", "", tagged_id)
                return int(numeric_part) if numeric_part else 0

            wagons_data.sort(key=get_sort_key)

            # Format wagons for response
            wagons = [
                {
                    "tagged_wagonid": wagon["tagged_wagon_id"],
                    "wagon_id": wagon["wagon_id"],
                    "wagon_type": wagon["wagon_type"],
                }
                for wagon in wagons_data
            ]

            ist = pytz.timezone("Asia/Kolkata")
            if train_data["ts"].tzinfo is None:
                ts_utc = pytz.UTC.localize(train_data["ts"])
                ts_ist = ts_utc.astimezone(ist)
            else:
                ts_ist = train_data["ts"].astimezone(ist)

            response_data = {
                "train_id": train_data["train_id"],
                "loco_no": train_data["loco_no"],
                "dfisid": train_data["dfis_train_id"],
                "axle_count": train_data["mvis_total_axles"],
                "last_updated_on": ts_ist.isoformat(),
                "train_speed": train_data["mvis_train_speed"],
                "total_wagons": total_wagons,
                "defects": defects,
                "wagons": wagons,
            }

            return Response(response_data, status=200)

        except Exception as e:
            logger.error(f"Error in TrainDetailView: {str(e)}")
            logger.error(traceback.format_exc())
            return Response({"error": "Internal server error"}, status=500)

    def patch(self, request, train_id, *args, **kwargs):
        """
        Partial update for a train resource. Currently supports updating `loco_no`.

        Assumption: We update the most recent MvisProcessedInfo record for the
        given train_id (the one with highest `ts`). This avoids touching historic
        rows. If you prefer updating all rows or a different table, tell me and
        I'll adjust.
        """

        allowed_fields = {"loco_no"}
        data = request.data or {}
        invalid = set(data.keys()) - allowed_fields
        if invalid:
            return Response(
                {"detail": f"Fields not allowed: {', '.join(invalid)}"}, status=400
            )

        try:
            # Update all non-deleted rows for this train_id
            qs = MvisProcessedInfo.objects.filter(
                train_id=train_id, is_deleted=False  # Only update non-deleted records
            )
            if not qs.exists():
                return Response({"detail": f"Train not found: {train_id}"}, status=404)

            if "loco_no" in data:
                # Validate loco_no: must be numeric and max length 20
                loco_no_val = data["loco_no"]
                if loco_no_val is None:
                    return Response({"detail": "loco_no cannot be null"}, status=400)
                loco_no_str = str(loco_no_val).strip()
                if not loco_no_str.isdigit():
                    return Response({"detail": "loco_no must be numeric"}, status=400)
                if len(loco_no_str) > 20:
                    return Response(
                        {"detail": "loco_no must be at most 20 characters"}, status=400
                    )

                # Use queryset.update to modify all matching rows in a single query
                qs.update(loco_no=loco_no_str)

            # Return the same representation as GET after update
            return self.get(request, train_id)

        except Exception as e:
            logger.error(f"Error in TrainDetailView.patch: {str(e)}")
            logger.error(traceback.format_exc())
            return Response({"error": "Internal server error"}, status=500)


class TrainWagonListView(APIView):
    """
    API endpoint to get list of wagons by train_id using Django ORM
    """

    permission_classes = [AllowAny]

    def get(self, request, train_id, *args, **kwargs):
        # Query wagons information
        wagons_qs = (
            MvisLeftWagonInfo.objects.filter(train_id=train_id)
            .values("id", "tagged_wagon_id", "wagon_id", "wagon_type")
            .distinct()
        )
        wagons = list(wagons_qs)

        # Sort wagons by numeric part of tagged_wagon_id
        def get_sort_key(w):
            tagged_id = w.get("tagged_wagon_id") or ""
            numeric_part = re.sub(r"[^0-9]", "", tagged_id)
            return int(numeric_part) if numeric_part else 0

        wagons.sort(key=get_sort_key)
        # Format response
        data = [
            {
                "id": w["id"],
                "tagged_wagonid": w["tagged_wagon_id"],
                "wagon_id": w["wagon_id"],
                "wagon_type": w["wagon_type"],
            }
            for w in wagons
        ]
        return Response(data, status=200)


class TrainWagonDetailView(APIView):
    """
    API endpoint to patch wagon_id and wagon_type for a specific wagon of a train
    """

    permission_classes = [AllowAny]

    def get(self, request, train_id, wagon_position, *args, **kwargs):
        """
        Get details for a specific wagon by tagged_wagon_id.
        """
        try:
            instance = (
                MvisLeftWagonInfo.objects.filter(
                    train_id=train_id, tagged_wagon_id=wagon_position
                )
                .order_by("-id")
                .first()
            )
            if not instance:
                return Response(
                    {"detail": f"Wagon not found: {wagon_position}"}, status=404
                )
            return Response(
                {
                    "tagged_wagonid": instance.tagged_wagon_id,
                    "wagon_id": instance.wagon_id,
                    "wagon_type": instance.wagon_type,
                },
                status=200,
            )
        except Exception as e:
            logger.error(f"Error in TrainWagonDetailView.get: {str(e)}")
            logger.error(traceback.format_exc())
            return Response({"error": "Internal server error"}, status=500)

    def patch(self, request, train_id, wagon_position, *args, **kwargs):
        try:
            query_set = MvisLeftWagonInfo.objects.filter(
                train_id=train_id, tagged_wagon_id=wagon_position
            )
            if not query_set.exists():
                return Response(
                    {"detail": f"Wagon not found: {wagon_position}"}, status=404
                )
        except Exception as e:
            logger.error(f"Error in TrainWagonDetailView.patch lookup: {str(e)}")
            logger.error(traceback.format_exc())
            return Response({"error": "Interval server error"}, status=500)
        data = request.data
        allowed_fields = {"wagon_id", "wagon_type"}
        invalid = set(data.keys()) - allowed_fields
        if invalid:
            return Response(
                {"detail": f'Fields not allowed: {", ".join(invalid)}'}, status=400
            )
        update_fields = {
            field: data[field] for field in allowed_fields if field in data
        }

        # Perform bulk update for all the matching rows
        query_set.update(**update_fields)

        updated_count = query_set.count()
        latest_instance = query_set.last()

        return Response(
            {
                "updated_count": updated_count,
                "wagon_position": (
                    latest_instance.tagged_wagon_id if latest_instance else None
                ),
                "wagon_type": (latest_instance.wagon_type if latest_instance else None),
                "wagon_no": (latest_instance.wagon_id if latest_instance else None),
            },
            status=200,
        )
