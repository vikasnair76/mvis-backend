from django.core.management.base import BaseCommand
import psycopg2
import select
import json
import os
import redis
import time
from datetime import datetime


class Command(BaseCommand):
    help = "Listen to PostgreSQL channel and broadcast events via Redis with history storage"

    def handle(self, *args, **options):
        self.stdout.write(
            "Listening for notifications on 'mvis_processed_info_channel' and 'mvis_alert_defect_channel'..."
        )
        conn_string = (
            f"dbname={os.getenv('DB_NAME')} "
            f"user={os.getenv('DB_USER')} "
            f"password={os.getenv('DB_PASSWORD')} "
            f"host={os.getenv('DB_HOST')} "
            f"port={os.getenv('DB_PORT')}"
        )

        conn = psycopg2.connect(conn_string)
        conn.autocommit = True

        with conn.cursor() as cur:
            cur.execute("LISTEN mvis_processed_info_channel;")
            cur.execute("LISTEN mvis_alert_defect_channel;")
            self.stdout.write("Connection established. Waiting for notifications...")
            while True:
                if select.select([conn], [], [], 60) == ([], [], []):
                    continue

                conn.poll()
                while conn.notifies:
                    notify = conn.notifies.pop(0)
                    try:
                        payload = json.loads(notify.payload)
                    except json.JSONDecodeError:
                        self.stderr.write(
                            f"Could not decode JSON payload: {notify.payload}"
                        )
                        continue
                    event_type = payload.get("event_type")
                    event_data = {
                        "event_type": event_type,
                        "payload": payload,
                        "timestamp": datetime.now().isoformat(),
                        "event_id": int(
                            time.time() * 1000
                        ),  # Unique ID based on timestamp
                    }
                    alert_data = {
                        **payload,
                        "timestamp": datetime.now().isoformat(),
                        "event_id": int(time.time() * 1000),
                    }
                    redis_client = redis.Redis(
                        host=os.getenv("REDIS_HOST"),
                        port=int(os.getenv("REDIS_PORT")),
                        db=int(os.getenv("REDIS_DB")),
                        password=os.getenv("REDIS_PASSWORD"),
                        decode_responses=True,
                    )
                    
                    # Extract dpu_id for location-specific channels
                    dpu_id = payload.get("data", {}).get("dpu_id") or payload.get("dpu_id")
                    
                    if event_type == "new_defect":
                        # Publish to global channel (backward compatible)
                        redis_client.publish("defect-events", json.dumps(event_data))
                        redis_client.lpush("defect-events-history", json.dumps(event_data))
                        redis_client.ltrim("defect-events-history", 0, 99)
                        # Publish to location-specific channel
                        if dpu_id:
                            redis_client.publish(f"defect-events:{dpu_id}", json.dumps(event_data))
                            redis_client.lpush(f"defect-events-history:{dpu_id}", json.dumps(event_data))
                            redis_client.ltrim(f"defect-events-history:{dpu_id}", 0, 99)
                    elif event_type == "alert_defect":
                        # Publish to global channel (backward compatible)
                        redis_client.publish("alert-defect-events", json.dumps(alert_data))
                        redis_client.lpush("alert-defect-events-history", json.dumps(alert_data))
                        redis_client.ltrim("alert-defect-events-history", 0, 99)
                        # Publish to location-specific channel
                        if dpu_id:
                            redis_client.publish(f"alert-defect-events:{dpu_id}", json.dumps(alert_data))
                            redis_client.lpush(f"alert-defect-events-history:{dpu_id}", json.dumps(alert_data))
                            redis_client.ltrim(f"alert-defect-events-history:{dpu_id}", 0, 99)
                    elif event_type == "train_update":
                        # Publish to global channel (backward compatible)
                        redis_client.publish("train-events", json.dumps(event_data))
                        redis_client.lpush("train-events-history", json.dumps(event_data))
                        redis_client.ltrim("train-events-history", 0, 99)
                        # Publish to location-specific channel
                        if dpu_id:
                            redis_client.publish(f"train-events:{dpu_id}", json.dumps(event_data))
                            redis_client.lpush(f"train-events-history:{dpu_id}", json.dumps(event_data))
                            redis_client.ltrim(f"train-events-history:{dpu_id}", 0, 99)
                    else:
                        self.stderr.write(
                            f"Unknown event_type '{event_type}' received. Not published."
                        )

