-- Fix PostgREST PGRST204: "Could not find the 'release_date' column of 'articles' in the schema cache"
-- when production `articles` predates full catalog fields in `supabase_schema.sql`.
--
-- Apply in Supabase SQL Editor, then reload schema (PostgREST picks up new columns automatically;
-- if errors persist, Dashboard → Settings → API → Reload schema / wait ~1 min).
--
-- Verify:
--   GET /rest/v1/articles?select=release_date,bulletin_number,sort,parent_bucket&limit=1

ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS subtitle TEXT;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS parent_bucket TEXT;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS thumbnail_href TEXT;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS bulletin_number TEXT;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS release_date TEXT;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS sort INTEGER;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS content_source TEXT DEFAULT 'MOTOR';
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'MOTOR';

CREATE INDEX IF NOT EXISTS idx_articles_parent_bucket ON public.articles(vehicle_id, parent_bucket);
