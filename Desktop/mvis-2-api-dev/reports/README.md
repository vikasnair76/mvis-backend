# Reports App

This Django app provides reporting endpoints for the MVIS system.

## API Endpoints

### Summary Report

**URL:** `/api/reports/summary-report/`
**Method:** `GET`
**Authentication:** Required

#### Parameters

- `start_date` (required): Start date in YYYY-MM-DD format (inclusive)
- `end_date` (required): End date in YYYY-MM-DD format (inclusive)

#### Example Request

```
GET /api/reports/summary-report/?start_date=2025-05-01&end_date=2025-05-02
```

#### Example Response

```json
{
  "summary": {
    "total_trains": 28,
    "total_wagons": 150,
    "total_defects": 45,
    "total_true_alerts": 30,
    "total_false_alerts": 15
  },
  "defect_breakdown": [
    {
      "defect_code": "D001",
      "defect_name": "Brake Shoe Defect",
      "defect_count": 10,
      "true_alerts": 8,
      "false_alerts": 2,
      "total_units": 300.0
    }
  ]
}
```

#### Error Responses

- `400 Bad Request`: Missing or invalid date parameters
- `500 Internal Server Error`: Database error

## Database Dependencies

This app relies on the following database tables:

- `mvis_processed_info`: Main processed information table
- `mvis_left_wagon_info`: Wagon information table
- `defect_types`: Defect types configuration table

## SQL Query Structure

The endpoint uses a complex SQL query with CTEs (Common Table Expressions) to:

1. Calculate defect statistics by type
2. Count total wagons in the date range
3. Count total trains in the date range
4. Return consolidated JSON response

## Installation

1. Add `'reports'` to `INSTALLED_APPS` in settings.py
2. Include `path('api/reports/', include('reports.urls'))` in main urls.py
3. Run migrations if needed (currently no models in this app)
