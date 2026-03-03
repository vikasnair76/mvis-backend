from cbs_cloud import settings
from rest_framework import viewsets, status, permissions, mixins, exceptions
from rest_framework.decorators import action, api_view
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.parsers import MultiPartParser, FormParser
from django.db.models import OuterRef, Subquery, Q, F
from django.db import transaction
from .models import (
    DefectFeedbackAttachment,
    DefectCategory,
    DefectInfo,
    DefectType,
    UniqueDefect,
    Defects,
)
from .serializers import (
    DefectFeedbackAttachmentSerializer,
    DefectCategorySerializer,
    DefectTypeSerializer,
    DefectTypeListSerializer,
    DefectSerializer,
)
from .utils import get_start_ts_from_train_id, datetime_to_unix_timestamp
from .validators import get_dpu_id_from_request, get_valid_defect_codes_for_dpu
from cbs.models import LeftWagonInfo
import mimetypes
from django.http import FileResponse, Http404, StreamingHttpResponse
from django.utils import timezone
from datetime import datetime, timedelta, date, time as dtime
import json
import redis
import traceback
import logging
from django.apps import apps
import os
import shutil
import difflib
from django.conf import settings


# Logger for this module
logger = logging.getLogger(__name__)
from django.db import IntegrityError, DatabaseError
from rest_framework.exceptions import ValidationError as DRFValidationError


def sse_view(request):
    def event_stream():
        redis_client = None
        pubsub = None
        try:
            last_event_id = request.GET.get("last_event_id")
            if last_event_id:
                try:
                    last_event_id = int(last_event_id)
                except (ValueError, TypeError):
                    last_event_id = None

            # Get optional location_id for location-specific channel
            location_id = request.GET.get("location_id")
            channel = f"defect-events:{location_id}" if location_id else "defect-events"
            history_key = f"defect-events-history:{location_id}" if location_id else "defect-events-history"

            redis_client = redis.Redis(
                host=os.getenv("REDIS_HOST"),
                port=int(os.getenv("REDIS_PORT")),
                db=int(os.getenv("REDIS_DB")),
                password=os.getenv("REDIS_PASSWORD"),
                decode_responses=True,
                socket_timeout=10,
                socket_connect_timeout=5,
            )
            # Send history first
            try:
                history = redis_client.lrange(
                    history_key, 0, 99
                )  # get last 100 events for filtering
                filtered_events = []
                for hist_event in reversed(history):
                    try:
                        event_data = json.loads(hist_event)
                        event_type = event_data.get("event_type", "message")
                        if event_type == "new_defect":
                            event_id = event_data.get("event_id")
                            if event_id is None:
                                import time

                                event_id = int(time.time() * 1000)
                            # Only include if event_id > last_event_id (or if last_event_id is None)
                            if last_event_id is None or event_id > last_event_id:
                                filtered_events.append((event_id, event_data))
                    except Exception:
                        continue
                # Send filtered events (limit to 20 most recent)
                for event_id, event_data in filtered_events[-20:]:
                    payload_data = event_data.get("payload", {})
                    full_data = {
                        **payload_data,  # Spread the original payload
                        "event_id": event_id,  # Add event_id to the data
                        "timestamp": event_data.get(
                            "timestamp"
                        ),  # Add timestamp if needed
                    }
                    yield f"id: {event_id}\n".encode("utf-8")
                    yield f"event: {event_data.get('event_type')}\n".encode("utf-8")
                    yield f"data: {json.dumps(full_data)}\n\n".encode("utf-8")
            except Exception:
                pass
            pubsub = redis_client.pubsub()
            pubsub.subscribe(channel)
            yield f": connected to {channel} SSE endpoint\n\n".encode("utf-8")
            import time

            try:
                while True:
                    try:
                        message = pubsub.get_message(timeout=None)
                        if message is None:
                            continue
                        if message["type"] == "message":
                            try:
                                event_data = json.loads(message["data"])
                                event_type = event_data.get("event_type", "message")
                                # Only stream defect events
                                if event_type == "new_defect":
                                    event_id = event_data.get("event_id")
                                    if event_id is None:
                                        event_id = int(time.time() * 1000)
                                    payload_data = event_data.get("payload", {})
                                    full_data = {
                                        **payload_data,  # Spread the original payload
                                        "event_id": event_id,  # Add event_id to the data
                                        "timestamp": event_data.get(
                                            "timestamp"
                                        ),  # Add timestamp if needed
                                    }
                                    yield f"id: {event_id}\n".encode("utf-8")
                                    yield f"event: {event_type}\n".encode("utf-8")
                                    yield f"data: {json.dumps(full_data)}\n\n".encode(
                                        "utf-8"
                                    )
                            except (json.JSONDecodeError, KeyError):
                                continue
                    except redis.RedisError as e:
                        yield f'event: error\ndata: {{"error": "Redis error: {str(e)}"}}\n\n'.encode(
                            "utf-8"
                        )
                        break
                    except Exception as e:
                        yield f'event: error\ndata: {{"error": "Connection error: {str(e)}"}}\n\n'.encode(
                            "utf-8"
                        )
                        break
            finally:
                if pubsub:
                    try:
                        pubsub.close()
                    except Exception:
                        pass
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


# Detail API for a single processed defect
class DefectInfoDetail(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        from .models import DefectType
        from django.http import Http404

        # Get optional dpu_id filter
        dpu_id = get_dpu_id_from_request(request, required=False)

        try:
            # Build query with optional dpu_id filter
            query = DefectInfo.objects.defer("ts", "start_ts").filter(pk=pk, is_deleted=False)
            if dpu_id:
                query = query.filter(dpu_id=dpu_id)
            
            obj = query.get()
        except DefectInfo.DoesNotExist:
            if dpu_id:
                raise Http404(f"DefectInfo not found for dpu_id '{dpu_id}' or has been deleted")
            raise Http404("DefectInfo not found or has been deleted")

        # Get defect type and category info - only active defect types
        defect_type = None
        category_code = None
        category_name = None
        try:
            dt = DefectType.objects.select_related("category_code").get(
                defect_code=obj.defect_code, is_active=True
            )
            defect_type = dt.name
            category_code = dt.category_code.category_code if dt.category_code else None
            category_name = dt.category_code.name if dt.category_code else None
        except DefectType.DoesNotExist:
            # If defect type doesn't exist or is inactive, still show the record
            # but without defect type details
            pass

        data = {
            "id": obj.pk,
            "train_id": obj.train_id,
            "tagged_wagon_id": obj.tagged_wagon_id,
            "side": obj.side,
            "tagged_bogie_id": obj.tagged_bogie_id,
            "defect_image": obj.defect_image.url if obj.defect_image else None,
            "action_taken": obj.action_taken,
            "field_report": obj.field_report,
            "remarks": obj.remarks,
            "defect_code": obj.defect_code,
            "defect_type": defect_type,
            "category_code": category_code,
            "category_name": category_name,
        }
        return Response(data)

    def _validate_field(self, field_name, allowed_values, data):
        if field_name in data:
            value = data[field_name]
            if value not in allowed_values:
                return Response(
                    {
                        "error": f"Invalid {field_name} value. Allowed values: {', '.join(allowed_values)}"
                    },
                    status=400,
                )
            return value
        return None

    def patch(self, request, pk):
        from django.http import Http404

        allowed_fields = {
            "action_taken",
            "remarks",
            "field_report",
            "user_email",
            "user_ip",
        }
        extra_fields = set(request.data.keys()) - allowed_fields
        if extra_fields:
            return Response(
                {"error": f"Only {', '.join(allowed_fields)} can be updated."},
                status=400,
            )

        try:
            obj = DefectInfo.objects.defer("ts", "start_ts").get(pk=pk, is_deleted=False)
        except DefectInfo.DoesNotExist:
            raise Http404("DefectInfo not found")

        updated = False
        allowed_actions = [
            "TRUE-CRITICAL",
            "TRUE-MAINTENANCE",
            "FALSE",
            "NON-STD ALERTS",
            "-",
        ]
        action_value = self._validate_field(
            "action_taken", allowed_actions, request.data
        )
        if isinstance(action_value, Response):
            return action_value
        if action_value is not None:
            updated = True

        field_report_value = self._validate_field(
            "field_report", allowed_actions, request.data
        )
        if isinstance(field_report_value, Response):
            return field_report_value
        if field_report_value is not None:
            updated = True

        if "remarks" in request.data:
            updated = True
        if not updated:
            return Response(
                {"error": "At least one of 'action_taken' or 'remarks' is required."},
                status=400,
            )

        # Build image matching similar to delete(): match full path, basename, or path ending
        image_val = str(obj.defect_image) if obj.defect_image is not None else ""
        image_base = os.path.basename(image_val)

        from django.db import transaction
        from django.db.models import Q

        q_img = (
            Q(defect_image=image_val)
            | Q(defect_image=image_base)
            | Q(defect_image__endswith="/" + image_base)
            | Q(defect_image__endswith="\\" + image_base)
        )

        # Build update dict
        update_fields = {}
        if action_value is not None:
            update_fields["action_taken"] = action_value
        if field_report_value is not None:
            update_fields["field_report"] = field_report_value
        if "remarks" in request.data:
            update_fields["remarks"] = request.data["remarks"]

        # Apply bulk update inside transaction and lock rows
        with transaction.atomic():
            qs = (
                DefectInfo.objects.defer("ts", "start_ts").select_for_update()
                .filter(
                    train_id=obj.train_id,
                    tagged_wagon_id=obj.tagged_wagon_id,
                    side=obj.side,
                )
                .filter(q_img)
            )

            # If no matching rows found, still attempt to update the primary obj only
            if not qs.exists():
                # Fallback: update only the target object
                for k, v in update_fields.items():
                    setattr(obj, k, v)
                obj.save(update_fields=list(update_fields.keys()))
                updated_count = 1
                rows = [obj]
            else:
                # Perform bulk update
                updated_count = qs.update(**update_fields)
                # Refresh one representative object for response
                rows = list(qs[:1])

        # Return a representative updated object (same shape as GET) plus count
        from .models import DefectType

        rep = rows[0] if rows else obj
        defect_type = None
        category_code = None
        category_name = None
        try:
            dt = DefectType.objects.select_related("category_code").get(
                defect_code=rep.defect_code
            )
            defect_type = dt.name
            category_code = dt.category_code.category_code if dt.category_code else None
            category_name = dt.category_code.name if dt.category_code else None
        except DefectType.DoesNotExist:
            pass

        data = {
            "updated_count": updated_count,
            "id": rep.pk,
            "train_id": rep.train_id,
            "tagged_wagon_id": rep.tagged_wagon_id,
            "side": rep.side,
            "tagged_bogie_id": rep.tagged_bogie_id,
            "defect_image": rep.defect_image.url if rep.defect_image else None,
            "action_taken": (
                getattr(rep, "action_taken", None)
                if updated_count == 1
                else update_fields.get(
                    "action_taken", getattr(rep, "action_taken", None)
                )
            ),
            "field_report": (
                getattr(rep, "field_report", None)
                if updated_count == 1
                else update_fields.get(
                    "field_report", getattr(rep, "field_report", None)
                )
            ),
            "remarks": (
                getattr(rep, "remarks", None)
                if updated_count == 1
                else update_fields.get("remarks", getattr(rep, "remarks", None))
            ),
            "defect_code": rep.defect_code,
            "defect_type": defect_type,
            "category_code": category_code,
            "category_name": category_name,
        }
        return Response(data)

    def delete(self, request, pk):
        from django.http import Http404
        from django.db import transaction

        try:
            # Use defer() to skip loading ts/start_ts fields which may contain
            # out-of-range values that crash UnixTimeStampField conversion
            seed = DefectInfo.objects.defer("ts", "start_ts").get(pk=pk, is_deleted=False)
        except DefectInfo.DoesNotExist:
            raise Http404("DefectInfo not found or already deleted")

        image_val = str(seed.defect_image) if seed.defect_image is not None else ""
        image_base = os.path.basename(image_val)

        filters = {
            "train_id": seed.train_id,
            "tagged_wagon_id": seed.tagged_wagon_id,
            "side": seed.side,
            "defect_image": image_val,
            "is_deleted": False,  # Only target active records
        }

        from django.db.models import Q

        q_img = (
            Q(defect_image=image_val)
            | Q(defect_image=image_base)
            | Q(defect_image__endswith="/" + image_base)
            | Q(defect_image__endswith="\\" + image_base)
        )

        with transaction.atomic():
            qs = DefectInfo.objects.defer("ts", "start_ts").select_for_update().filter(**filters).filter(q_img)

            # Soft delete - mark as deleted
            updated_count = qs.update(is_deleted=True)

            return Response({"soft_deleted": updated_count}, status=200)


class DefectCategoryViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing defect categories
    """

    queryset = DefectCategory.objects.all()
    serializer_class = DefectCategorySerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = []  # Removed is_active
    search_fields = ["name", "description"]
    ordering_fields = ["name", "created_at"]
    ordering = ["name"]

    @action(detail=False, methods=["get"])
    def active_categories(self, request):
        """Get only active defect categories"""
        active_categories = DefectCategory.objects.all()  # Removed is_active filter
        serializer = self.get_serializer(active_categories, many=True)
        return Response(serializer.data)


class DefectTypeViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing defect types with CRUD operations
    """

    queryset = DefectType.objects.all()
    serializer_class = DefectTypeSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = []  # Removed is_active, severity, category
    search_fields = ["defect_code", "name", "description"]
    ordering_fields = ["defect_code", "name", "created_at"]
    ordering = ["defect_code"]

    def get_serializer_class(self):
        """Use full serializer for list and detail views, simplified for some custom actions"""
        if self.action in ["active_defects", "by_category"]:
            return DefectTypeListSerializer
        return DefectTypeSerializer

    @action(detail=False, methods=["get"])
    def active_defects(self, request):
        """Get all defect types (no is_active filter)"""
        active_defects = DefectType.objects.all()
        serializer = DefectTypeSerializer(active_defects, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"])
    def defect_codes(self, request):
        """Get defect codes for backward compatibility (no is_active filter)"""
        # Get optional dpu_id filter
        dpu_id = get_dpu_id_from_request(request, required=False)
        
        if dpu_id:
            # Return only defect codes valid for this dpu_id
            codes = get_valid_defect_codes_for_dpu(dpu_id)
        else:
            codes = DefectType.objects.all().values_list("defect_code", flat=True)
        return Response(list(codes))

    @action(detail=False, methods=["get"])
    def by_category(self, request):
        """Get defects grouped by category (no is_active filter)"""
        categories = DefectCategory.objects.all().prefetch_related("defect_types")
        result = []
        for category in categories:
            defects = category.defect_types.all()
            result.append(
                {
                    "category": DefectCategorySerializer(category).data,
                    "defects": DefectTypeListSerializer(defects, many=True).data,
                }
            )
        return Response(result)

    @action(detail=False, methods=["get"])
    def severity_counts(self, request):
        """Get count of defects by severity level (no is_active/severity fields)"""
        # Since severity does not exist, return empty or static response
        return Response([])

    def list(self, request, *args, **kwargs):
        """
        Return all defect types without pagination
        """
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)


# Pagination class for processed defects
class DefectPagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = "page_size"
    max_page_size = 100


class LatestDefectInfo(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Get query parameters
        is_deleted = request.query_params.get("is_deleted")
        is_active = request.query_params.get("is_active")

        # Get optional dpu_id filter
        dpu_id = get_dpu_id_from_request(request, required=False)

        # Start with base queryset
        queryset = UniqueDefect.objects.filter(defect_code__isnull=False)

        # Filter by dpu_id column directly if provided
        if dpu_id:
            queryset = queryset.filter(dpu_id=dpu_id)

        # Filter by is_deleted if specified
        if is_deleted is not None:
            if is_deleted.lower() == "true":
                queryset = queryset.filter(is_deleted=True)
            elif is_deleted.lower() == "false":
                queryset = queryset.filter(is_deleted=False)

        # Filter by defect type active status if specified
        if is_active is not None:
            if is_active.lower() == "true":
                active_defect_codes = list(
                    DefectType.objects.filter(is_active=True).values_list(
                        "defect_code", flat=True
                    )
                )
                queryset = queryset.filter(defect_code__in=active_defect_codes)
            elif is_active.lower() == "false":
                inactive_defect_codes = list(
                    DefectType.objects.filter(is_active=False).values_list(
                        "defect_code", flat=True
                    )
                )
                queryset = queryset.filter(defect_code__in=inactive_defect_codes)

        latest_defect = queryset.order_by("-id").first()

        if not latest_defect:
            return Response({"detail": "No defect found."}, status=404)

        defect_name = None
        try:
            # Filter defect type based on is_active parameter
            if is_active is not None:
                if is_active.lower() == "true":
                    defect_type = DefectType.objects.get(
                        defect_code=latest_defect.defect_code, is_active=True
                    )
                elif is_active.lower() == "false":
                    defect_type = DefectType.objects.get(
                        defect_code=latest_defect.defect_code, is_active=False
                    )
                else:
                    defect_type = DefectType.objects.get(
                        defect_code=latest_defect.defect_code
                    )
            else:
                defect_type = DefectType.objects.get(
                    defect_code=latest_defect.defect_code
                )

            defect_name = defect_type.name
        except DefectType.DoesNotExist:
            pass

        # Extract values for response
        id = latest_defect.id
        train_id = latest_defect.train_id
        ts = latest_defect.ts
        tagged_wagon_id = latest_defect.tagged_wagon_id
        tagged_bogie_id = latest_defect.tagged_bogie_id
        side = latest_defect.side
        defect_code = latest_defect.defect_code
        defect_image = (
            f"/api/images/{latest_defect.defect_image}"
            if latest_defect.defect_image
            else None
        )
        action_taken = latest_defect.action_taken
        remarks = latest_defect.remarks
        # Convert ts (unix timestamp) to IST and format as dd-mm-yyyy hh:mm:ss
        if ts is not None:
            # Handle both datetime objects and numeric timestamps
            if isinstance(ts, datetime):
                dt_utc = ts.replace(tzinfo=timezone.utc)
            else:
                # ts is a numeric timestamp
                dt_utc = datetime.utcfromtimestamp(ts).replace(tzinfo=timezone.utc)
            dt_ist = dt_utc.astimezone(timezone(timedelta(hours=5, minutes=30)))
            ts_str = dt_ist.strftime("%d-%m-%Y %H:%M:%S")
        else:
            ts_str = None

        # Get pending_alert count for today with same filtering logic
        today_prefix = f"T{date.today().strftime('%Y%m%d')}"

        pending_queryset = UniqueDefect.objects.filter(
            defect_code__isnull=False, train_id__startswith=today_prefix
        ).exclude(defect_code="-")

        # Apply same filters for pending count
        if is_deleted is not None:
            if is_deleted.lower() == "true":
                pending_queryset = pending_queryset.filter(is_deleted=True)
            elif is_deleted.lower() == "false":
                pending_queryset = pending_queryset.filter(is_deleted=False)

        if is_active is not None:
            if is_active.lower() == "true":
                active_defect_codes = list(
                    DefectType.objects.filter(is_active=True).values_list(
                        "defect_code", flat=True
                    )
                )
                pending_queryset = pending_queryset.filter(
                    defect_code__in=active_defect_codes
                )
            elif is_active.lower() == "false":
                inactive_defect_codes = list(
                    DefectType.objects.filter(is_active=False).values_list(
                        "defect_code", flat=True
                    )
                )
                pending_queryset = pending_queryset.filter(
                    defect_code__in=inactive_defect_codes
                )

        unique_defects = (
            pending_queryset.values(
                "train_id", "defect_code", "defect_image", "tagged_wagon_id"
            )
            .distinct()
            .count()
        )

        pending_alert = unique_defects

        # BUILD THE DATA RESPONSE (this was missing!)
        data = {
            "id": id,
            "train_id": train_id,
            "ts": ts_str,
            "tagged_wagon_id": tagged_wagon_id,
            "tagged_bogie_id": tagged_bogie_id,
            "side": side,
            "defect_code": defect_code,
            "defect_name": defect_name,
            "defect_image": defect_image,
            "action_taken": action_taken,
            "remarks": remarks,
            "pending_alert": pending_alert,
        }
        return Response(data)


# ViewSet to list processed defects with filters and NO pagination
class DefectViewSet(
    mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet
):
    """
    List processed defects with query parameters:
      - start_date (dd-mm-yyyy)
      - end_date (dd-mm-yyyy)
      - defect_code (exact match)
      - action_taken (exact match)
      - is_deleted (true/false - if not mentioned, returns all)
      - is_active (true/false - filters by defect type active status, if not mentioned, returns all)
      - generated_by (system/manual/both - if not mentioned, returns all)
    """

    @action(
        detail=True,
        methods=["post"],
        url_path="restore",
        permission_classes=[permissions.IsAuthenticated],
    )
    def restore(self, request, pk=None):
        """
        Restore a soft-deleted defect:
        - same train_id
        - same tagged_wagon_id
        - same side
        - exact same defect_image string
        - only rows with is_deleted=True
        """
        with transaction.atomic():
            try:
                seed = DefectInfo.objects.select_for_update().get(
                    pk=pk, is_deleted=True
                )
            except DefectInfo.DoesNotExist:
                return Response(
                    {"error": "Defect not found or not deleted."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            image_val = str(seed.defect_image) if seed.defect_image else ""
            image_base = os.path.basename(image_val)

            q_img = (
                Q(defect_image=image_val)
                | Q(defect_image=image_base)
                | Q(defect_image__endswith="/" + image_base)
                | Q(defect_image__endswith="\\" + image_base)
            )

            filters = {
                "train_id": seed.train_id,
                "tagged_wagon_id": seed.tagged_wagon_id,
                "side": seed.side,
                "defect_image": image_val,
                "is_deleted": True,
            }

            qs = DefectInfo.objects.select_for_update().filter(**filters).filter(q_img)
            qs.update(is_deleted=False)

        return Response(
            {
                "restored": True,
                "id": seed.id,
                "train_id": seed.train_id,
                "wagon": seed.tagged_wagon_id,
                "side": seed.side,
            },
            status=status.HTTP_200_OK,
        )

    serializer_class = DefectSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = DefectPagination

    def get_queryset(self):
        from datetime import datetime

        # Start with base queryset using UniqueDefect model
        queryset = UniqueDefect.objects.all()

        # Get optional dpu_id filter
        dpu_id = get_dpu_id_from_request(self.request, required=False)
        
        # Filter by dpu_id column directly if provided
        if dpu_id:
            queryset = queryset.filter(dpu_id=dpu_id)

        # Get query parameters
        start_date = self.request.query_params.get("start_date")
        end_date = self.request.query_params.get("end_date")
        defect_code_param = self.request.query_params.get("defect_code")
        defect_codes = []
        if defect_code_param:
            defect_codes = [
                code.strip() for code in defect_code_param.split(",") if code.strip()
            ]
        action_taken = self.request.query_params.get("action_taken")
        field_report = self.request.query_params.get("field_report")
        acknowledged = self.request.query_params.get("acknowledged")
        feedback_mismatched = self.request.query_params.get("feedback_mismatched")
        is_deleted = self.request.query_params.get("is_deleted")
        is_active = self.request.query_params.get("is_active")
        generated_by = self.request.query_params.get("generated_by")

        # Apply is_deleted filter based on the parameter
        if is_deleted is None:
            # Default: only show non-deleted records
            queryset = queryset.filter(is_deleted=False)
        elif is_deleted.lower() == "true":
            # Show only deleted records
            queryset = queryset.filter(is_deleted=True)
        elif is_deleted.lower() == "false":
            # Show only non-deleted records
            queryset = queryset.filter(is_deleted=False)
        elif is_deleted.lower() == "both":
            # Show both deleted and non-deleted records (no filter applied)
            pass
        else:
            # Invalid value: default to non-deleted
            queryset = queryset.filter(is_deleted=False)

        # Filter by generated_by if specified
        if generated_by is not None:
            if generated_by.lower() == "system":
                queryset = queryset.filter(generated_by="system")
            elif generated_by.lower() == "manual":
                queryset = queryset.filter(generated_by="manual")

        # Filter by date range using train_id if provided
        if start_date:
            try:
                start_date_obj = datetime.strptime(start_date, "%d-%m-%Y")
                start_date_str = start_date_obj.strftime("%Y%m%d")
                start_train_id = f"T{start_date_str}000000"
                queryset = queryset.filter(train_id__gte=start_train_id)
            except ValueError:
                pass

        if end_date:
            try:
                end_date_obj = datetime.strptime(end_date, "%d-%m-%Y")
                end_date_str = end_date_obj.strftime("%Y%m%d")
                end_train_id = f"T{end_date_str}235959"
                queryset = queryset.filter(train_id__lte=end_train_id)
            except ValueError:
                pass

        # Filter by multiple defect_codes if provided
        if defect_codes:
            queryset = queryset.filter(defect_code__in=defect_codes)
        # Filter out's feedback where action_taken and field_report both mismatches
        # and also checks if field_report='-' and action_taken='given' then it won't take as mismatched
        if feedback_mismatched and feedback_mismatched.lower() == "true":
            queryset = queryset.filter(
                ~Q(action_taken="-"),
                ~Q(action_taken__isnull=True),
                ~Q(field_report="-"),
                ~Q(field_report__isnull=True),
            ).exclude(action_taken=F("field_report"))

        elif action_taken and field_report:
            # Both parameters provided
            if action_taken == "-" and field_report == "-":
                # Show pending: where at least one field is '-' or NULL
                queryset = queryset.filter(
                    Q(action_taken="-")
                    | Q(action_taken__isnull=True)
                    | Q(field_report="-")
                    | Q(field_report__isnull=True)
                )
            else:
                # Both have specific values - use AND logic
                queryset = queryset.filter(
                    action_taken=action_taken, field_report=field_report
                )
        elif acknowledged == "true":
            # Show only fully acknowledged (both fields filled and not '-')
            queryset = queryset.exclude(
                Q(action_taken="-") | Q(action_taken__isnull=True)
            ).exclude(Q(field_report="-") | Q(field_report__isnull=True))
        elif action_taken:
            # Only action_taken filter
            queryset = queryset.filter(action_taken=action_taken)
        elif field_report:
            # Only field_report filter
            queryset = queryset.filter(field_report=field_report)

        # Exclude records with null or empty defect_code
        queryset = (
            queryset.filter(defect_code__isnull=False)
            .exclude(defect_code="-")
            .exclude(defect_code="")
        )

        # Filter by defect type active status if specified
        if is_active is not None:
            if is_active.lower() == "true":
                active_defect_codes = list(
                    DefectType.objects.filter(is_active=True).values_list(
                        "defect_code", flat=True
                    )
                )
                queryset = queryset.filter(defect_code__in=active_defect_codes)
            elif is_active.lower() == "false":
                inactive_defect_codes = list(
                    DefectType.objects.filter(is_active=False).values_list(
                        "defect_code", flat=True
                    )
                )
                queryset = queryset.filter(defect_code__in=inactive_defect_codes)

        # Annotate wagon number from left wagon info table
        wagon_info_qs = LeftWagonInfo.objects.filter(
            train_id=OuterRef("train_id"),
            tagged_wagon_id=OuterRef("tagged_wagon_id"),
        ).order_by("-id")

        queryset = queryset.annotate(
            wagon_no=Subquery(wagon_info_qs.values("wagon_id")[:1]),
            wagon_position=Subquery(wagon_info_qs.values("tagged_wagon_id")[:1]),
        )

        return queryset.order_by("-id")

    def list(self, request, *args, **kwargs):
        """
        Return filtered defects with additional defect type information, paginated
        """
        queryset = self.get_queryset()
        page = self.paginate_queryset(queryset)
        results = []
        defects = page if page is not None else queryset

        # Get is_active parameter to decide how to fetch defect type
        is_active = self.request.query_params.get("is_active")

        for defect in defects:
            defect_name = None
            try:
                # Filter defect type based on is_active parameter
                if is_active is not None:
                    if is_active.lower() == "true":
                        defect_type = DefectType.objects.get(
                            defect_code=defect.defect_code, is_active=True
                        )
                    elif is_active.lower() == "false":
                        defect_type = DefectType.objects.get(
                            defect_code=defect.defect_code, is_active=False
                        )
                    else:
                        defect_type = DefectType.objects.get(
                            defect_code=defect.defect_code
                        )
                else:
                    # If is_active not specified, get any defect type
                    defect_type = DefectType.objects.get(defect_code=defect.defect_code)

                defect_name = defect_type.name
            except DefectType.DoesNotExist:
                pass

            train_date_str = None
            train_time_str = None
            if defect.train_id and len(defect.train_id) >= 15:
                try:
                    date_time_part = defect.train_id[1:15]
                    train_date_obj = datetime.strptime(date_time_part, "%Y%m%d%H%M%S")
                    train_date_str = train_date_obj.strftime("%d-%m-%Y")
                    train_time_str = train_date_obj.strftime("%H:%M:%S")
                except ValueError:
                    pass

            wagon_no = getattr(defect, "wagon_no", None) or defect.wagon_id
            wagon_position = (
                getattr(defect, "wagon_position", None) or defect.tagged_wagon_id
            )

            defect_data = {
                "id": defect.id,
                "dpu_id": defect.dpu_id,
                "train_id": defect.train_id,
                "train_date": train_date_str,
                "train_time": train_time_str,
                "wagon_position": wagon_position,
                "wagon_no": wagon_no,
                "wagon_type": defect.wagon_type,
                "loco_no": defect.loco_no,
                "mvis_total_axles": defect.mvis_total_axles,
                "mvis_train_speed": defect.mvis_train_speed,
                "dfis_train_id": defect.dfis_train_id,
                "side": defect.side,
                "defect_image": (
                    f"/api/images/{defect.defect_image}" if defect.defect_image else None
                ),
                "defect_code": defect.defect_code,
                "defect_name": defect_name,
                "action_taken": defect.action_taken,
                "remarks": defect.remarks,
                "start_ts": defect.start_ts,
                "field_report": defect.field_report,
                "ts": defect.ts,
                "generated_by": getattr(defect, "generated_by", None),
                "is_deleted": getattr(defect, "is_deleted", False),
            }
            results.append(defect_data)

        if page is not None:
            return self.get_paginated_response(results)
        return Response(results)

    def _parse_dt(self, date_str, time_val):
        now = timezone.now()
        d = None
        if isinstance(date_str, str) and date_str.strip():
            ds = date_str.strip()
            for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
                try:
                    d = datetime.strptime(ds, fmt).date()
                    break
                except ValueError:
                    continue
        if d is None:
            d = now.date()

        t = None
        if isinstance(time_val, str) and ":" in time_val:
            ts = time_val.strip()
            for fmt in ("%H:%M:%S", "%H:%M"):
                try:
                    t = datetime.strptime(ts, fmt).time()
                    break
                except ValueError:
                    continue

        if t is None:
            num = None
            if isinstance(time_val, (int, float)):
                num = float(time_val)
            elif isinstance(time_val, str) and time_val.strip():
                try:
                    num = float(time_val.replace(",", "."))
                except ValueError:
                    num = None

            if num is not None:
                num = num % 24.0
                hours = int(num)
                minutes_total = (num - hours) * 60.0
                minutes = int(minutes_total)
                seconds = int(round((minutes_total - minutes) * 60.0))
                if seconds == 60:
                    seconds = 0
                    minutes += 1
                if minutes >= 60:
                    minutes -= 60
                    hours = (hours + 1) % 24
                try:
                    t = dtime(hour=hours, minute=minutes, second=seconds)
                except ValueError:
                    t = None

        if t is None:
            t = now.time().replace(microsecond=0)

        dt_naive = datetime.combine(d, t)
        return (
            timezone.make_aware(dt_naive, timezone.get_current_timezone())
            if settings.USE_TZ
            else dt_naive
        )

    def create(self, request, *args, **kwargs):
        """
        POST /defects/ → manually add a defect.
        """
        data = request.data

        train_id = str(data.get("trainid") or data.get("train_id") or "").strip()
        wagon_no = str(data.get("wagon_no") or "").strip()
        wagon_position = (data.get("wagon_position") or "").strip().upper()
        side_raw = (data.get("side") or "").strip().upper()
        component_code_raw = (data.get("component_code") or "").strip()

        action_code_raw = (
            data.get("action_taken")
            or data.get("actionTaken")
            or data.get("action")
            or data.get("feedback")
            or data.get("feedback_value")
            or data.get("feedbackValue")
            or ""
        )
        if action_code_raw is None:
            action_code_raw = ""
        action_code_raw = str(action_code_raw).strip()
        date_str = str(data.get("date") or "").strip()
        time_val = data.get("time")
        defect_image = request.FILES.get("defect_image")

        try:
            logger.debug(
                "Incoming action keys: action_taken=%r, feedback=%r, action=%r, actionTaken=%r",
                data.get("action_taken"),
                data.get("feedback"),
                data.get("action"),
                data.get("actionTaken"),
            )
        except Exception:
            logger.debug(
                "DEBUG incoming action keys: %s",
                {
                    k: data.get(k)
                    for k in (
                        "action_taken",
                        "actionTaken",
                        "action",
                        "feedback",
                        "feedback_value",
                        "feedbackValue",
                    )
                },
            )

        errors = {}
        if not train_id:
            errors["train_id"] = "Train ID is required."

        if not wagon_position:
            errors["wagon_position"] = "Wagon position is required."
        elif not wagon_position.upper().startswith("W"):
            errors["wagon_position"] = "Wagon position must start with 'W'."

        if side_raw not in {"L", "R", "U", "LEFT", "RIGHT", "UNDERCARRIAGE"}:
            errors["side"] = "Side must be one of L, R, U, LEFT, RIGHT, UNDERCARRIAGE."

        if not component_code_raw:
            errors["component_code"] = "Component code is required."
        elif len(component_code_raw) > 5:
            errors["component_code"] = "Component code cannot exceed 5 digits."

        if not defect_image:
            errors["defect_image"] = (
                "Defect image is required for manual defect creation."
            )

        if defect_image:
            max_size = 10 * 1024 * 1024
            allowed_content_types = {"image/jpeg", "image/png"}
            allowed_extensions = {".jpg", ".jpeg", ".png"}

            if hasattr(defect_image, "size") and defect_image.size > max_size:
                errors.setdefault("defect_image", []).append(
                    f"Image exceeds maximum size of {max_size} bytes."
                )

            content_type = getattr(defect_image, "content_type", None)
            if content_type not in allowed_content_types:
                errors.setdefault("defect_image", []).append(
                    f"Unsupported content type: {content_type}. Allowed: {', '.join(allowed_content_types)}"
                )

            name_lower = (getattr(defect_image, "name", "") or "").lower()
            if not any(name_lower.endswith(ext) for ext in allowed_extensions):
                errors.setdefault("defect_image", []).append(
                    "Unsupported file extension. Allowed: .jpg, .jpeg, .png"
                )

            if not errors.get("defect_image"):
                try:
                    from PIL import Image

                    img = Image.open(defect_image)
                    img.verify()
                    defect_image.seek(0)
                except Exception:
                    errors.setdefault("defect_image", []).append(
                        "Uploaded file is not a valid image."
                    )

            if isinstance(errors.get("defect_image"), list):
                errors["defect_image"] = "; ".join(errors["defect_image"])

        if errors:
            return Response({"errors": errors}, status=status.HTTP_400_BAD_REQUEST)

        defect_code = component_code_raw.zfill(3)
        try:
            defect_type = DefectType.objects.get(defect_code=defect_code)
        except DefectType.DoesNotExist:
            return Response(
                {
                    "errors": {
                        "component_code": f"Unknown component/defect code '{defect_code}'."
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        ActionModel = None
        try:
            ActionModel = apps.get_model(DefectType._meta.app_label, "ActionTaken")
        except LookupError:
            ActionModel = None

        if not ActionModel:
            for M in apps.get_models():
                if M.__name__.lower() == "actiontaken":
                    ActionModel = M
                    break

        def _norm_simple(s):
            if s is None:
                return ""
            return "".join(str(s).upper().replace("-", " ").replace("_", " ").split())

        action_obj = None
        action_to_store = None

        if action_code_raw and ActionModel:
            user_norm = _norm_simple(action_code_raw)
            for obj in ActionModel.objects.all():
                for fld in ("action_code", "code", "name"):
                    if hasattr(obj, fld):
                        val = getattr(obj, fld)
                        if val and _norm_simple(val) == user_norm:
                            action_obj = obj
                            break
                if action_obj:
                    break

        if not action_obj and action_code_raw:
            canonical_actions = {
                "FALSE": "FALSE",
                "TRUE-MAINTENANCE": "TRUE-MAINTENANCE",
                "TRUE-CRITICAL": "TRUE-CRITICAL",
                "NON-STD ALERTS": "NON-STD ALERTS",
                "-": "-",
            }

            user_norm = _norm_simple(action_code_raw)
            matched = None
            for k, v in canonical_actions.items():
                if _norm_simple(k) == user_norm or _norm_simple(v) == user_norm:
                    matched = v
                    break

            if not matched:
                cand_list = list(canonical_actions.keys()) + list(
                    canonical_actions.values()
                )
                closest = difflib.get_close_matches(
                    action_code_raw, cand_list, n=1, cutoff=0.6
                )
                if closest:
                    candidate = closest[0]
                    for k, v in canonical_actions.items():
                        if candidate == k or candidate == v:
                            matched = v
                            break

            if matched:
                action_to_store = matched

        if action_obj:
            if hasattr(action_obj, "action_code") and getattr(
                action_obj, "action_code"
            ):
                action_to_store = str(getattr(action_obj, "action_code"))
            elif hasattr(action_obj, "code") and getattr(action_obj, "code"):
                action_to_store = str(getattr(action_obj, "code"))
            elif hasattr(action_obj, "name") and getattr(action_obj, "name"):
                action_to_store = str(getattr(action_obj, "name"))
            else:
                action_to_store = str(action_obj)

        if action_code_raw and not action_to_store:
            return Response(
                {
                    "errors": {
                        "action_taken": f"Unknown action code/name '{action_code_raw}'."
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # If action_taken is not provided or null, set it to '-'
        if not action_to_store:
            action_to_store = "-"

        # Parse detected_at from user input (date and time parameters)
        detected_at = self._parse_dt(date_str, time_val)

        # Convert to Unix timestamp (double precision float)
        ts_timestamp = datetime_to_unix_timestamp(detected_at)

        # Extract start_ts from train_id (format: TYYYYMMDDHHMMSS)
        start_ts_timestamp = get_start_ts_from_train_id(train_id)

        side = "L" if side_raw in {"L", "LEFT"} else "R"
        side = "U" if side_raw in {"U", "UNDERCARRIAGE"} else side

        reference_defect = (
            DefectInfo.objects.filter(train_id=train_id, is_deleted=False)
            .order_by("-id")
            .first()
        )
        if reference_defect:
            mvis_train_speed = reference_defect.mvis_train_speed
            mvis_total_axles = reference_defect.mvis_total_axles
            dpu_id = reference_defect.dpu_id
            dfis_train_id = reference_defect.dfis_train_id
            loco_no = reference_defect.loco_no
            wagon_type = reference_defect.wagon_type
        else:
            mvis_train_speed = 0
            mvis_total_axles = 0
            dpu_id = "DPU_01"
            dfis_train_id = None
            loco_no = None
            wagon_type = "UNKNOWN"

        try:
            with transaction.atomic():
                defect = DefectInfo(
                    train_id=train_id,
                    tagged_wagon_id=wagon_position,
                    side=side,
                    defect_code=defect_code,
                    ts=ts_timestamp,
                    start_ts=start_ts_timestamp,
                    remarks="Manually added defect",
                    action_taken=action_to_store,
                    mvis_train_speed=mvis_train_speed,
                    mvis_total_axles=mvis_total_axles,
                    dpu_id=dpu_id,
                    dfis_train_id=dfis_train_id,
                    loco_no=loco_no,
                    wagon_type=wagon_type,
                    generated_by="manual",
                )

                if hasattr(defect, "wagon_id") and wagon_no:
                    defect.wagon_id = wagon_no
                if hasattr(defect, "wagon_no") and wagon_no:
                    defect.wagon_no = wagon_no

                if defect_image and hasattr(defect, "defect_image"):
                    defect.defect_image = defect_image
                    defect.save()

                    try:
                        original_name = os.path.basename(defect_image.name)
                        current_path = defect.defect_image.path
                        current_dir = os.path.dirname(current_path)
                        new_path = os.path.join(current_dir, original_name)

                        if os.path.exists(new_path):
                            base, ext = os.path.splitext(original_name)
                            i = 1
                            while True:
                                candidate = f"{base}_{i}{ext}"
                                candidate_path = os.path.join(current_dir, candidate)
                                if not os.path.exists(candidate_path):
                                    new_path = candidate_path
                                    original_name = candidate
                                    break
                                i += 1

                        if os.path.exists(current_path):
                            shutil.move(current_path, new_path)
                            # store only filename in DB (no directory)
                            defect.defect_image.name = original_name
                            defect.save(update_fields=["defect_image"])
                    except Exception as e:
                        logger.warning("File rename failed: %s", e)
                else:
                    defect.save()
        except (IntegrityError, DatabaseError) as e:
            logger.exception(
                "Database/validation error while creating defect: %s", str(e)
            )
            if defect_image and "defect" in locals():
                try:
                    if getattr(defect, "defect_image", None):
                        defect.defect_image.delete(save=False)
                except Exception:
                    logger.exception(
                        "Unexpected error while deleting defect image during cleanup"
                    )

            return Response(
                {
                    "error": "Defect creation failed due to a database error. Please contact support."
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "message": "Defect created successfully.",
                "train_id": defect.train_id,
                "train_date": detected_at.strftime("%d-%m-%Y"),
                "train_time": detected_at.strftime("%H:%M:%S"),
                "wagon_no": wagon_no or None,
                "wagon_position": defect.tagged_wagon_id,
                "side": defect.side,
                "defect_code": defect.defect_code,
                "defect_name": defect_type.name,
                "action_taken": defect.action_taken,
                "defect_image": (
                    os.path.basename(defect.defect_image.name)
                    if defect.defect_image
                    else None
                ),
            },
            status=status.HTTP_201_CREATED,
        )


# ViewSet for managing defect feedback attachments
class DefectFeedbackAttachmentViewSet(viewsets.ModelViewSet):
    queryset = DefectFeedbackAttachment.objects.all()
    serializer_class = DefectFeedbackAttachmentSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        queryset = super().get_queryset()
        defect_id = self.request.query_params.get("defect_id")
        if defect_id:
            queryset = queryset.filter(defect_id=defect_id)
        return queryset

    def perform_create(self, serializer):
        defect_id = self.request.data.get("defect")
        if not defect_id:
            raise exceptions.ValidationError({"defect": "This field is required."})

        try:
            defect = DefectInfo.objects.get(pk=defect_id)
        except DefectInfo.DoesNotExist:
            raise exceptions.ValidationError({"defect": "Defect does not exist."})

        # Get the uploaded file
        uploaded_file = self.request.FILES.get("file")
        if uploaded_file:
            # The original filename will be stored automatically by the upload_to function
            pass

        serializer.save()

    @action(
        detail=False,
        methods=["get"],
        url_path="download/(?P<uuid_ref>[^/.]+)",
        url_name="download-by-uuid",
    )
    def download_by_uuid(self, request, uuid_ref=None):
        """
        Download attachment file by UUID reference
        URL: /api/defects/defect-feedback-attachments/download/{uuid}/
        """
        if not uuid_ref:
            raise Http404("No UUID reference provided")

        try:
            # Find attachment by UUID reference
            attachment = DefectFeedbackAttachment.objects.get(uuid_reference=uuid_ref)
        except DefectFeedbackAttachment.DoesNotExist:
            raise Http404("Attachment not found")

        # Check if file exists
        if not attachment.file or not os.path.exists(attachment.file.path):
            raise Http404("File not found on disk")

        # Determine if user wants to view inline or download
        view_type = request.GET.get("view", "download")

        try:
            content_type, _ = mimetypes.guess_type(attachment.file.path)

            response = FileResponse(
                open(attachment.file.path, "rb"),
                content_type=content_type or "application/pdf",
            )

            if view_type == "inline":
                response["Content-Disposition"] = (
                    f'inline; filename="{attachment.original_filename}"'
                )
            else:
                response["Content-Disposition"] = (
                    f'attachment; filename="{attachment.original_filename}"'
                )

            return response

        except IOError:
            raise Http404("Error reading file")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context
