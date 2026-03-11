# Motor M1 Data Crawler

A Python-based tool to crawl and map the data hierarchy provided by the Motor M1 connector.

## Setup

1. **Install Python 3.10+**
2. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

### Option A: HTTP crawler (direct API)
```bash
python crawler.py
```

### Option B: Browser-based endpoint mapper (recommended for discovering correct flow)

Uses a headless browser to click through the actual M1 interface, capture API traffic, and map endpoints. Useful when the API flow is unclear or endpoints return 500.

```bash
pip install playwright
playwright install chromium
python browser_mapper.py
```

Output: `data/browser_mapped/capture_*.jsonl` (raw requests/responses) and `endpoints_*.json` (extracted endpoint map).

Set `BROWSER_HEADED=1` to watch the browser. Set `EBSCO_LOGIN_URL` if using different auth.

---

The crawler will:
1.  **Authenticate** via EBSCO using library credentials.
2.  **Traverse** years and all available makes.
3.  **Sample** a model for each make to capture data formats.
4.  **Save** JSON files to the `data/` directory.

## Directory Structure
- `auth.py`: Handles session establishment.
- `browser_mapper.py`: Headless browser mapper—clicks through M1 UI, captures API traffic, maps endpoints.
- `client.py`: M1 API endpoint wrapper.
- `crawler.py`: Main traversal and storage logic.
- `error_log.py`: Centralized error logging for diagnosis.
- `crawler_errors.log`: JSON-lines file of all errors for later diagnosis.
- `data/`: Extracted JSON payloads.
- `data/browser_mapped/`: Browser mapper output (captures, endpoint maps).

## Data Silos (per vehicle)

| File | Source | Description |
|------|--------|-------------|
| `articles_v2.json` | API | Full article catalog with filterTabs |
| `procedures.json` | Extracted from articles | Procedures & Labor bucket articles |
| `wiring_diagrams.json` | Extracted from articles | Wiring diagram articles |
| `component_locations.json` | Extracted from articles | Component location articles |
| `labor.json` | API (per article) | Labor data for first 15 procedures (500 treated as no-data) |
| `fluids.json` | API | Fluid specs (404 = no data) |
| `parts.json` | API | Parts catalog |
| `maintenance_frequency.json` | API | Maintenance by frequency |
| `maintenance_intervals.json` | API | Maintenance by interval (Miles) |

## GM Routing (GeneralMotors)

For `contentSource: GeneralMotors`, the crawler uses:
- **Path**: model ID (e.g. `3296`)
- **Query**: `motorVehicleId` from `/api/source/{source}/{modelId}/motorvehicles`

This matches the swagger spec and M1 UI behavior.

## API Specification

Endpoints follow **`documentation/vehapiproxi/swagger.yaml`** (Vehicle Service API v1.15+).

## M1 ↔ api.motor.com Mapping

See **[M1_TO_MOTOR_API_MAPPING.md](M1_TO_MOTOR_API_MAPPING.md)** for:
- Chek-Chart → M1 path mapping (used by proxy)
- Vehicle ID format differences (M1 vs Swagger)
- Content endpoint equivalents
