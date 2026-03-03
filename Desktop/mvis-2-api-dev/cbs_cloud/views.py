"""
Image serving view for the MVIS API.
Serves images from MEDIA_ROOT/images directory.
"""
import os
import mimetypes
import logging
from django.http import FileResponse, Http404
from django.views import View
from django.conf import settings

logger = logging.getLogger(__name__)


class ServeImageView(View):
    """
    Serves images from the MEDIA_ROOT/images directory.
    
    Usage: GET /api/images/<image_name>
    
    Images are expected to be in the 'images' subfolder within MEDIA_ROOT.
    MEDIA_ROOT is configured via the .env file.
    """

    def get(self, request, image_name):
        """
        Serve an image file by name.
        
        Args:
            request: HTTP request object
            image_name: Name of the image file to serve
            
        Returns:
            FileResponse with the image content or 404 if not found
        """
        # Get MEDIA_ROOT from settings
        media_root = getattr(settings, 'MEDIA_ROOT', '')
        
        # Images are stored in 'images' subfolder within MEDIA_ROOT
        images_dir = os.path.join(media_root, 'images') if media_root else 'images'
        
        # Build full path to the image
        full_path = os.path.join(images_dir, image_name)
        
        # Security check: prevent directory traversal
        allowed_dir = os.path.normpath(os.path.realpath(images_dir))
        real_path = os.path.normpath(os.path.realpath(full_path))
        
        print(f"DEBUG: allowed_dir={allowed_dir}")
        print(f"DEBUG: real_path={real_path}")
        
        if not real_path.startswith(allowed_dir):
            logger.warning(f"Directory traversal attempt detected: {image_name}")
            raise Http404("Image not found")
        
        # Check if file exists
        if not os.path.isfile(full_path):
            logger.debug(f"Image not found: {full_path}")
            raise Http404("Image not found")
        
        # Determine content type
        content_type, _ = mimetypes.guess_type(image_name)
        if content_type is None:
            content_type = 'application/octet-stream'
        
        try:
            response = FileResponse(open(full_path, 'rb'), content_type=content_type)
            response['Content-Disposition'] = f'inline; filename="{image_name}"'
            # Add caching headers for better performance
            response['Cache-Control'] = 'public, max-age=86400'  # Cache for 24 hours
            return response
        except IOError as e:
            logger.error(f"Error reading image file {full_path}: {e}")
            raise Http404("Image not found")
