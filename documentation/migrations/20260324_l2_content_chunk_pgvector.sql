-- =============================================================================
-- L2 RAG: pgvector + content_chunk (+ media_asset stub for FK)
-- Additive; safe on existing Supabase projects that already have phase 1
-- (content_item). Requires Postgres with pgvector (enabled on Supabase).
-- See docs/plans/2026-03-18-normalization-schema-design.md
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Minimal media store for diagrams / PDFs / blobs referenced from chunks.
CREATE TABLE IF NOT EXISTS public.media_asset (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_external_id TEXT REFERENCES public.vehicles (external_id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_media_asset_vehicle ON public.media_asset (vehicle_external_id);

CREATE TABLE IF NOT EXISTS public.content_chunk (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_item_id UUID REFERENCES public.content_item (id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    text_content TEXT NOT NULL,
    -- 1024 dims — align NEMOTRON / embedding model output before insert
    embedding vector(1024),
    media_asset_id UUID REFERENCES public.media_asset (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_chunk_embedding_hnsw
    ON public.content_chunk
    USING hnsw (embedding vector_ip_ops);

CREATE INDEX IF NOT EXISTS idx_content_chunk_item_id ON public.content_chunk (content_item_id);

ALTER TABLE public.media_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_chunk ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all media_asset" ON public.media_asset;
DROP POLICY IF EXISTS "Allow all content_chunk" ON public.content_chunk;
-- No replacement policies: default deny for anon/authenticated roles.
-- vehapiproxi uses the service role and bypasses RLS for L2/media operations.
