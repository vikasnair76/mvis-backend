from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    DefectTypeViewSet,
    DefectCategoryViewSet,
    DefectViewSet,
    DefectInfoDetail,
    LatestDefectInfo,
    sse_view,
    DefectFeedbackAttachmentViewSet,
)
from django_eventstream import urls as eventstream_urls
from django_eventstream import get_current_event_id

# Router setup
router = DefaultRouter()
router.register(r"types", DefectTypeViewSet, basename="defecttype")
router.register(r"categories", DefectCategoryViewSet, basename="defectcategory")
router.register(
    r"defect-feedback-attachments",
    DefectFeedbackAttachmentViewSet,
    basename="defect-feedback-attachment",
)
router.register(r"", DefectViewSet, basename="defects")

app_name = "defects"

urlpatterns = [
    path("latest/", LatestDefectInfo.as_view(), name="defectinfo-latest"),
    path("<int:pk>/", DefectInfoDetail.as_view(), name="defectinfo-detail"),
    path("", include(router.urls)),
    path("event-stream/", sse_view, name="event-stream"),
]
