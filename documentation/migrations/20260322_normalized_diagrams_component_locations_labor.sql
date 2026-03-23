-- =============================================================================
-- Normalization wrap-up: diagrams, component locations, labor operations
-- Additive migration for release-ready normalized coverage of remaining silos.
-- Rollback:
--   DROP TABLE IF EXISTS public.labor_operation CASCADE;
--   DROP TABLE IF EXISTS public.component_location_document CASCADE;
--   DROP TABLE IF EXISTS public.diagram_document CASCADE;
-- =============================================================================

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

CREATE INDEX IF NOT EXISTS idx_component_location_document_vehicle
    ON public.component_location_document(vehicle_id);

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

ALTER TABLE public.diagram_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.component_location_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labor_operation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all diagram_document" ON public.diagram_document;
DROP POLICY IF EXISTS "Allow all component_location_document" ON public.component_location_document;
DROP POLICY IF EXISTS "Allow all labor_operation" ON public.labor_operation;
-- No replacement policies: default deny for anon/authenticated roles.
-- vehapiproxi uses the service role and bypasses RLS.
