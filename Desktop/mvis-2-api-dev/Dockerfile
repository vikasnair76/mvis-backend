# Build stage
FROM python:3.8-slim AS builder

WORKDIR /app

# Install system dependencies needed for building
RUN apt-get update && apt-get install -y \
    libpq-dev gcc build-essential && \
    rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --user --no-cache-dir -r requirements.txt

# Production stage
FROM python:3.8-slim AS production

WORKDIR /app
ENV PYTHONUNBUFFERED=1

# Install runtime system dependencies
RUN apt-get update && apt-get install -y \
    libpq-dev postgresql-client && \
    rm -rf /var/lib/apt/lists/*

# Copy Python dependencies from builder stage
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

# Copy application code
COPY . /app/

# Create necessary directories
RUN mkdir -p /app/static /app/media /app/logs

# Expose the port
ENV WEB_PORT=${WEB_PORT:-8000}
EXPOSE ${WEB_PORT}

# Default command for production
CMD ["sh", "-c", "python manage.py collectstatic --noinput && gunicorn cbs_cloud.wsgi:application --bind 0.0.0.0:${WEB_PORT} --workers 4 --timeout 120 --max-requests 1000 --max-requests-jitter 50 --preload"]

# Development stage
FROM production AS development

# Override for development - no need to copy again since we inherit from production
# The volume mount in docker-compose will override the copied files anyway

# Default command for development (will be overridden by docker-compose)
CMD ["sh", "-c", "python manage.py collectstatic --noinput && python manage.py runserver 0.0.0.0:${WEB_PORT:-8000}"]
