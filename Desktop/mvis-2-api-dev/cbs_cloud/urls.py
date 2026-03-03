from django.contrib import admin
from django.urls import path, include
from cbs.views.views import *
from django.contrib.auth import views
from django.conf import settings
from django.conf.urls.static import static
from rest_framework_simplejwt.views import TokenRefreshView
from .views import ServeImageView
from .health import health_check, readiness_check, liveness_check

urlpatterns = [
    path("admin/", admin.site.urls),
    # Health check endpoints
    path("health/", health_check, name="health_check"),
    path("health/readiness/", readiness_check, name="readiness_check"),
    path("health/liveness/", liveness_check, name="liveness_check"),
    # API endpoints
    path("api/images/<path:image_name>", ServeImageView.as_view(), name="serve_image"),
    path("cbs/", include("cbs.urls")),
    path("api-auth/", include("rest_framework.urls")),
    path(
        "api/mvis_update_feedback",
        mvis_update_feedback.as_view(),
        name="api/mvis_update_feedback",
    ),
    path(
        "api/mvis_update_field_report",
        mvis_update_field_report.as_view(),
        name="api/mvis_update_field_report",
    ),
    path(
        "api/mvis_update_missed_info",
        mvis_update_missed_info.as_view(),
        name="api/mvis_update_missed_info",
    ),
    path("api/train_wise", train_wise.as_view(), name="api/train_wise"),
    path("api/auth/login", LoginView.as_view(), name="api/auth/login"),
    path("api/auth/refresh", TokenRefreshView.as_view(), name="api/auth/refresh"),
    path("api/defects/", include("defects.urls")),
    path("api/trains/", include("trains.urls")),
    path("api/", index, name="index"),
    path("api/reports/", include("reports.urls")),
    path("api/alerts/", include("alerts.urls")),
    path("api/notifications/", include("notifications.urls")),
]

urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
