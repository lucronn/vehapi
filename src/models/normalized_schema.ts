// Normalized Vehicle Data Models
// These interfaces define the standardized data formats for vehicle information
// stored in the Supabase database. This serves as the contract for AI processing pipelines.

/**
 * Core Vehicle Entity
 */
export interface NormalizedVehicle {
  id?: string;
  year: number;
  make: string;
  model: string;
  submodel?: string;
  engine?: string;
  vin?: string;
  external_id?: string;
  content_source?: string;
  is_normalized?: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Article Catalog Entry
 * DB table articles — the master list of Motor API articles for a vehicle.
 * All Motor API articleDetails fields are retained here for complete section list rendering.
 */
export interface NormalizedArticle {
  id?: string;
  vehicle_id: string;
  original_id: string;
  title?: string;
  subtitle?: string;
  code?: string;
  description?: string;
  bucket?: string;
  parent_bucket?: string;
  thumbnail_href?: string;
  bulletin_number?: string;
  release_date?: string;
  sort?: number;
  content_source?: string;
  original_content?: string;
  enhanced_content?: string;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Unified catalog row (Supabase `content_item`) — dual-written with `articles` during normalization phase 1.
 * @see documentation/migrations/20260319_phase1_normalization.sql
 */
export interface ContentItem {
  id?: string;
  kind: string;
  motor_article_id: string;
  vehicle_external_id: string;
  variant_id?: string | null;
  content_source: string;
  motor_title?: string | null;
  motor_subtitle?: string | null;
  motor_description?: string | null;
  motor_parent_bucket?: string | null;
  motor_bucket?: string | null;
  motor_code?: string | null;
  motor_sort?: number | null;
  bulletin_number?: string | null;
  release_date?: string | null;
  thumbnail_href?: string | null;
  canonical_silo_code?: string | null;
  canonical_category_id?: string | null;
  canonical_subcategory_id?: string | null;
  tags?: string[];
  display_title?: string | null;
  display_subtitle?: string | null;
  display_description?: string | null;
  display_long_description?: string | null;
  search_text?: string | null;
  enrichment_source?: string | null;
  enrichment_version?: string | null;
  enriched_at?: string | null;
  metadata_json?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

/**
 * Hierarchical Category (formerly Buckets)
 */
export interface NormalizedCategory {
  id?: string;
  parent_id?: string;
  name: string;
  type: 'Procedures' | 'Diagrams' | 'Specs' | 'Maintenance' | 'Other';
  sort_order?: number;
}

/**
 * Step in a Repair Procedure
 */
export interface ProcedureStep {
  order: number;
  text: string;
  image_url?: string;
  warning?: string;
  note?: string;
}

/**
 * Part required for a Procedure
 */
export interface RequiredPart {
  part_number?: string;
  description: string;
  quantity: number;
}

/**
 * Standardized Repair Procedure
 * DB table uses content_html for full article HTML (cache response).
 */
export interface NormalizedProcedure {
  id?: string;
  vehicle_id: string;
  category_id?: string;
  external_id?: string;
  title: string;
  description?: string;
  /** Full article HTML when available; maps to DB column content_html. */
  content_html?: string;
  steps: ProcedureStep[];
  tools_required: string[];
  parts_required: RequiredPart[];
  time_estimate_hours?: number;
  cautions?: string;
}

/**
 * L1 atomic procedure step (Supabase `procedure_step`) — dual-written from worker after `procedures` upsert.
 * @see documentation/migrations/20260322_l1_procedure_step.sql
 */
export interface NormalizedProcedureStep {
  id?: string;
  vehicle_id: string;
  source_article_id: string;
  step_index: number;
  display_order?: number | null;
  step_text: string;
  image_url?: string | null;
  warning?: string | null;
  note?: string | null;
  extractor_version?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * L1 tool line (Supabase `procedure_tool`) — from `tools_required` after `procedures` upsert.
 * @see documentation/migrations/20260323_l1_procedure_tool_and_part.sql
 */
export interface NormalizedProcedureTool {
  id?: string;
  vehicle_id: string;
  source_article_id: string;
  line_index: number;
  tool_text: string;
  extractor_version?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * L1 part line (Supabase `procedure_part`) — from `parts_required` after `procedures` upsert.
 */
export interface NormalizedProcedurePart {
  id?: string;
  vehicle_id: string;
  source_article_id: string;
  line_index: number;
  part_number?: string | null;
  description: string;
  quantity?: number;
  extractor_version?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Technical Service Bulletin (TSB)
 * DB column for full HTML is content_html; AI/output uses content (pipeline maps content → content_html).
 */
export interface NormalizedTSB {
  id?: string;
  vehicle_id: string;
  bulletin_number: string;
  issue_date?: string; // ISO Date string
  title: string;
  summary?: string;
  content: string; // Full HTML or text from AI; pipeline copies to content_html for DB
  /** Maps to DB column content_html; set from content in normalizeForSupabase. */
  content_html?: string;
  affected_components: string[];
  models_affected?: string[];
}

/**
 * Diagnostic Step for DTCs
 * Aligned with ai_parser SCHEMAS.dtcs.diagnostic_steps and normalizeForSupabase output.
 */
export interface DiagnosticStep {
  order: number;
  test: string;
  result_match: string; // e.g. "Voltage > 12V"
  action_if_match: string; // e.g. "Go to Step 5"
  action_if_not_match: string; // e.g. "Replace Sensor"
  warning?: string; // Optional safety/warning text; retained from AI and pipeline
}

/**
 * Diagnostic Trouble Code (DTC)
 * DB table has content_html for full article HTML (cache response).
 */
export interface NormalizedDTC {
  id?: string;
  vehicle_id: string;
  code: string; // e.g. "P0300"
  description: string;
  possible_causes: string[];
  symptoms: string[];
  diagnostic_steps?: DiagnosticStep[];
  monitor_strategy?: string;
  malfunction_criteria?: string;
  /** Full article HTML when available; maps to DB column content_html. */
  content_html?: string;
}

/**
 * Vehicle Specification
 * Aligned with ai_parser SCHEMAS.specifications. DB table may only have category, name, value;
 * unit, display_text, metadata are in the contract for pipeline/API and future columns.
 */
export interface NormalizedSpecification {
  id?: string;
  vehicle_id: string;
  category: string; // e.g. "Torque", "Fluids"
  name: string; // e.g. "Oil Capacity"
  value: string; // e.g. "5.5"
  unit?: string; // e.g. "Quarts"
  display_text?: string; // e.g. "5.5 Quarts"
  metadata?: Record<string, any>;
}

/**
 * L1 spec row (Supabase `spec_fact`) — dual-written from AI-parsed specifications.
 * @see documentation/migrations/20260320_l1_spec_fact.sql
 */
export interface NormalizedSpecFact {
  id?: string;
  vehicle_id: string;
  category: string;
  name: string;
  spec_type: string;
  component?: string | null;
  value_num?: number | null;
  value_text?: string | null;
  unit?: string | null;
  display_text?: string | null;
  conditions?: Record<string, unknown> | null;
  confidence?: number | null;
  source_article_id?: string | null;
  metadata?: Record<string, unknown> | null;
  extractor_version?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Maintenance Schedule Item
 * DB columns: vehicle_id, interval_value, interval_unit, action, item, description, frequency_code.
 * is_severe_service, labor_time_hours are in contract for future API/schema use.
 */
export interface NormalizedMaintenanceSchedule {
  id?: string;
  vehicle_id: string;
  interval_value?: number;
  interval_unit?: 'Miles' | 'Kilometers' | 'Months' | 'Hours';
  action: 'Inspect' | 'Replace' | 'Change' | 'Rotate' | 'Adjust' | 'Clean' | 'Check';
  item: string; // e.g. "Engine Oil"
  description?: string;
  frequency_code?: string;
  is_severe_service: boolean;
  labor_time_hours?: number;
}

/**
 * L1 maintenance row (Supabase `maintenance_task`) — dual-written with `maintenance_schedules`.
 * @see documentation/migrations/20260321_l1_maintenance_task.sql
 */
export interface NormalizedMaintenanceTask {
  id?: string;
  vehicle_id: string;
  interval_value: number;
  interval_unit: string;
  action: string;
  item: string;
  description?: string | null;
  frequency_code?: string | null;
  ingest_source?: string;
  severity_bucket?: string | null;
  metadata_json?: Record<string, unknown>;
  extractor_version?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Labor Estimate
 */
export interface NormalizedLabor {
  id?: string;
  vehicle_id: string;
  operation_code?: string;
  description: string;
  hours: number;
  skill_level?: 'A' | 'B' | 'C' | 'D';
  category_id?: string;
}

/**
 * Vehicle Part
 * DB columns: vehicle_id, part_number, description, manufacturer, list_price, dealer_price.
 * quantity, fitment_notes are in contract for when API/DB support them.
 */
export interface NormalizedPart {
  id?: string;
  vehicle_id: string;
  part_number: string;
  description: string;
  manufacturer?: string;
  list_price?: number;
  dealer_price?: number;
  quantity?: number;
  fitment_notes?: string;
}

/**
 * Wiring or Component Diagram
 */
export interface NormalizedDiagram {
  id?: string;
  vehicle_id: string;
  category_id?: string;
  title: string;
  description?: string;
  image_url: string;
  thumbnail_url?: string;
  diagram_type: 'Wiring' | 'Component Location' | 'Vacuum' | 'Hydraulic' | 'Flow Chart';
  interactive_points?: {
    x: number;
    y: number;
    label: string;
    target_id?: string; // ID of part or component
  }[];
}

/**
 * AI Processing Log Status
 * DB table ai_processing_logs has: source_file, category, status, error_message, tokens_used, processed_at (no vehicle_id).
 */
export interface AIProcessingLog {
  id?: string;
  vehicle_id?: string; // Optional; current schema does not have this column
  source_file: string;
  category: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  error_message?: string;
  tokens_used?: number;
  processed_at?: string;
}
