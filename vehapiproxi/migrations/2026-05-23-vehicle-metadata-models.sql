-- Phase 1 (SQL/API refactor): projection table for deterministic vehicle-name
-- resolution. Replaces the fuzzy `vehicle_metadata.data::text LIKE '%"id":...%'`
-- scan that caused cross-make collisions (e.g. 2011 Nissan Rogue -> 1985 Dodge).
--
-- Source of truth: vehicle_metadata model-list blobs. `base_vehicle_id` is the
-- globally-unique Motor base vehicle id; `model_local_id` (= model.id) is only
-- unique per year/make and must never be matched on its own.

CREATE TABLE IF NOT EXISTS vehicle_metadata_models (
    base_vehicle_id bigint PRIMARY KEY,
    year            int,
    make            text,
    model           text,
    model_local_id  bigint,
    engine_ids      bigint[]  DEFAULT '{}',
    updated_at      timestamptz DEFAULT now()
);

-- Lookup by (model_local_id) — used only with a disambiguating engine/year to
-- recover legacy `model.id:engineId` composites; ambiguous matches are rejected
-- by the resolver rather than guessed.
CREATE INDEX IF NOT EXISTS idx_vmm_model_local ON vehicle_metadata_models (model_local_id);
CREATE INDEX IF NOT EXISTS idx_vmm_year_make   ON vehicle_metadata_models (year, make);
