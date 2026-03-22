-- =============================================================================
-- L1: maintenance_task — normalized scheduled maintenance (dual-written with
--      maintenance_schedules from client DataSyncService)
-- Additive; safe on existing Supabase projects.
-- See docs/plans/2026-03-18-normalization-schema-design.md §3.5
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.maintenance_task (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles (external_id) ON DELETE CASCADE,
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
    UNIQUE (vehicle_id, interval_value, action, item)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_task_vehicle ON public.maintenance_task (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_task_vehicle_interval ON public.maintenance_task (vehicle_id, interval_value);

ALTER TABLE public.maintenance_task ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all maintenance_task" ON public.maintenance_task;
CREATE POLICY "Allow all maintenance_task" ON public.maintenance_task FOR ALL USING (true) WITH CHECK (true);
