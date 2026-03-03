# MVIS Backend (Django REST API)

Backend service for the MVIS system built with **Django**.  
This repository contains multiple Django apps (alerts, defects, notifications, reports, trains) and provides REST APIs for the MVIS platform.

## Tech Stack
- Python, Django
- Django REST Framework
- PostgreSQL (via Docker Compose)
- Docker / Docker Compose

## Project Structure
- `manage.py` — Django entry point
- `requirements.txt` — Python dependencies
- `docker-compose.yml` — local containers (app + db)
- `Dockerfile` — backend image build
- Apps:
  - `alerts/`
  - `defects/`
  - `notifications/`
  - `reports/`
  - `trains/`
  - `cbs/`, `cbs_cloud/` (project configs/modules)

## Run Locally (without Docker)

### 1) Create venv + install deps
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt


### 2) Environment variables
Create a .env file (do not commit it).
Use .env.example as reference if needed.

### 3) Migrate + run
python3 manage.py migrate
python3 manage.py runserver

### Server:
http://127.0.0.1:8000/
