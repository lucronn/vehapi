-- =============================================================================
-- Cloud SQL migration: update match_content_chunks to vector(768)
-- Applies when migrating from Supabase (NVIDIA 1024-dim) to Cloud SQL
-- (Vertex AI text-embedding-004, 768-dim).
-- Run AFTER re-creating content_chunk with embedding vector(768).
-- =============================================================================

-- Drop the old 1024-dim signature before replacing.
DROP FUNCTION IF EXISTS public.match_content_chunks(vector(1024), text, int);

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
LANGUAGE sql
STABLE
SET search_path = public
AS $$
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
