-- 1. Ensure vehicles.external_id is unique
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_external_id_key') THEN
        ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_external_id_key UNIQUE (external_id);
    END IF;
END $$;

-- 2. ARTICLES TABLE (Cached Normalized Content)
CREATE TABLE IF NOT EXISTS public.articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT REFERENCES public.vehicles(external_id),
    article_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content_html TEXT,
    category TEXT,
    source TEXT DEFAULT 'MOTOR',
    is_parsed BOOLEAN DEFAULT FALSE,
    tutorial_steps JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, article_id)
);

-- 3. SYSTEM SESSIONS TABLE (Proxy Auth Persistence)
CREATE TABLE IF NOT EXISTS public.system_sessions (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. USERS TABLE (Credit System)
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY, -- Maps to Supabase User ID
    credits INTEGER DEFAULT 0,
    unlocks JSONB DEFAULT '{}'::jsonb,
    stripe_customer_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. TRANSACTIONS TABLE (Credit Logs)
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT REFERENCES public.users(id),
    amount INTEGER NOT NULL,
    type TEXT NOT NULL, -- 'purchase' | 'unlock'
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    usd_cents INTEGER,
    vehicle_id TEXT,
    vehicle_name TEXT,
    module_type TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. AI PROCESSING LOGS (Background Parsing Progress)
CREATE TABLE IF NOT EXISTS public.ai_processing_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_file TEXT NOT NULL,
    status TEXT NOT NULL, -- 'PENDING' | 'COMPLETED' | 'FAILED'
    error_message TEXT,
    tokens_used INTEGER,
    processed_at TIMESTAMPTZ DEFAULT now()
);

-- 7. LEGACY/SPECIALIZED CONTENT TABLES
-- (Used by original proxy implementation in supabase.js)

CREATE TABLE IF NOT EXISTS public.procedures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT REFERENCES public.vehicles(external_id),
    external_id TEXT, -- Motor Article ID
    title TEXT NOT NULL,
    content_html TEXT,
    is_parsed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, title)
);

CREATE TABLE IF NOT EXISTS public.tsbs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT REFERENCES public.vehicles(external_id),
    bulletin_number TEXT NOT NULL,
    title TEXT NOT NULL,
    content_html TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, bulletin_number)
);

CREATE TABLE IF NOT EXISTS public.dtcs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT REFERENCES public.vehicles(external_id),
    code TEXT NOT NULL,
    description TEXT,
    content_html TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, code)
);

CREATE TABLE IF NOT EXISTS public.specifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT REFERENCES public.vehicles(external_id),
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(vehicle_id, category, name)
);

CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(name, type)
);

-- ENABLE RLS ON ALL TABLES
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_processing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tsbs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dtcs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- POLICIES (Public Read/Write for MVP - Tighten later)
-- Note: These are permissive to ensure flow works; in production use proper Auth.

CREATE POLICY "Public articles read" ON public.articles FOR SELECT USING (true);
CREATE POLICY "Public articles insert" ON public.articles FOR INSERT WITH CHECK (true);
CREATE POLICY "Public articles update" ON public.articles FOR UPDATE USING (true);

CREATE POLICY "Public system_sessions access" ON public.system_sessions FOR ALL USING (true);

CREATE POLICY "Public users access" ON public.users FOR ALL USING (true);
CREATE POLICY "Public transactions access" ON public.transactions FOR ALL USING (true);
CREATE POLICY "Public ai_logs access" ON public.ai_processing_logs FOR ALL USING (true);

CREATE POLICY "Public procedures access" ON public.procedures FOR ALL USING (true);
CREATE POLICY "Public tsbs access" ON public.tsbs FOR ALL USING (true);
CREATE POLICY "Public dtcs access" ON public.dtcs FOR ALL USING (true);
CREATE POLICY "Public specs access" ON public.specifications FOR ALL USING (true);
CREATE POLICY "Public categories access" ON public.categories FOR ALL USING (true);
