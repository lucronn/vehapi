-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Vehicles Table
-- Stores the core vehicle information.
CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    year INTEGER NOT NULL,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    submodel TEXT, -- For trim levels like "Base", "Blue", etc.
    engine TEXT, -- e.g., "V6-3.6L"
    vin TEXT, -- Partial or full VIN if applicable
    external_id TEXT, -- The ID from the source system (e.g., "66966:2600")
    content_source TEXT, -- e.g., "MOTOR", "OEM"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_vehicles_external_id ON vehicles(external_id);
CREATE INDEX idx_vehicles_ymm ON vehicles(year, make, model);

-- 2. Categories Table
-- Represents the hierarchical structure of data (formerly "Buckets").
-- Can be used for Procedures, Diagrams, Specifications groupings, etc.
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_id UUID REFERENCES categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- e.g., "Procedures", "Wiring Diagrams", "Specifications", "Maintenance"
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_categories_parent_id ON categories(parent_id);
CREATE INDEX idx_categories_type ON categories(type);

-- 3. Articles Table
-- Stores text-based content like Procedures, TSBs, Descriptions.
CREATE TABLE articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    external_id TEXT, -- e.g., "P:565148963"
    title TEXT NOT NULL,
    subtitle TEXT,
    content TEXT, -- HTML or Markdown content
    article_type TEXT NOT NULL, -- "Procedure", "TSB", "Description", "Precautions"
    metadata JSONB, -- Stores extra fields like bulletinNumber, releaseDate, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_articles_vehicle_id ON articles(vehicle_id);
CREATE INDEX idx_articles_category_id ON articles(category_id);
CREATE INDEX idx_articles_external_id ON articles(external_id);

-- 4. Diagrams Table
-- specialized table for visual content, often linked to articles or standalone
CREATE TABLE diagrams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    external_id TEXT, -- e.g., "CMPLOC:527847494"
    title TEXT NOT NULL,
    subtitle TEXT,
    image_url TEXT, -- URL to the full image
    thumbnail_url TEXT, -- URL to the thumbnail
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_diagrams_vehicle_id ON diagrams(vehicle_id);

-- 5. Parts Table
-- Stores parts information associated with vehicles.
CREATE TABLE parts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    part_number TEXT NOT NULL,
    description TEXT NOT NULL,
    manufacturer TEXT,
    price NUMERIC(10, 2), -- Storing price as numeric
    quantity INTEGER DEFAULT 1,
    category TEXT, -- e.g., "Brake", "Engine"
    metadata JSONB, -- Extra details
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_parts_vehicle_id ON parts(vehicle_id);
CREATE INDEX idx_parts_part_number ON parts(part_number);

-- 6. Labor Table
-- Stores labor estimates.
CREATE TABLE labor (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    operation_id TEXT,
    description TEXT NOT NULL,
    hours NUMERIC(5, 2), -- Labor hours, e.g., 1.50
    skill_level TEXT, -- e.g., "B", "A"
    category TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_labor_vehicle_id ON labor(vehicle_id);

-- 7. Maintenance Schedules Table
-- Stores scheduled maintenance intervals and actions.
CREATE TABLE maintenance_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    interval_miles INTEGER,
    interval_months INTEGER,
    interval_kilometers INTEGER,
    interval_hours INTEGER, -- For operating hours
    action TEXT NOT NULL, -- "Inspect", "Replace", "Rotate", etc.
    description TEXT NOT NULL, -- Detailed description of the task
    frequency_description TEXT, -- e.g., "Every 10,000 miles"
    is_severe_service BOOLEAN DEFAULT FALSE,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_maintenance_vehicle_id ON maintenance_schedules(vehicle_id);
CREATE INDEX idx_maintenance_interval ON maintenance_schedules(interval_miles);

-- 8. Specifications Table
-- Stores vehicle specifications and fluid capacities.
CREATE TABLE specifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    category TEXT NOT NULL, -- e.g., "Torque", "Fluids", "Dimensions"
    name TEXT NOT NULL, -- e.g., "Engine Oil Capacity", "Wheel Nut Torque"
    value TEXT NOT NULL, -- e.g., "5.5 Quarts", "100 ft-lbs"
    unit TEXT, -- e.g., "Quarts", "ft-lbs"
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_specifications_vehicle_id ON specifications(vehicle_id);

-- 9. DTCs (Diagnostic Trouble Codes) Table
CREATE TABLE dtcs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    code TEXT NOT NULL, -- e.g., "P0300"
    description TEXT NOT NULL,
    possible_causes TEXT, -- Often a list or long text
    bucket TEXT, -- Classification of the DTC
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_dtcs_vehicle_id ON dtcs(vehicle_id);
CREATE INDEX idx_dtcs_code ON dtcs(code);

-- 10. AI Processing Metadata Table (Optional but requested)
-- Tracks the AI processing status of raw data chunks before normalization.
CREATE TABLE ai_processing_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    source_file TEXT,
    status TEXT, -- "PENDING", "PROCESSING", "COMPLETED", "FAILED"
    error_message TEXT,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
