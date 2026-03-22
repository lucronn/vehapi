---
name: vehicle-data-normalization-migration
description: Transforms dynamic vehicle service information and procedures from the Motor API into a standardized, structured format in Supabase. Improves and extends the existing normalization pipeline so all data is retained, transformed efficiently and accurately, and structured for easy access and frontend consumption. Use when working on API-to-Supabase migration, data normalization, vehicle procedures, DTCs, TSBs, specs, or frontend data shape.
---

# Vehicle Data Normalization & Migration Agent

## Purpose

This skill guides the agent to:

- **Transform** dynamic API responses (Motor vehicle service data: procedures, DTCs, TSBs, specs, articles) into a **standardized structured format** in Supabase.
- **Improve** the existing normalization pipeline (proxy background worker, sync services, schema) so it is more complete, correct, and maintainable.
- **Retain all data**: ensure no API fields are dropped; use nullable/optional and JSON columns where needed.
- **Optimize** for efficiency (batching, upsert strategy, dedup, lazy vs eager sync) and for **frontend consumption** (clear shapes, section strategies, mappers).

The process is already started: proxy enqueues parsing, normalizes by schema type, and upserts into Supabase; frontend reads Supabase-first then falls back to API. The agent improves and extends this flow.

---

## When to Use This Skill

Use this skill when:

- The user asks to **normalize**, **migrate**, or **transform** vehicle/API data into Supabase.
- Working on **vehicle service information**, **procedures**, **DTCs**, **TSBs**, **specs**, or **articles** and how they are stored or consumed.
- Improving **data retention** (missing fields, lost content), **accuracy** (wrong mapping, bad AI output), or **structure** (categories, keys, indexes) for Supabase.
- Making the pipeline **more efficient** (batch inserts, conflict handling, sync strategy) or **easier for frontends** (consistent shapes, section strategies, mappers).
- Debugging or extending the **background worker**, **AI parser**, **Supabase insert** logic, or **VehicleDataService** / **DataSyncService** in relation to normalized data.

---

## Key Artifacts (This Project)

| Area | Location | Role |
|------|----------|------|
| **Normalized contract** | `src/models/normalized_schema.ts` | TypeScript interfaces for Supabase tables (NormalizedProcedure, NormalizedDTC, NormalizedTSB, etc.). Single source of truth for shape; keep in sync with DB and proxy. |
| **Proxy: schema detection & flow** | `vehapiproxi/src/background_worker.js` | `determineSchemaType(urlPath)`, `extractVehicleId`, `extractExternalId`, `normalizeForSupabase()`, `enqueueParsingTask`, `processTaskImmediate`. |
| **Proxy: persistence** | `vehapiproxi/src/supabase.js` | `insertParsedData(table, data)`, `UPSERT_CONFLICT_COLUMNS` per table (procedures: `vehicle_id,external_id`; articles: `vehicle_id,original_id`), `wasAlreadyParsed`, `insertMetadata`, `getVehicleArticles`. |
| **Proxy: AI output shape** | `vehapiproxi/src/ai_parser.js` | `SCHEMAS` for dtcs, tsbs, procedures, specifications. Must align with normalized_schema and normalizeForSupabase. |
| **Frontend: read path** | `src/services/vehicle-data.service.ts` | Section strategies (dtcs, tsbs, procedures, diagrams, etc.), mappers from Supabase/API rows to `Dtc`, `Tsb`, `Procedure`. Section lists currently use the **articles** table only; single-article content may come from procedures/dtcs/tsbs via proxy cache. Supabase-first, then API fallback. |
| **Frontend: sync** | `src/services/data-sync.service.ts` | `syncFullVehicle`, `syncSingleArticle`, fluids/maintenance sync; writes to `vehicles`, `articles`, `common_issues_cache`, specs. Articles use `original_id` (no client-generated id); upsert conflict `vehicle_id,original_id`. |
| **Frontend models** | `src/models/motor.models.ts` | `Procedure`, `Dtc`, `Tsb`, etc. Used by UI; mappers must produce these from normalized/Supabase rows. |

**Schema note:** The DB was migrated to match `supabase_schema.sql`: procedures use **vehicle_id + external_id** (one row per Motor article); articles use **original_id**; specifications include unit/display_text/metadata; parts and maintenance_schedules have correct uniques. Conflict keys are in `vehapiproxi/src/supabase.js` (`UPSERT_CONFLICT_COLUMNS`).

Keep the chain consistent: **API → (optional AI parse) → normalize → Supabase** and **Supabase → mapper → frontend model**.

---

## Principles

1. **Retain all data**
   - Do not drop API fields in the transform. Prefer adding columns or a small JSON `metadata`/`raw` field over losing information.
   - In `normalizeForSupabase`, use safe defaults (empty array, null) for missing optional fields; never strip known fields from the schema.

2. **Accurate transformation**
   - Map API field names and nested structures to the normalized schema explicitly (see `normalized_schema.ts`).
   - Align `ai_parser.js` SCHEMAS and `normalizeForSupabase` with the same types (e.g. procedures: steps, tools_required, parts_required).
   - Validate or coerce types (dates → ISO, numbers → number or null) in one place (normalize step).

3. **Efficient pipeline**
   - Use upsert with correct `on_conflict` keys (see `UPSERT_CONFLICT_COLUMNS` in supabase.js) to avoid duplicates and allow re-runs.
   - Skip already-parsed content when appropriate (`wasAlreadyParsed` by source path; existing article by vehicle_id + original_id).
   - Prefer batching inserts where the API and Supabase client allow.

4. **Structured for access**
   - Use stable `vehicle_id` and `external_id` (or equivalent) so frontends can query by vehicle and dedupe.
   - Use categories/buckets and parent buckets where the UI groups by section (e.g. procedures by bucket).
   - Consider indexes or views for common filters (vehicle_id, bucket, category).

5. **Ease of frontend consumption**
   - Keep Supabase column names and shapes consistent with `VehicleDataService` section strategies and mappers.
   - When adding or changing normalized fields, update the corresponding mapper and, if needed, `motor.models.ts` so the UI gets the right shape without ad-hoc parsing.

---

## Workflow for Improvements

1. **Understand the data**
   - Identify source: Motor API response shape (e.g. articles/v2, article HTML, DTC/TSB endpoints).
   - Identify target: which Supabase table(s) and which normalized_schema interface(s).
   - Note current path: URL → schema type (background_worker) → AI parse (if any) → normalize → insert.

2. **Compare contract vs reality**
   - Ensure `normalized_schema.ts` matches actual Supabase columns (and vice versa if you change schema).
   - Ensure `normalizeForSupabase` and AI SCHEMAS produce that shape; list any missing or wrongly mapped fields.

3. **Design the change**
   - Retention: which new fields or metadata to add so nothing is lost.
   - Normalization: exact mapping from API (or AI output) to normalized type; handle nulls and arrays.
   - Efficiency: batch size, conflict keys, when to skip parse/sync.
   - Frontend: which mapper/section strategy reads the new shape; update if needed.

4. **Implement in small steps**
   - Prefer one concern per change (e.g. add one column and its mapping, then add batching).
   - Update proxy (background_worker, ai_parser, supabase) and frontend (vehicle-data.service, data-sync, models) together when a field crosses the boundary.

5. **Verify**
   - Trace one record from API response → normalized row → frontend model.
   - Check that existing flows (e.g. procedures section, DTCs) still get correct data from Supabase and fallback.

---

## Normalization Checklist (Per Schema Type)

When improving a given type (e.g. procedures, dtcs, tsbs):

- [ ] **normalized_schema.ts** – Interface has all fields the frontend and API need; optional vs required matches DB.
- [ ] **background_worker.js** – `determineSchemaType` routes the URL correctly; `extractVehicleId` / `extractExternalId` are stable and unique.
- [ ] **ai_parser.js** (if AI is used) – SCHEMAS output matches normalized type; required fields are extracted.
- [ ] **normalizeForSupabase** – Every field in the normalized interface is set (or explicitly defaulted); arrays/objects are safe (ensureArray, etc.); no undefined sent to Supabase.
- [ ] **supabase.js** – Table name and `UPSERT_CONFLICT_COLUMNS` are correct; no extra columns in insert that the DB doesn’t have.
- [ ] **vehicle-data.service.ts** – Section strategy and mapper produce the correct frontend model (e.g. Procedure with bucket, title, subtitle, parentBucket) from Supabase row.
- [ ] **data-sync.service.ts** (if applicable) – Sync writes the same shape and conflict keys so no duplicates; lazy vs eager is consistent.

### Checklist status (done)

- **Procedures, TSBs, DTCs** – [x] schema, background_worker, ai_parser, normalizeForSupabase (all fields set, no undefined; JSONB for steps/tools_required/parts_required and arrays), supabase conflict keys, vehicle-data mappers, content_html/cache.
- **Specifications** – [x] schema, normalizeForSupabase (category, name, value, unit, display_text, metadata), ai_parser, supabase; data-sync fluids/specs.
- **Maintenance_schedules** – [x] schema (DB columns documented), data-sync (interval_value, interval_unit, action, item, description, frequency_code), vehicle-data loadMaintenance.
- **Parts** – [x] schema (DB columns; quantity/fitment_notes for future), data-sync payload and conflict vehicle_id,part_number.
- **ai_processing_logs** – [x] schema has no vehicle_id; worker sends source_file, category, status, error_message, tokens_used; supabase adds processed_at.

### What remains (optional)

- **Diagrams/component-locations** – No table in `supabase_schema.sql`; section lists use articles only.
- **Future API fields** – Parts: quantity, fitment_notes. Maintenance: is_severe_service, labor_time_hours (in contract; add to sync when API/DB support).

---

## Output Format

When proposing or summarizing work:

1. **Summary** – What part of the pipeline was improved (e.g. procedures normalization, articles retention, frontend mapper).
2. **Data flow** – Short path: API/URL → schema type → normalize → table(s); and table → mapper → UI.
3. **Changes** – By file: what was added or changed (retention, mapping, conflict keys, mappers).
4. **Verification** – How to confirm: one full trace, or checklist items validated.

Keep responses concise and tied to the artifacts above so the next step (or another agent) can continue from the same contract.
