-- Align `public.articles` with `supabase_schema.sql` when production drifted (fixes PostgREST
-- PGRST204 "Could not find the 'code' column" and 42703 "column ... description does not exist").
--
-- Apply in Supabase SQL Editor for the project backing the app, then verify REST:
--   GET /rest/v1/articles?select=code,description&limit=1

ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS description TEXT;
