-- =============================================================================
-- L2 RAG: RPC for pgvector similarity search scoped by vehicle_external_id
-- Requires: pgvector, content_chunk + content_item (20260324_l2_content_chunk_pgvector.sql)
-- HNSW index uses vector_ip_ops — ORDER BY embedding <#> query_embedding
-- =============================================================================

CREATE OR REPLACE FUNCTION public.match_content_chunks(
    query_embedding vector(1024),
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

REVOKE ALL ON FUNCTION public.match_content_chunks(vector(1024), text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_content_chunks(vector(1024), text, int) TO service_role;
