"""
Validators for defect-related operations.
Provides validation for dpu_id and defect_code combinations.
"""
from typing import List, Optional
from rest_framework.exceptions import ValidationError


def get_valid_defect_codes_for_dpu(dpu_id: str) -> List[str]:
    """
    Get all valid defect codes for a given dpu_id.
    
    Args:
        dpu_id: The DPU identifier (e.g., 'MVIS_DPU_DDU', 'MVIS_DPU_DAQN')
        
    Returns:
        List of valid defect codes for the specified dpu_id
    """
    from defects.models import DefectLocation
    
    return list(DefectLocation.objects.filter(
        dpu_id=dpu_id
    ).values_list('defect_code', flat=True))


def is_defect_valid_for_dpu(defect_code: str, dpu_id: str) -> bool:
    """
    Check if a defect code is valid for a given dpu_id.
    
    Args:
        defect_code: The defect code to validate
        dpu_id: The DPU identifier
        
    Returns:
        True if the defect code is valid for the dpu_id, False otherwise
    """
    from defects.models import DefectLocation
    
    return DefectLocation.objects.filter(
        defect_code=defect_code,
        dpu_id=dpu_id
    ).exists()


def validate_dpu_id(dpu_id: str) -> None:
    """
    Validate that a dpu_id exists in the system.
    
    Args:
        dpu_id: The DPU identifier to validate
        
    Raises:
        ValidationError: If the dpu_id doesn't exist
    """
    from defects.models import DefectLocation
    
    if not DefectLocation.objects.filter(dpu_id=dpu_id).exists():
        raise ValidationError({
            "dpu_id": f"Invalid dpu_id: '{dpu_id}'. No defect locations found for this DPU."
        })


def validate_defect_code_for_dpu(defect_code: str, dpu_id: str) -> None:
    """
    Validate that a defect code is valid for a given dpu_id.
    
    Args:
        defect_code: The defect code to validate
        dpu_id: The DPU identifier
        
    Raises:
        ValidationError: If the defect code is not valid for the dpu_id
    """
    if not is_defect_valid_for_dpu(defect_code, dpu_id):
        raise ValidationError({
            "defect_code": f"Defect code '{defect_code}' is not valid for dpu_id '{dpu_id}'."
        })


def get_dpu_id_from_request(request, required: bool = False) -> Optional[str]:
    """
    Extract dpu_id from request query parameters.
    
    Args:
        request: The Django request object
        required: If True, raises ValidationError when dpu_id is not provided
        
    Returns:
        The dpu_id string or None if not provided and not required
        
    Raises:
        ValidationError: If required=True and dpu_id is not provided
    """
    dpu_id = request.GET.get('location_id') or request.query_params.get('location_id')
    
    if not dpu_id and required:
        raise ValidationError({
            "location_id": "location_id query parameter is required."
        })
    
    # Note: We don't validate that dpu_id exists in defect_locations
    # because trains can have dpu_ids that don't have defect mappings
        
    return dpu_id
