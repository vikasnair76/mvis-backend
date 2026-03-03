from django.urls import path
from . import views

urlpatterns = [path("event-stream/", views.alert_defect_sse_view, name="alert-stream")]
