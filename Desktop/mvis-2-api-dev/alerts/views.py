import os
import json
import time
import redis
from django.http import StreamingHttpResponse


def alert_defect_sse_view(request):
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
            channel = f"alert-defect-events:{location_id}" if location_id else "alert-defect-events"

            redis_client = redis.Redis(
                host=os.getenv("REDIS_HOST"),
                port=int(os.getenv("REDIS_PORT")),
                db=int(os.getenv("REDIS_DB")),
                password=os.getenv("REDIS_PASSWORD"),
                decode_responses=True,
                socket_timeout=10,
                socket_connect_timeout=5,
            )

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

                                # Only stream alert defect events
                                if event_type == "alert_defect":
                                    event_id = event_data.get("event_id")
                                    if event_id is None:
                                        event_id = int(time.time() * 1000)

                                    # Use the entire event_data as-is, including nested structure
                                    yield f"event_id: {event_id}\n".encode("utf-8")
                                    yield f"event_type: {event_type}\n".encode("utf-8")
                                    yield f"data: {event_data}\n\n".encode("utf-8")
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
