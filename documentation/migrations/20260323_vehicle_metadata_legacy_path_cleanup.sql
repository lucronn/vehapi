-- Optional one-time cleanup: legacy `vehicle_metadata.path` values used `/api/years` while
-- `metadataCacheMiddleware` looks up `/years` (see `normalizeVehicleMetadataPath` in `vehapiproxi/src/supabase.js`).
-- Runtime falls back to legacy keys and upserts canonical rows; this SQL removes duplicate keys in DB.
--
-- Run in Supabase SQL editor on the target project when convenient (not required for correctness).

-- 1) If both `/api/...` and `/...` exist for the same logical path, drop the legacy `/api/...` row.
DELETE FROM public.vehicle_metadata AS legacy
USING public.vehicle_metadata AS canonical
WHERE legacy.path LIKE '/api/%'
  AND canonical.path = substring(legacy.path from 5)
  AND length(canonical.path) > 0
  AND canonical.path NOT LIKE '/api/%';

-- 2) Rename remaining `/api/...` paths to canonical `/...` (no conflicting row).
UPDATE public.vehicle_metadata AS vm
SET path = substring(vm.path from 5), updated_at = now()
WHERE vm.path LIKE '/api/%'
  AND NOT EXISTS (
    SELECT 1 FROM public.vehicle_metadata AS v2
    WHERE v2.path = substring(vm.path from 5)
  );
