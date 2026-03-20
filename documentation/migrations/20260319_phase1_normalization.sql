-- =============================================================================
-- Phase 1 normalization (additive): L0 evidence snapshot + unified content_item
-- Safe to run on existing Supabase projects. Does not drop legacy tables.
-- See docs/plans/2026-03-18-normalization-schema-design.md
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Canonical navigation tree (silo roots; children added later)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.canonical_bucket (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES public.canonical_bucket (id) ON DELETE SET NULL,
    module_type TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_bucket_parent ON public.canonical_bucket (parent_id);

-- OEM string → canonical bucket (optional; populated by jobs)
CREATE TABLE IF NOT EXISTS public.bucket_alias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_source TEXT NOT NULL DEFAULT 'MOTOR',
    raw_parent_bucket TEXT,
    raw_bucket TEXT,
    canonical_bucket_id UUID NOT NULL REFERENCES public.canonical_bucket (id) ON DELETE CASCADE,
    confidence REAL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (content_source, raw_parent_bucket, raw_bucket)
);

-- -----------------------------------------------------------------------------
-- L0: one row per upstream capture (catalog JSON, article response, etc.)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evidence_ingest (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fetched_at TIMESTAMPTZ DEFAULT now(),
    url_path TEXT,
    http_status INTEGER,
    content_type TEXT,
    body_json JSONB,
    body_storage_ref TEXT,
    sha256 TEXT,
    vehicle_external_id TEXT REFERENCES public.vehicles (external_id) ON DELETE SET NULL,
    content_source TEXT DEFAULT 'MOTOR',
    source_label TEXT
);

CREATE INDEX IF NOT EXISTS idx_evidence_ingest_vehicle ON public.evidence_ingest (vehicle_external_id);
CREATE INDEX IF NOT EXISTS idx_evidence_ingest_sha ON public.evidence_ingest (sha256);
CREATE INDEX IF NOT EXISTS idx_evidence_ingest_fetched ON public.evidence_ingest (fetched_at DESC);

-- Links evidence → extracted entities (L1 rows later)
CREATE TABLE IF NOT EXISTS public.evidence_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_id UUID NOT NULL REFERENCES public.evidence_ingest (id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    extractor_version TEXT DEFAULT 'v1',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_link_evidence ON public.evidence_link (evidence_id);
CREATE INDEX IF NOT EXISTS idx_evidence_link_entity ON public.evidence_link (entity_type, entity_id);

-- -----------------------------------------------------------------------------
-- Unified catalog row (dual-written with legacy articles during transition)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL DEFAULT 'unknown',
    motor_article_id TEXT NOT NULL,
    vehicle_external_id TEXT NOT NULL REFERENCES public.vehicles (external_id) ON DELETE CASCADE,
    variant_id UUID,
    content_source TEXT NOT NULL DEFAULT 'MOTOR',
    motor_title TEXT,
    motor_subtitle TEXT,
    motor_description TEXT,
    motor_parent_bucket TEXT,
    motor_bucket TEXT,
    motor_code TEXT,
    motor_sort INTEGER,
    bulletin_number TEXT,
    release_date TEXT,
    thumbnail_href TEXT,
    canonical_silo_code TEXT,
    canonical_category_id UUID REFERENCES public.canonical_bucket (id) ON DELETE SET NULL,
    canonical_subcategory_id UUID REFERENCES public.canonical_bucket (id) ON DELETE SET NULL,
    tags TEXT[] DEFAULT '{}',
    display_title TEXT,
    display_subtitle TEXT,
    display_description TEXT,
    display_long_description TEXT,
    search_text TEXT,
    enrichment_source TEXT,
    enrichment_version TEXT,
    enriched_at TIMESTAMPTZ,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (vehicle_external_id, motor_article_id, content_source)
);

CREATE INDEX IF NOT EXISTS idx_content_item_vehicle ON public.content_item (vehicle_external_id);
CREATE INDEX IF NOT EXISTS idx_content_item_silo ON public.content_item (vehicle_external_id, canonical_silo_code);
CREATE INDEX IF NOT EXISTS idx_content_item_kind ON public.content_item (vehicle_external_id, kind);

-- -----------------------------------------------------------------------------
-- Seed top-level silos (idempotent)
-- -----------------------------------------------------------------------------
INSERT INTO public.canonical_bucket (code, display_name, description, module_type, sort_order)
VALUES
    ('silo_dtcs', 'Diagnostic Codes (DTC)', 'DTC articles and diagnostics', 'dtcs', 10),
    ('silo_tsbs', 'Service Bulletins (TSB)', 'TSB / service bulletins', 'tsbs', 20),
    ('silo_procedures', 'Service Procedures', 'Repair procedures', 'procedures', 30),
    ('silo_diagrams', 'Wiring Diagrams', 'Wiring / schematics', 'diagrams', 40),
    ('silo_component_locations', 'Component Locations', 'Component location diagrams', 'component-locations', 50),
    ('silo_specs', 'Specifications', 'Specs and capacities', 'specs', 60),
    ('silo_parts', 'Parts Catalog', 'Parts listings', 'parts', 70),
    ('silo_labor', 'Labor & Estimating', 'Labor guides', 'labor', 80),
    ('silo_maintenance', 'Maintenance', 'Scheduled maintenance', 'maintenance', 90),
    ('silo_other', 'Other', 'Unclassified catalog entries', NULL, 100)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- RLS (permissive MVP — match existing vehicle tables)
-- -----------------------------------------------------------------------------
ALTER TABLE public.canonical_bucket ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bucket_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_ingest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all canonical_bucket" ON public.canonical_bucket;
CREATE POLICY "Allow all canonical_bucket" ON public.canonical_bucket FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all bucket_alias" ON public.bucket_alias;
CREATE POLICY "Allow all bucket_alias" ON public.bucket_alias FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all evidence_ingest" ON public.evidence_ingest;
CREATE POLICY "Allow all evidence_ingest" ON public.evidence_ingest FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all evidence_link" ON public.evidence_link;
CREATE POLICY "Allow all evidence_link" ON public.evidence_link FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all content_item" ON public.content_item;
CREATE POLICY "Allow all content_item" ON public.content_item FOR ALL USING (true) WITH CHECK (true);
