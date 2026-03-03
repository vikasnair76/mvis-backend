from django.urls import path
from .views import SendSMSView

app_name = "notifications"

urlpatterns = [
    path("send-sms/", SendSMSView.as_view(), name="send-sms"),
]
