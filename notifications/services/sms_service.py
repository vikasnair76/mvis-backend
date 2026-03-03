"""
SMS Service to handle sending messages.
"""

import os
import logging
import requests
from typing import List

logger = logging.getLogger(__name__)


class SMSService:
    """Service for sending SMS messages."""

    def send_sms(self, recipients: List[str], message: str) -> dict:
        """
        Send SMS to a list of recipients.

        Args:
            recipients: List of formatted phone numbers (e.g., ["+919876543210"])
            message: The message content to send

        Returns:
            Dictionary with status and details
        """
        api_key = os.getenv("AOC_SMS_API_KEY")
        base_url = os.getenv("AOC_SMS_BASE_URL", "https://api.aoc-portal.com/v1/sms")

        if not api_key:
            logger.error("AOC_SMS_API_KEY not configured")
            return {"status": "error", "message": "SMS configuration missing"}

        headers = {"apiKey": api_key, "Content-Type": "application/json"}

        results = []
        for recipient in recipients:
            # Payload updated to match provider requirements:
            # - `to`: recipient number
            # - `text`: message content
            # - `sender`: "LMRAIL"
            # - `type`: "TRANS"
            payload = {
                "to": recipient,
                "text": message,
                "sender": "LMRAIL",
                "type": "TRANS",
            }

            try:
                logger.info(f"Sending SMS to {recipient}")
                response = requests.post(
                    base_url, json=payload, headers=headers, timeout=30
                )

                # Log response details
                try:
                    response_data = response.json()
                except ValueError:
                    response_data = response.text

                logger.info(f"AOC Response: {response.status_code} - {response_data}")

                status_msg = (
                    "success" if response.status_code in [200, 201] else "failed"
                )
                results.append(
                    {
                        "recipient": recipient,
                        "status": status_msg,
                        "details": response_data,
                        "sender": "LMRAIL",
                    }
                )
            except Exception as e:
                logger.error(f"Exception sending SMS to {recipient}: {e}")
                results.append(
                    {"recipient": recipient, "status": "error", "details": str(e)}
                )

        return {
            "status": "processed",
            "message": "SMS processing complete",
            "results": results,
            "count": len(recipients),
        }
