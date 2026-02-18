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
 */
export interface NormalizedProcedure {
  id?: string;
  vehicle_id: string;
  category_id?: string;
  external_id?: string;
  title: string;
  description?: string;
  steps: ProcedureStep[];
  tools_required: string[];
  parts_required: RequiredPart[];
  time_estimate_hours?: number;
  cautions?: string;
}

/**
 * Technical Service Bulletin (TSB)
 */
export interface NormalizedTSB {
  id?: string;
  vehicle_id: string;
  bulletin_number: string;
  issue_date?: string; // ISO Date string
  title: string;
  summary?: string;
  content: string; // Full HTML or Text content
  affected_components: string[];
  models_affected?: string[];
}

/**
 * Diagnostic Step for DTCs
 */
export interface DiagnosticStep {
  order: number;
  test: string;
  result_match: string; // e.g. "Voltage > 12V"
  action_if_match: string; // e.g. "Go to Step 5"
  action_if_not_match: string; // e.g. "Replace Sensor"
}

/**
 * Diagnostic Trouble Code (DTC)
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
}

/**
 * Vehicle Specification
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
 * Maintenance Schedule Item
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
 */
export interface AIProcessingLog {
  id?: string;
  vehicle_id: string;
  source_file: string;
  category: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  error_message?: string;
  tokens_used?: number;
  processed_at?: string;
}
