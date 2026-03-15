# Progress

**Last updated:** 2025-03-15

## Vehicle data normalization / migration

- [x] **normalized_schema.ts** – Interfaces aligned with Supabase (procedures, tsbs, dtcs, specifications, maintenance_schedules, parts, ai_processing_logs). Optional fields and DB column notes documented.
- [x] **background_worker.js** – determineSchemaType, extractVehicleId, extractExternalId; normalizeForSupabase sets all fields with safe defaults (no undefined) for procedures, tsbs, dtcs, specifications.
- [x] **ai_parser.js** – SCHEMAS for dtcs, tsbs, procedures, specifications aligned with normalized types.
- [x] **supabase.js** – UPSERT_CONFLICT_COLUMNS (procedures: vehicle_id,external_id; articles: vehicle_id,original_id; specifications; parts; maintenance_schedules). logAiProcessing sends only schema columns (no vehicle_id).
- [x] **vehicle-data.service.ts** – Section strategies and mappers (original_id/external_id for list item ids); loadMaintenance reads maintenance_schedules columns (interval_value, action, item, frequency_code).
- [x] **data-sync.service.ts** – Articles upsert (original_id, no client id); syncFluids (specs with unit, display_text, metadata); syncMaintenance (frequency_code); syncParts (nullable fields, conflict vehicle_id,part_number).

## What's left (optional)

- **Diagrams/component-locations** – No normalized table; section lists use articles only (see `supabase_schema.sql`).
- **Future API fields** – Parts: quantity, fitment_notes. Maintenance: is_severe_service, labor_time_hours (in contract when API/DB support them).
