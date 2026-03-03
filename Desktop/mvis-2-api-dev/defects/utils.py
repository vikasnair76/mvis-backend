import uuid
import os
from datetime import datetime, timedelta, timezone as dt_timezone
from django.utils import timezone

try:
    import pytz

    IST = pytz.timezone("Asia/Kolkata")
except ImportError:
    IST = None


def defect_feedback_upload_to(instance, filename):
    """
    Save file with original filename, generate UUID reference for API access
    """
    # Store original filename in the model
    if hasattr(instance, "original_filename"):
        instance.original_filename = filename
    else:
        # Set it directly if not already set
        instance.original_filename = filename

    # Save with original filename in defect_feedback folder
    return os.path.join("defect_feedback/", filename)


def get_start_ts_from_train_id(train_id):
    """
    Extract start_ts (Unix timestamp as double precision) from train_id.

    Train ID format: TYYYYMMDDHHMMSS (in Indian Standard Time - IST)
    Example: T20251031143050 represents 2025-10-31 14:30:50 IST

    Args:
        train_id (str): Train ID in format TYYYYMMDDHHMMSS

    Returns:
        float: Unix timestamp (double precision) representing the date/time part of train_id
               in IST timezone. Returns 0.0 if train_id format is invalid
    """
    if not train_id or len(train_id) < 15:
        return 0.0

    try:
        # Remove 'T' prefix and extract YYYYMMDDHHMMSS part
        time_part = train_id[1:15]  # Get 14 characters after 'T'

        # Parse the datetime string as IST
        dt_naive = datetime.strptime(time_part, "%Y%m%d%H%M%S")

        # Make it timezone-aware in IST (Indian Standard Time)
        if IST is not None:
            # Use pytz for proper timezone handling
            dt_aware = IST.localize(dt_naive)
        else:
            # Fallback: use manual IST offset (UTC+5:30)
            ist_offset = dt_timezone(timedelta(hours=5, minutes=30))
            dt_aware = dt_naive.replace(tzinfo=ist_offset)

        # Convert to Unix timestamp (double precision float)
        timestamp = dt_aware.timestamp()

        return float(timestamp)
    except (ValueError, IndexError, AttributeError, TypeError):
        return 0.0


def datetime_to_unix_timestamp(dt):
    """
    Convert a datetime object to Unix timestamp (double precision float).
    Assumes input datetime is in Indian Standard Time (IST) if naive.

    Args:
        dt (datetime): Datetime object to convert

    Returns:
        float: Unix timestamp (double precision) in seconds since epoch
               Returns 0.0 if dt is None or invalid
    """
    if dt is None:
        return 0.0

    try:
        # If datetime is naive, assume Indian Standard Time (IST - UTC+5:30)
        if dt.tzinfo is None:
            if IST is not None:
                # Use pytz for proper timezone handling
                dt = IST.localize(dt)
            else:
                # Fallback: add IST offset manually (UTC+5:30)
                ist_offset = dt_timezone(timedelta(hours=5, minutes=30))
                dt = dt.replace(tzinfo=ist_offset)

        # Convert to Unix timestamp (double precision float)
        timestamp = dt.timestamp()
        return float(timestamp)
    except (AttributeError, TypeError):
        return 0.0
