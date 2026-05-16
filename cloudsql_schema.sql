-- =============================================================================
-- Cloud SQL (PostgreSQL 15) Schema for vehapi-torque
-- No Supabase RLS / policies. Firebase UID (TEXT) as user PK.
-- vector(768) — Vertex AI text-embedding-004 dimensions.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- AUTH / BILLING
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,                          -- Firebase UID
    credits INTEGER NOT NULL DEFAULT 0,
    unlocks JSONB NOT NULL DEFAULT '{}'::jsonb,
    stripe_customer_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,                           -- 'purchase' | 'unlock' | 'refund'
    amount INTEGER NOT NULL DEFAULT 0,
    stripe_session_id TEXT,
    vehicle_id TEXT,
    module TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_stripe ON public.transactions(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- =============================================================================
-- VEHICLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.vehicles (
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

-- =============================================================================
-- ARTICLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.articles (
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

CREATE INDEX IF NOT EXISTS idx_articles_vehicle_id ON public.articles(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_articles_bucket ON public.articles(vehicle_id, bucket);
CREATE INDEX IF NOT EXISTS idx_articles_parent_bucket ON public.articles(vehicle_id, parent_bucket);

-- =============================================================================
-- PROCEDURES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.procedures (
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

CREATE INDEX IF NOT EXISTS idx_procedures_vehicle_id ON public.procedures(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_procedures_external_id ON public.procedures(external_id);

CREATE TABLE IF NOT EXISTS public.procedure_step (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    source_article_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    display_order INTEGER,
    step_text TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    warning TEXT,
    note TEXT,
    extractor_version TEXT DEFAULT 'l1-v1',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, source_article_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_procedure_step_vehicle_id ON public.procedure_step(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_procedure_step_vehicle_article ON public.procedure_step(vehicle_id, source_article_id);

CREATE TABLE IF NOT EXISTS public.procedure_tool (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    source_article_id TEXT NOT NULL,
    line_index INTEGER NOT NULL,
    tool_text TEXT NOT NULL DEFAULT '',
    extractor_version TEXT DEFAULT 'l1-v1',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, source_article_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_procedure_tool_vehicle_id ON public.procedure_tool(vehicle_id);

CREATE TABLE IF NOT EXISTS public.procedure_part (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    source_article_id TEXT NOT NULL,
    line_index INTEGER NOT NULL,
    part_number TEXT,
    description TEXT NOT NULL DEFAULT '',
    quantity NUMERIC DEFAULT 1,
    extractor_version TEXT DEFAULT 'l1-v1',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, source_article_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_procedure_part_vehicle_id ON public.procedure_part(vehicle_id);

-- =============================================================================
-- TSBS / DTCS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tsbs (
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

CREATE INDEX IF NOT EXISTS idx_tsbs_vehicle_id ON public.tsbs(vehicle_id);

CREATE TABLE IF NOT EXISTS public.dtcs (
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

CREATE INDEX IF NOT EXISTS idx_dtcs_vehicle_id ON public.dtcs(vehicle_id);

-- =============================================================================
-- SPECIFICATIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.specifications (
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

CREATE INDEX IF NOT EXISTS idx_specifications_vehicle_id ON public.specifications(vehicle_id);

CREATE TABLE IF NOT EXISTS public.spec_fact (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    spec_type TEXT NOT NULL DEFAULT 'other',
    component TEXT,
    value_num NUMERIC,
    value_text TEXT,
    unit TEXT,
    display_text TEXT,
    conditions JSONB,
    confidence REAL DEFAULT 1,
    source_article_id TEXT,
    metadata JSONB,
    extractor_version TEXT DEFAULT 'l1-v1',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, category, name)
);

CREATE INDEX IF NOT EXISTS idx_spec_fact_vehicle_id ON public.spec_fact(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_spec_fact_vehicle_type ON public.spec_fact(vehicle_id, spec_type);

-- =============================================================================
-- CATEGORIES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES public.categories(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    sort_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(name, type)
);

-- =============================================================================
-- VEHICLE_METADATA (YMME cache: /years, /makes, /models, /engines)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.vehicle_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- AI / PROCESSING LOGS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_processing_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_file TEXT NOT NULL,
    category TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    tokens_used INTEGER,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    processed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_processing_logs_source_status ON public.ai_processing_logs(source_file, status);

CREATE TABLE IF NOT EXISTS public.failed_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id TEXT NOT NULL,
    raw_text TEXT,
    error_message TEXT NOT NULL,
    url_path TEXT,
    category TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_failed_extractions_article ON public.failed_extractions(article_id);
CREATE INDEX IF NOT EXISTS idx_failed_extractions_created ON public.failed_extractions(created_at DESC);

-- =============================================================================
-- COMMON ISSUES CACHE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.common_issues_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    source TEXT DEFAULT 'MOTOR',
    issues JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_common_issues_vehicle_id ON public.common_issues_cache(vehicle_id);

-- =============================================================================
-- PARTS / MAINTENANCE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.parts (
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

CREATE INDEX IF NOT EXISTS idx_parts_vehicle_id ON public.parts(vehicle_id);

CREATE TABLE IF NOT EXISTS public.maintenance_schedules (
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

CREATE INDEX IF NOT EXISTS idx_maintenance_schedules_vehicle_id ON public.maintenance_schedules(vehicle_id);

CREATE TABLE IF NOT EXISTS public.maintenance_task (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    interval_value INTEGER NOT NULL,
    interval_unit TEXT NOT NULL DEFAULT 'Miles',
    action TEXT NOT NULL,
    item TEXT NOT NULL,
    description TEXT,
    frequency_code TEXT,
    ingest_source TEXT NOT NULL DEFAULT 'motor_interval',
    severity_bucket TEXT,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    extractor_version TEXT DEFAULT 'l1-client-v1',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, interval_value, action, item)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_task_vehicle_id ON public.maintenance_task(vehicle_id);

-- =============================================================================
-- NORMALIZATION — canonical buckets, evidence, content items
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.canonical_bucket (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES public.canonical_bucket(id) ON DELETE SET NULL,
    module_type TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.canonical_bucket (code, display_name, description, module_type, sort_order) VALUES
    ('silo_dtcs',               'Diagnostic Codes (DTC)',   'DTC articles and diagnostics',      'dtcs',                10),
    ('silo_tsbs',               'Service Bulletins (TSB)',  'TSB / service bulletins',            'tsbs',                20),
    ('silo_procedures',         'Service Procedures',       'Repair procedures',                  'procedures',          30),
    ('silo_diagrams',           'Wiring Diagrams',          'Wiring / schematics',                'diagrams',            40),
    ('silo_component_locations','Component Locations',      'Component location diagrams',         'component-locations', 50),
    ('silo_specs',              'Specifications',           'Specs and capacities',               'specs',               60),
    ('silo_parts',              'Parts Catalog',            'Parts listings',                     'parts',               70),
    ('silo_labor',              'Labor & Estimating',       'Labor guides',                       'labor',               80),
    ('silo_maintenance',        'Maintenance',              'Scheduled maintenance',              'maintenance',         90),
    ('silo_other',              'Other',                    'Unclassified catalog entries',        NULL,                 100)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.bucket_alias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_source TEXT NOT NULL DEFAULT 'MOTOR',
    raw_parent_bucket TEXT,
    raw_bucket TEXT,
    canonical_bucket_id UUID NOT NULL REFERENCES public.canonical_bucket(id) ON DELETE CASCADE,
    confidence REAL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(content_source, raw_parent_bucket, raw_bucket)
);

CREATE TABLE IF NOT EXISTS public.evidence_ingest (
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

CREATE INDEX IF NOT EXISTS idx_evidence_ingest_vehicle ON public.evidence_ingest(vehicle_external_id);
CREATE INDEX IF NOT EXISTS idx_evidence_ingest_sha ON public.evidence_ingest(sha256);
CREATE INDEX IF NOT EXISTS idx_evidence_ingest_fetched ON public.evidence_ingest(fetched_at DESC);

CREATE TABLE IF NOT EXISTS public.evidence_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_id UUID NOT NULL REFERENCES public.evidence_ingest(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    extractor_version TEXT DEFAULT 'v1',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(evidence_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_link_evidence ON public.evidence_link(evidence_id);
CREATE INDEX IF NOT EXISTS idx_evidence_link_entity ON public.evidence_link(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS public.content_item (
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

CREATE INDEX IF NOT EXISTS idx_content_item_vehicle ON public.content_item(vehicle_external_id);
CREATE INDEX IF NOT EXISTS idx_content_item_silo ON public.content_item(vehicle_external_id, canonical_silo_code);
CREATE INDEX IF NOT EXISTS idx_content_item_kind ON public.content_item(vehicle_external_id, kind);

-- =============================================================================
-- L2 RAG — media + vector chunks (768-dim, Vertex AI text-embedding-004)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.media_asset (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_external_id TEXT REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    content_source TEXT NOT NULL DEFAULT 'MOTOR',
    motor_graphic_id TEXT,
    mime_type TEXT,
    sha256 TEXT,
    source_label TEXT,
    storage_path TEXT,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_asset_vehicle ON public.media_asset(vehicle_external_id);

CREATE TABLE IF NOT EXISTS public.diagram_document (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    source_article_id TEXT NOT NULL,
    title TEXT,
    description TEXT,
    content_html TEXT,
    thumbnail_graphic_id TEXT,
    thumbnail_media_asset_id UUID REFERENCES public.media_asset(id) ON DELETE SET NULL,
    extractor_version TEXT,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, source_article_id)
);

CREATE INDEX IF NOT EXISTS idx_diagram_document_vehicle ON public.diagram_document(vehicle_id);

CREATE TABLE IF NOT EXISTS public.component_location_document (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    source_article_id TEXT NOT NULL,
    title TEXT,
    description TEXT,
    content_html TEXT,
    thumbnail_graphic_id TEXT,
    thumbnail_media_asset_id UUID REFERENCES public.media_asset(id) ON DELETE SET NULL,
    extractor_version TEXT,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, source_article_id)
);

CREATE INDEX IF NOT EXISTS idx_component_location_document_vehicle ON public.component_location_document(vehicle_id);

CREATE TABLE IF NOT EXISTS public.labor_operation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles(external_id) ON DELETE CASCADE,
    source_article_id TEXT NOT NULL,
    title TEXT,
    description TEXT,
    content_html TEXT,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    extractor_version TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, source_article_id)
);

CREATE INDEX IF NOT EXISTS idx_labor_operation_vehicle ON public.labor_operation(vehicle_id);

CREATE TABLE IF NOT EXISTS public.content_chunk (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_item_id UUID REFERENCES public.content_item(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    text_content TEXT NOT NULL,
    embedding vector(768),
    media_asset_id UUID REFERENCES public.media_asset(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(content_item_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_content_chunk_embedding_hnsw ON public.content_chunk USING hnsw (embedding vector_ip_ops);
CREATE INDEX IF NOT EXISTS idx_content_chunk_item_id ON public.content_chunk(content_item_id);

-- =============================================================================
-- VECTOR SEARCH FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION public.match_content_chunks(
    query_embedding vector(768),
    vehicle_external_id_filter text,
    match_count int DEFAULT 8
)
RETURNS TABLE (
    chunk_id uuid,
    content_item_id uuid,
    motor_article_id text,
    canonical_silo_code text,
    content_source text,
    chunk_index integer,
    text_content text,
    similarity double precision
)
LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT
        cc.id AS chunk_id,
        cc.content_item_id,
        ci.motor_article_id,
        ci.canonical_silo_code,
        ci.content_source,
        cc.chunk_index,
        cc.text_content,
        (-(cc.embedding <#> query_embedding))::double precision AS similarity
    FROM public.content_chunk cc
    INNER JOIN public.content_item ci ON ci.id = cc.content_item_id
    WHERE ci.vehicle_external_id = vehicle_external_id_filter
      AND cc.embedding IS NOT NULL
    ORDER BY cc.embedding <#> query_embedding
    LIMIT LEAST(COALESCE(match_count, 8), 24);
$$;
