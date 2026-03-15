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
    bucket TEXT,
    parent_bucket TEXT,
    thumbnail_href TEXT,
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
