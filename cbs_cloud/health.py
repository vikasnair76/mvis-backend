"""
Health check endpoint for monitoring and load balancers.
"""
from django.http import JsonResponse
from django.db import connection
from django.core.cache import cache
from django.conf import settings
import time


def health_check(request):
    """
    Comprehensive health check endpoint that verifies:
    - API is responding
    - Database connectivity
    - Cache connectivity (if configured)
    
    Returns:
    - 200 OK if all checks pass
    - 503 Service Unavailable if any critical check fails
    """
    health_status = {
        "status": "healthy",
        "timestamp": time.time(),
        "checks": {}
    }
    
    overall_healthy = True
    
    # Database connectivity check
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        health_status["checks"]["database"] = {
            "status": "healthy",
            "message": "Database connection successful"
        }
    except Exception as e:
        overall_healthy = False
        health_status["checks"]["database"] = {
            "status": "unhealthy",
            "message": f"Database connection failed: {str(e)}"
        }
    
    # Cache connectivity check (optional, only if cache is configured)
    try:
        cache_key = "health_check_test"
        cache.set(cache_key, "test", 10)
        cache_value = cache.get(cache_key)
        if cache_value == "test":
            health_status["checks"]["cache"] = {
                "status": "healthy",
                "message": "Cache connection successful"
            }
        else:
            health_status["checks"]["cache"] = {
                "status": "warning",
                "message": "Cache read/write inconsistent"
            }
    except Exception as e:
        # Cache failures are not critical, just warning
        health_status["checks"]["cache"] = {
            "status": "warning",
            "message": f"Cache check failed: {str(e)}"
        }
    
    # Update overall status
    if not overall_healthy:
        health_status["status"] = "unhealthy"
        return JsonResponse(health_status, status=503)
    
    return JsonResponse(health_status, status=200)


def readiness_check(request):
    """
    Readiness check for Kubernetes/container orchestration.
    Returns 200 if the service is ready to accept traffic.
    """
    try:
        # Check database connectivity
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        
        return JsonResponse({
            "status": "ready",
            "timestamp": time.time()
        }, status=200)
    except Exception as e:
        return JsonResponse({
            "status": "not ready",
            "message": str(e),
            "timestamp": time.time()
        }, status=503)


def liveness_check(request):
    """
    Liveness check for Kubernetes/container orchestration.
    Returns 200 if the service is alive (even if not fully ready).
    """
    return JsonResponse({
        "status": "alive",
        "timestamp": time.time()
    }, status=200)
