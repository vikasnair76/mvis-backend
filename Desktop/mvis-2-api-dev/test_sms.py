import requests


def test_endpoint(api_key):
    url = "http://159.89.172.99:8000/api/notifications/send-sms/"
    headers = {
        "Authorization": f"Api-Key {api_key}",
        "Content-Type": "application/json",
    }
    data = {"phone_numbers": "7892243922", "message": "Message: 1 of 1 MVIS Alert Site: DFCC_DAQN Train ID: T20250609081030 Entry Time: 09-06-2025 08:10:30 Direction:  Speed: 39.8km/h Total Axles: 484 Total MVIS Alerts: H-0 E-0 . - L2MRail.com"}

    try:
        response = requests.post(url, json=data, headers=headers)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text}")
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        test_endpoint(sys.argv[1])
    else:
        print("Usage: python test_sms.py <API_KEY>")
