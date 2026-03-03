# cbs_cloud/wsgi.py

# IMPORTANT: These patches must be at the very top, before any other imports.
from gevent import monkey

monkey.patch_all()

from psycogreen.gevent import patch_psycopg

patch_psycopg()

# --- The rest of your original file ---
import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cbs_cloud.settings")

application = get_wsgi_application()
