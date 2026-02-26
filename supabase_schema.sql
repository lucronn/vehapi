-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. Core Vehicle Tables
-- ==========================================

-- Vehicles Table
CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    year INTEGER NOT NULL,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    submodel TEXT,
    engine TEXT,
    vin TEXT,
    external_id TEXT, -- e.g., "66966:2600"
    content_source TEXT, -- e.g., "MOTOR", "OEM"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_vehicles_external_id ON vehicles(external_id);
CREATE INDEX idx_vehicles_ymm ON vehicles(year, make, model);

-- Categories Table (Hierarchical)
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_id UUID REFERENCES categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- e.g., "Procedures", "Diagrams", "Specs", "Maintenance"
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_categories_parent_id ON categories(parent_id);

-- ==========================================
-- 2. Technical Data Tables (Standardized)
-- ==========================================

-- Procedures Table
-- Standardized format for repair instructions
CREATE TABLE procedures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id TEXT NOT NULL, -- external_id from Motor (e.g., "66966:2600")
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    external_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    steps JSONB, -- Array of objects: { "order": 1, "text": "...", "image_url": "...", "warning": "..." }
    tools_required JSONB, -- Array of strings: ["10mm Socket", "Lift"]
    parts_required JSONB, -- Array of objects: { "part_number": "...", "quantity": 1 }
    time_estimate_hours NUMERIC(4, 2),
    cautions TEXT, -- General warnings/cautions for the procedure
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_procedures_vehicle_id ON procedures(vehicle_id);

-- Technical Service Bulletins (TSBs) Table
CREATE TABLE tsbs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id TEXT NOT NULL,
    bulletin_number TEXT NOT NULL,
    issue_date DATE,
    title TEXT NOT NULL,
    summary TEXT,
    content TEXT, -- Full content (HTML or Text)
    affected_components JSONB, -- Array of strings
    models_affected JSONB, -- Array of strings if multi-model
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tsbs_vehicle_id ON tsbs(vehicle_id);
CREATE INDEX idx_tsbs_bulletin_number ON tsbs(bulletin_number);

-- Diagnostic Trouble Codes (DTCs) Table
CREATE TABLE dtcs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id TEXT NOT NULL,
    code TEXT NOT NULL, -- e.g., "P0300"
    description TEXT NOT NULL,
    possible_causes JSONB, -- Array of strings
    symptoms JSONB, -- Array of strings
    diagnostic_steps JSONB, -- Structured steps similar to procedures
    monitor_strategy TEXT, -- How the ECU monitors this
    malfunction_criteria TEXT, -- What triggers the code
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_dtcs_vehicle_id ON dtcs(vehicle_id);
CREATE INDEX idx_dtcs_code ON dtcs(code);

-- Specifications Table
CREATE TABLE specifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id TEXT NOT NULL,
    category TEXT NOT NULL, -- e.g., "Torque", "Fluids", "Engine"
    name TEXT NOT NULL, -- e.g., "Cylinder Head Torque"
    value TEXT NOT NULL, -- e.g., "50"
    unit TEXT, -- e.g., "ft-lbs", "liters"
    display_text TEXT, -- e.g., "50 ft-lbs"
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_specifications_vehicle_id ON specifications(vehicle_id);

-- Maintenance Schedules Table
CREATE TABLE maintenance_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id TEXT NOT NULL,
    interval_value INTEGER, -- The numeric interval (e.g., 10000)
    interval_unit TEXT, -- "Miles", "Kilometers", "Months", "Hours"
    action TEXT NOT NULL, -- "Inspect", "Replace", "Change", "Rotate"
    item TEXT NOT NULL, -- "Engine Oil", "Tires", "Air Filter"
    description TEXT, -- Full description line
    frequency_code TEXT, -- e.g., "A", "B", "I", "R"
    is_severe_service BOOLEAN DEFAULT FALSE,
    labor_time_hours NUMERIC(4, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_maintenance_vehicle_id ON maintenance_schedules(vehicle_id);

-- Labor Estimates Table
CREATE TABLE labor (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id TEXT NOT NULL,
    operation_code TEXT,
    description TEXT NOT NULL,
    hours NUMERIC(5, 2),
    skill_level TEXT, -- "A", "B", "C"
    category_id UUID REFERENCES categories(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_labor_vehicle_id ON labor(vehicle_id);

-- Parts Table
CREATE TABLE parts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id TEXT NOT NULL,
    part_number TEXT NOT NULL,
    description TEXT NOT NULL,
    manufacturer TEXT,
    list_price NUMERIC(10, 2),
    dealer_price NUMERIC(10, 2),
    quantity INTEGER DEFAULT 1,
    fitment_notes TEXT, -- Specific fitment details for this vehicle
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_parts_vehicle_id ON parts(vehicle_id);
CREATE INDEX idx_parts_part_number ON parts(part_number);

-- Wiring Diagrams & Component Locations
CREATE TABLE diagrams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id TEXT NOT NULL,
    category_id UUID REFERENCES categories(id),
    title TEXT NOT NULL,
    description TEXT,
    image_url TEXT NOT NULL,
    thumbnail_url TEXT,
    diagram_type TEXT, -- "Wiring", "Component Location", "Vacuum"
    interactive_points JSONB, -- For interactive diagrams: [{ "x": 10, "y": 20, "label": "Fuse 1" }]
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_diagrams_vehicle_id ON diagrams(vehicle_id);

-- ==========================================
-- 3. Processing Logs
-- ==========================================

CREATE TABLE ai_processing_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id TEXT,
    source_file TEXT,
    category TEXT, -- "Procedures", "TSBs", etc.
    status TEXT, -- "PENDING", "PROCESSING", "COMPLETED", "FAILED"
    error_message TEXT,
    tokens_used INTEGER,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 4. Security (RLS)
-- ==========================================

-- Enable Row Level Security on all tables
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE tsbs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dtcs ENABLE ROW LEVEL SECURITY;
ALTER TABLE specifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagrams ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_processing_logs ENABLE ROW LEVEL SECURITY;

-- Create simple read-only policy for authenticated users (example)
-- CREATE POLICY "Enable read access for all users" ON vehicles FOR SELECT USING (true);

-- Enable Row Level Security (RLS) for AI logs
-- Policy to allow the service role (backend) to perform operations on logs
CREATE POLICY "Allow full access to service_role"
    ON ai_processing_logs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Policy to allow authenticated users to view logs (if needed)
CREATE POLICY "Allow read access to authenticated users"
    ON ai_processing_logs
    FOR SELECT
    TO authenticated
    USING (true);

-- -----------------------------------------------------------------------------
-- USERS TABLE (Stripe Credits & Unlocks)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    credits INTEGER DEFAULT 0,
    unlocks JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Turn on Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own profile
CREATE POLICY "Users can view own profile" 
ON public.users FOR SELECT 
USING (auth.uid() = id);
