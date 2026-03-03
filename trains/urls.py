from django.urls import path
from .views import (
    TrainDetailView,
    TrainWagonListView,
    TrainWagonDetailView,
    train_event_stream,
)

urlpatterns = [
    path("event-stream/", train_event_stream, name="train_event_stream"),
    path("<str:train_id>/", TrainDetailView.as_view(), name="train_detail"),
    path("<str:train_id>/wagons/", TrainWagonListView.as_view(), name="train_wagons"),
    path(
        "<str:train_id>/wagons/<str:wagon_position>/",
        TrainWagonDetailView.as_view(),
        name="train_wagon_detail",
    ),
]
