-- Phase 4: AtomicStep evolution + LogicNode table
-- All changes are additive/online-safe:
--   ALTER TABLE ... ADD COLUMN IF NOT EXISTS (no lock on empty tables)
--   CREATE TABLE IF NOT EXISTS
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS

-- ─── procedure_step → AtomicStep ─────────────────────────────────────────────

ALTER TABLE procedure_step
  ADD COLUMN IF NOT EXISTS procedure_id   uuid REFERENCES procedures(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS operation_name text,
  ADD COLUMN IF NOT EXISTS sequence_order int,
  ADD COLUMN IF NOT EXISTS spec_data      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS safety_data    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS media_assets   jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN procedure_step.procedure_id   IS 'FK to procedures; populated during normalization pipeline';
COMMENT ON COLUMN procedure_step.operation_name IS 'Short name for the operation (e.g. "Torque lug nuts")';
COMMENT ON COLUMN procedure_step.sequence_order IS 'Explicit ordering within procedure (replaces step_index for normalized steps)';
COMMENT ON COLUMN procedure_step.spec_data      IS 'AtomicStep spec: {torque_nm?, torque_ft_lbs?, tool_ids[], clearance_mm?}';
COMMENT ON COLUMN procedure_step.safety_data    IS 'AtomicStep safety: {warnings[], ppe_required[], caution_level?}';
COMMENT ON COLUMN procedure_step.media_assets   IS 'AtomicStep media: [{url, type, caption?}] or media_asset FK refs';

-- Index for FK-based loads during normalization pipeline
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procedure_step_procedure_id
  ON procedure_step (procedure_id);

-- ─── logic_nodes (DTC diagnostic trees) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS logic_nodes (
  node_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id        uuid        NOT NULL,
  vehicle_id     text        NOT NULL,
  dtc_code       text,
  node_type      text        NOT NULL CHECK (node_type IN ('decision', 'measurement', 'terminal_action')),
  input_criteria jsonb       NOT NULL DEFAULT '{}'::jsonb,
  edge_logic     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  logic_nodes                    IS 'DTC diagnostic tree nodes; each tree_id groups a full branching decision graph for one DTC code + vehicle';
COMMENT ON COLUMN logic_nodes.input_criteria     IS 'LogicNode input: {dtc_code?, expected_range?, measurement_unit?}';
COMMENT ON COLUMN logic_nodes.edge_logic         IS 'LogicNode edges: [{condition, next_node_id}]';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logic_nodes_tree
  ON logic_nodes (tree_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logic_nodes_vehicle
  ON logic_nodes (vehicle_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logic_nodes_dtc
  ON logic_nodes (vehicle_id, dtc_code) WHERE dtc_code IS NOT NULL;
