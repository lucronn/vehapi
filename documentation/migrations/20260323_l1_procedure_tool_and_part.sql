-- =============================================================================
-- L1: procedure_tool + procedure_part — line items from AI `tools_required` /
--      `parts_required` (dual-written after `procedures` upsert; delete+insert
--      per article like procedure_step).
-- Additive; safe on existing Supabase projects.
-- See docs/plans/2026-03-18-normalization-schema-design.md §3.5 / §3.7
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.procedure_tool (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles (external_id) ON DELETE CASCADE,
    source_article_id TEXT NOT NULL,
    line_index INTEGER NOT NULL,
    tool_text TEXT NOT NULL DEFAULT '',
    extractor_version TEXT DEFAULT 'l1-v1',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (vehicle_id, source_article_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_procedure_tool_vehicle ON public.procedure_tool (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_procedure_tool_article ON public.procedure_tool (vehicle_id, source_article_id);

CREATE TABLE IF NOT EXISTS public.procedure_part (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles (external_id) ON DELETE CASCADE,
    source_article_id TEXT NOT NULL,
    line_index INTEGER NOT NULL,
    part_number TEXT,
    description TEXT NOT NULL DEFAULT '',
    quantity NUMERIC DEFAULT 1,
    extractor_version TEXT DEFAULT 'l1-v1',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (vehicle_id, source_article_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_procedure_part_vehicle ON public.procedure_part (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_procedure_part_article ON public.procedure_part (vehicle_id, source_article_id);

ALTER TABLE public.procedure_tool ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedure_part ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all procedure_tool" ON public.procedure_tool;
CREATE POLICY "Allow all procedure_tool" ON public.procedure_tool FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all procedure_part" ON public.procedure_part;
CREATE POLICY "Allow all procedure_part" ON public.procedure_part FOR ALL USING (true) WITH CHECK (true);
