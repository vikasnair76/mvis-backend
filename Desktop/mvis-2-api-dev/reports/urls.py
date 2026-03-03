from django.urls import path
from . import views

urlpatterns = [
    path("summary-report/", views.summary_report, name="summary_report"),
    path("consolidated-report/", views.consolidated_report, name="consolidated_report"),
]
