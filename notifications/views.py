from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework_api_key.permissions import HasAPIKey
import logging

logger = logging.getLogger(__name__)

from .serializers import SendSMSSerializer
from .services.sms_service import SMSService


class SendSMSView(APIView):
    """
    Endpoint to send SMS notifications.
    Requires a valid API Key.
    """

    permission_classes = [HasAPIKey]

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.sms_service = SMSService()

    def post(self, request):
        serializer = SendSMSSerializer(data=request.data)
        if serializer.is_valid():
            # Get validated data
            recipients = serializer.validated_data["phone_numbers"]
            message = serializer.validated_data["message"]

            # Use service to send SMS
            try:
                result = self.sms_service.send_sms(recipients, message)
                return Response(result, status=status.HTTP_200_OK)
            except Exception as e:
                logger.exception("Failed to send SMS to %d recipients", len(recipients))
                return Response(
                    {
                        "status": "error",
                        "message": "Failed to send SMS. Please try again later.",
                    },
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
