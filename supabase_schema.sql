-- =============================================================================
-- Vehicle Data Normalization Schema (Supabase)
-- Aligned with src/models/normalized_schema.ts and vehapiproxi pipeline.
-- Run this to wipe and recreate vehicle/content tables. Keeps users, transactions,
-- system_sessions intact. To wipe those too, uncomment the optional DROP block.
-- =============================================================================

-- Optional: uncomment to also drop app/auth tables (full wipe)
-- DROP TABLE IF EXISTS public.transactions CASCADE;
-- DROP TABLE IF EXISTS public.users CASCADE;
-- DROP TABLE IF EXISTS public.system_sessions CASCADE;

-- Drop vehicle/content tables (reverse dependency order)
DROP TABLE IF EXISTS public.ai_processing_logs CASCADE;
DROP TABLE IF EXISTS public.vehicle_metadata CASCADE;
DROP TABLE IF EXISTS public.common_issues_cache CASCADE;
DROP TABLE IF EXISTS public.maintenance_schedules CASCADE;
DROP TABLE IF EXISTS public.parts CASCADE;
DROP TABLE IF EXISTS public.specifications CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;
DROP TABLE IF EXISTS public.dtcs CASCADE;
DROP TABLE IF EXISTS public.tsbs CASCADE;
DROP TABLE IF EXISTS public.procedures CASCADE;
DROP TABLE IF EXISTS public.articles CASCADE;
DROP TABLE IF EXISTS public.evidence_link CASCADE;
DROP TABLE IF EXISTS public.content_item CASCADE;
DROP TABLE IF EXISTS public.bucket_alias CASCADE;
DROP TABLE IF EXISTS public.evidence_ingest CASCADE;
DROP TABLE IF EXISTS public.canonical_bucket CASCADE;
DROP TABLE IF EXISTS public.vehicles CASCADE;

-- -----------------------------------------------------------------------------
-- 1. VEHICLES (root; no FK to other app tables)
-- -----------------------------------------------------------------------------
CREATE TABLE public.vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT NOT NULL UNIQUE,
    content_source TEXT DEFAULT 'MOTOR',
    year INTEGER,
    make TEXT,
    model TEXT,
    is_normalized BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. ARTICLES (list/catalog from Motor articles/v2; section lists)
-- Pipeline: background_worker (articles), data-sync (syncSingleArticle).
-- -----------------------------------------------------------------------------
CREATE TABLE public.articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    original_id TEXT NOT NULL,
    title TEXT,
    subtitle TEXT,
    code TEXT,
    description TEXT,
    bucket TEXT,
    parent_bucket TEXT,
    thumbnail_href TEXT,
    bulletin_number TEXT,
    release_date TEXT,
    sort INTEGER,
    content_source TEXT DEFAULT 'MOTOR',
    original_content TEXT,
    enhanced_content TEXT,
    source TEXT DEFAULT 'MOTOR',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, original_id)
);

CREATE INDEX idx_articles_vehicle_id ON public.articles(vehicle_id);
CREATE INDEX idx_articles_bucket ON public.articles(vehicle_id, bucket);
CREATE INDEX idx_articles_parent_bucket ON public.articles(vehicle_id, parent_bucket);

-- -----------------------------------------------------------------------------
-- 3. PROCEDURES (normalized repair procedures; cache for article content)
-- Conflict: vehicle_id + external_id (Motor article id) for one row per article.
-- -----------------------------------------------------------------------------
CREATE TABLE public.procedures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    content_html TEXT,
    steps JSONB DEFAULT '[]'::jsonb,
    tools_required JSONB DEFAULT '[]'::jsonb,
    parts_required JSONB DEFAULT '[]'::jsonb,
    time_estimate_hours NUMERIC,
    cautions TEXT,
    category_id UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, external_id)
);

CREATE INDEX idx_procedures_vehicle_id ON public.procedures(vehicle_id);
CREATE INDEX idx_procedures_external_id ON public.procedures(external_id);

-- -----------------------------------------------------------------------------
-- 4. TSBS (Technical Service Bulletins)
-- -----------------------------------------------------------------------------
CREATE TABLE public.tsbs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    bulletin_number TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    content TEXT,
    content_html TEXT,
    issue_date DATE,
    affected_components JSONB DEFAULT '[]'::jsonb,
    models_affected JSONB DEFAULT '[]'::jsonb,
    external_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, bulletin_number)
);

CREATE INDEX idx_tsbs_vehicle_id ON public.tsbs(vehicle_id);
CREATE INDEX idx_tsbs_external_id ON public.tsbs(external_id) WHERE external_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. DTCS (Diagnostic Trouble Codes)
-- -----------------------------------------------------------------------------
CREATE TABLE public.dtcs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    description TEXT,
    content_html TEXT,
    possible_causes JSONB DEFAULT '[]'::jsonb,
    symptoms JSONB DEFAULT '[]'::jsonb,
    diagnostic_steps JSONB DEFAULT '[]'::jsonb,
    monitor_strategy TEXT,
    malfunction_criteria TEXT,
    external_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, code)
);

CREATE INDEX idx_dtcs_vehicle_id ON public.dtcs(vehicle_id);
CREATE INDEX idx_dtcs_external_id ON public.dtcs(external_id) WHERE external_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 6. SPECIFICATIONS (fluids, torque, etc.)
-- -----------------------------------------------------------------------------
CREATE TABLE public.specifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT,
    unit TEXT,
    display_text TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, category, name)
);

CREATE INDEX idx_specifications_vehicle_id ON public.specifications(vehicle_id);

-- -----------------------------------------------------------------------------
-- 7. CATEGORIES (hierarchical buckets)
-- -----------------------------------------------------------------------------
CREATE TABLE public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES public.categories(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    sort_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(name, type)
);

-- -----------------------------------------------------------------------------
-- 8. VEHICLE_METADATA (cached API responses: years, makes, models)
-- -----------------------------------------------------------------------------
CREATE TABLE public.vehicle_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 9. AI_PROCESSING_LOGS (parse status for dedup / monitoring)
-- -----------------------------------------------------------------------------
CREATE TABLE public.ai_processing_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_file TEXT NOT NULL,
    category TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    tokens_used INTEGER,
    processed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ai_processing_logs_source_status ON public.ai_processing_logs(source_file, status);

-- -----------------------------------------------------------------------------
-- 10. COMMON_ISSUES_CACHE (AI-generated common issues per vehicle)
-- -----------------------------------------------------------------------------
CREATE TABLE public.common_issues_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    source TEXT DEFAULT 'MOTOR',
    issues JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id)
);

CREATE INDEX idx_common_issues_vehicle_id ON public.common_issues_cache(vehicle_id);

-- -----------------------------------------------------------------------------
-- 11. PARTS (parts catalog sync)
-- -----------------------------------------------------------------------------
CREATE TABLE public.parts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    part_number TEXT NOT NULL,
    description TEXT,
    manufacturer TEXT,
    list_price NUMERIC,
    dealer_price NUMERIC,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, part_number)
);

CREATE INDEX idx_parts_vehicle_id ON public.parts(vehicle_id);

-- -----------------------------------------------------------------------------
-- 12. MAINTENANCE_SCHEDULES
-- -----------------------------------------------------------------------------
CREATE TABLE public.maintenance_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    interval_value INTEGER NOT NULL,
    interval_unit TEXT DEFAULT 'Miles',
    action TEXT,
    item TEXT NOT NULL,
    description TEXT,
    frequency_code TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, interval_value, action, item)
);

CREATE INDEX idx_maintenance_schedules_vehicle_id ON public.maintenance_schedules(vehicle_id);
CREATE INDEX idx_maintenance_schedules_vehicle_interval ON public.maintenance_schedules(vehicle_id, interval_value);

-- -----------------------------------------------------------------------------
-- 13. NORMALIZATION PHASE 1 — canonical_bucket, L0 evidence, content_item
-- (aligned with documentation/migrations/20260319_phase1_normalization.sql)
-- -----------------------------------------------------------------------------
CREATE TABLE public.canonical_bucket (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES public.canonical_bucket(id) ON DELETE SET NULL,
    module_type TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_canonical_bucket_parent ON public.canonical_bucket(parent_id);

CREATE TABLE public.bucket_alias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_source TEXT NOT NULL DEFAULT 'MOTOR',
    raw_parent_bucket TEXT,
    raw_bucket TEXT,
    canonical_bucket_id UUID NOT NULL REFERENCES public.canonical_bucket(id) ON DELETE CASCADE,
    confidence REAL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(content_source, raw_parent_bucket, raw_bucket)
);

CREATE TABLE public.evidence_ingest (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fetched_at TIMESTAMPTZ DEFAULT now(),
    url_path TEXT,
    http_status INTEGER,
    content_type TEXT,
    body_json JSONB,
    body_storage_ref TEXT,
    sha256 TEXT,
    vehicle_external_id TEXT REFERENCES public.vehicles(external_id) ON DELETE SET NULL,
    content_source TEXT DEFAULT 'MOTOR',
    source_label TEXT
);

CREATE INDEX idx_evidence_ingest_vehicle ON public.evidence_ingest(vehicle_external_id);
CREATE INDEX idx_evidence_ingest_sha ON public.evidence_ingest(sha256);
CREATE INDEX idx_evidence_ingest_fetched ON public.evidence_ingest(fetched_at DESC);

CREATE TABLE public.evidence_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_id UUID NOT NULL REFERENCES public.evidence_ingest(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    extractor_version TEXT DEFAULT 'v1',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_evidence_link_evidence ON public.evidence_link(evidence_id);
CREATE INDEX idx_evidence_link_entity ON public.evidence_link(entity_type, entity_id);

CREATE TABLE public.content_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL DEFAULT 'unknown',
    motor_article_id TEXT NOT NULL,
    vehicle_external_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
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
    canonical_category_id UUID REFERENCES public.canonical_bucket(id) ON DELETE SET NULL,
    canonical_subcategory_id UUID REFERENCES public.canonical_bucket(id) ON DELETE SET NULL,
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
    UNIQUE(vehicle_external_id, motor_article_id, content_source)
);

CREATE INDEX idx_content_item_vehicle ON public.content_item(vehicle_external_id);
CREATE INDEX idx_content_item_silo ON public.content_item(vehicle_external_id, canonical_silo_code);
CREATE INDEX idx_content_item_kind ON public.content_item(vehicle_external_id, kind);

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
-- RLS (enable on all new tables)
-- -----------------------------------------------------------------------------
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tsbs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dtcs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_processing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.common_issues_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_bucket ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bucket_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_ingest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_item ENABLE ROW LEVEL SECURITY;

-- Permissive policies (MVP; tighten for production)
CREATE POLICY "Allow all vehicles" ON public.vehicles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all articles" ON public.articles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all procedures" ON public.procedures FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all tsbs" ON public.tsbs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all dtcs" ON public.dtcs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all specifications" ON public.specifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all categories" ON public.categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all vehicle_metadata" ON public.vehicle_metadata FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all ai_processing_logs" ON public.ai_processing_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all common_issues_cache" ON public.common_issues_cache FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all parts" ON public.parts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all maintenance_schedules" ON public.maintenance_schedules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all canonical_bucket" ON public.canonical_bucket FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all bucket_alias" ON public.bucket_alias FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all evidence_ingest" ON public.evidence_ingest FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all evidence_link" ON public.evidence_link FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all content_item" ON public.content_item FOR ALL USING (true) WITH CHECK (true);

-- =============================================================================
-- MIGRATION: Add missing article catalog fields (run on existing deployments)
-- =============================================================================
-- ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS code TEXT;
-- ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS description TEXT;
-- ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS sort INTEGER;
-- ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS bulletin_number TEXT;
-- ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS release_date TEXT;
-- CREATE INDEX IF NOT EXISTS idx_articles_parent_bucket ON public.articles(vehicle_id, parent_bucket);
