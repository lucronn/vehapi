# Data source and normalization (Torque)

**Canonical spec:** `documentation/DATA_SOURCE_AND_NORMALIZATION.md`

**In one line:** Supabase is the **runtime source of truth**; Motor (via `vehapiproxi` only) is for **discovery and ingest** until rows exist—**catalog eager once per vehicle**, **article/detail lazy on first open**, then **reads from Supabase only**.

Do not add client-side Motor fallbacks for normalized vehicles; extend ingest and Supabase reads instead.
