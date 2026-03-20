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

### Check: would `contentSource=MOTOR` fix missing parts? (Ford / GM / Nissan IDs)

Vehicle IDs are **per catalog** (Ford string IDs, GM model + `motorVehicleId`, Nissan codes, MOTOR `modelId:engineId`).  
Calling `/parts` with the same path ID under `MOTOR` does **not** substitute OEM coverage.

```bash
python check_motor_source_fallback.py --year 2010 --with-control
```

`--with-control` prints a **Toyota** row first: native catalog `MOTOR` and `source=MOTOR` should both return **200** when the ID is a real MOTOR engine id. Problem makes typically show **same error** for native vs `MOTOR` (e.g. both **500**), i.e. no fallback.

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

## M1 frontend query parity

`client.py` / `crawler.py` follow the same **query conventions** as the M1 web client documented in **`vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md`**:

- `searchTerm` (often `""`) on **articles/v2**, **parts**, **maintenance** routes, and **labor** (already required there).
- **Maintenance frequency**: one request per **`frequencyTypeCode`** — `F`, `N`, `R` (Fixed / Normal / Severe-style schedules in the UI), merged into one JSON object keyed by code.
- **Maintenance indicators** endpoint (same as M1 `MaintenanceSchedulesFacade.searchByIndicators`).
- **Labor**: only articles with IDs like **`L:…`**; placeholder IDs **`-997` / `-998` / `-999`** are never sent to the labor API (per M1 assets behavior).

## Data Silos (per vehicle)

| File | Source | Description |
|------|--------|-------------|
| `articles_v2.json` | API | Full article catalog with filterTabs |
| `procedures.json` | Extracted from articles | Procedures & Labor bucket articles |
| `wiring_diagrams.json` | Extracted from articles | Wiring diagram articles |
| `component_locations.json` | Extracted from articles | Component location articles |
| `labor.json` | API (per article) | Labor data for up to `max_labor_per_vehicle` **`L:`** articles |
| `fluids.json` | API | Fluid specs (404 = no data) |
| `parts.json` | API | Parts catalog |
| `dtcs.json` | API | DTC summaries (when returned) |
| `tsbs.json` | API | TSB summaries (when returned) |
| `maintenance_indicators.json` | API | Schedule indicators (when returned) |
| `maintenance_frequency.json` | API | Object keyed by `F` / `N` / `R` — one frequency response per type |
| `maintenance_intervals.json` | API | Maintenance by interval (e.g. Miles 5000) |

## GM Routing (GeneralMotors)

For `contentSource: GeneralMotors`, the crawler uses:
- **Path**: model ID (e.g. `3296`)
- **Query**: `motorVehicleId` from `/api/source/{source}/{modelId}/motorvehicles`

This matches the swagger spec and M1 UI behavior.

## API Specification

Endpoints follow **`oldfiles/documentation/vehapiproxi/swagger.yaml`** (Vehicle Service API v1.15+).

## M1 ↔ api.motor.com Mapping

See **[M1_TO_MOTOR_API_MAPPING.md](M1_TO_MOTOR_API_MAPPING.md)** for:
- Chek-Chart → M1 path mapping (used by proxy)
- Vehicle ID format differences (M1 vs Swagger)
- Content endpoint equivalents
