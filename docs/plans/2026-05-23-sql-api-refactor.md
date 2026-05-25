# SQL/API Refactor & Content-Normalization Plan

**Date:** 2026-05-23
**Status:** DRAFT — awaiting sign-off, execute in reviewable phases
**Trigger:** "2011 Nissan Rogue shows as 1985 Dodge" + request for full SQL/API
refactor/cleanup/modularization, incorporating the AtomicStep / LogicNode content
model and lazy-load normalization pipeline.

---

## 0. Guiding constraints

- **No big-bang rewrite.** Ship in phases; each phase is independently
  deployable, reversible, and verified before the next starts.
- **Don't break what works.** Catalog/articles/parts/maintenance DB-serving is
  live and correct — refactors must preserve current response contracts.
- **The ingestion worker is running.** Schema changes must be additive/online
  (no exclusive locks on the 19.6M-row `articles` table; use
  `CREATE INDEX CONCURRENTLY`, nullable adds, backfills in batches).
- **One ID model.** Every read path resolves vehicle identity through a single
  module — no ad-hoc parsing, no fuzzy `LIKE` on JSON text.

---

## 1. Current-state inventory (verified 2026-05-23)

### SQL is scattered across 3 layers with inconsistent ID handling
- `vehapiproxi/src/routes/db-endpoints.js` — `/api/db/*` (articles, normalization,
  years/makes/models, vehicle-motor-id). Uses `resolveAssociatedVehicleIds`.
- `vehapiproxi/src/routes/data-api.js` — `/api/data/:table` generic shim
  (articles, specifications, parts, …). *Just* fixed to resolve composite IDs.
- `vehapiproxi/src/function.js` — `articlesCacheMiddleware`,
  `referenceCacheMiddleware`, `metadataCacheMiddleware`, the `/name` endpoint,
  and the Motor proxy passthrough. Raw SQL inline.
- `vehapiproxi/src/db.service.js` — `resolveAssociatedVehicleIds` + assorted
  upserts/reads. Mixed concerns.

### Vehicle identity is the broken core (the Rogue→Dodge bug)
`/api/source/:source/:vehicleId/name` is a 4-step heuristic cascade:
1. URL parse (`YYYY:Make:Model`).
2. `vehicles` exact-match on resolved IDs.
3. **Fallback: `WHERE data::text LIKE '%"id": "<baseId>"%'` on `vehicle_metadata`,
   `LIMIT 5`, no ordering** — fuzzy full-text scan.
4. Year/make taken from the metadata **file path**, model matched on
   `model.id` which is **only unique per make/year** (Rogue `id=3398`,
   Cadillac `id=370`, …). → cross-make collisions → wrong vehicle.

### Content tables: target model partially exists, all empty
| Table | Rows | Note |
|-------|------|------|
| `procedures` | 0 | coarse: `steps jsonb`, `tools_required jsonb` embedded |
| `procedure_step` | 0 | flat row-per-step: `step_text, image_url, warning, note` — no structured specs/sequence |
| `dtcs` | 0 | linear `diagnostic_steps jsonb` — no branching graph |
| `media_asset` | 716 | usable as-is |
| `articles` | 19.6M | catalog list-level data (DB-served, working) |

→ Content normalization is effectively **greenfield**; no data migration risk.

---

## 2. Target architecture

```
Client ─► API route (thin) ─► Service (business logic) ─► Repository (SQL only)
                                     │
                                     └─► VehicleIdentity (single ID authority)
Normalization (lazy, on cache-miss): RawFetch → AIExtract → LLMAudit → Store
```

### 2.1 Vehicle identity module (`src/domain/vehicle-identity.js`)
Single authority. Pure, table-driven, deterministic, **no fuzzy matching**.
- `parseVehicleId(raw)` → `{ kind: 'ymme'|'composite'|'base'|'unknown',
  year?, make?, model?, baseVehicleId?, engineId?, encodedForms[] }`.
- `resolveAssociatedVehicleIds(raw)` (moved here, unchanged behavior).
- `resolveVehicleName(raw)` — deterministic precedence:
  1. `YYYY:Make:Model` → format directly.
  2. `vehicles` table exact match on resolved IDs.
  3. `vehicle_metadata` **structured** lookup: match on `baseVehicleId`
     (globally unique) against `data.body.models[].baseVehicleId`, taking
     year/make from the **matched model's own fields** (fallback to path only
     when the row is unambiguous). Never match on non-unique `model.id`.
  4. `Unknown Vehicle`.
- Backed by an indexed lookup, not `data::text LIKE`. See §4.1.

### 2.2 Repository layer (`src/repositories/`)
One module per aggregate; **all SQL lives here**, every vehicle-keyed query goes
through `resolveAssociatedVehicleIds`:
- `articles.repo.js`, `reference.repo.js` (fluids/parts/maintenance),
  `vehicles.repo.js`, `metadata.repo.js`, `procedures.repo.js`, `dtcs.repo.js`.
- Returns plain rows; no HTTP/shape concerns.

### 2.3 Service layer (`src/services/`)
Reshaping + business rules (e.g. build `filterTabs`, Motor-body reconstruction,
normalization eligibility, the monetization gate). Routes/middlewares become
thin adapters calling services.

---

## 3. New content schema (AtomicStep / LogicNode)

All additive. `procedures`/`procedure_step`/`dtcs` are empty, so we evolve them
in place rather than create parallel tables.

### 3.1 Atomic steps (procedures)
Evolve `procedure_step` to the AtomicStep model:
```sql
ALTER TABLE procedure_step
  ADD COLUMN IF NOT EXISTS procedure_id   uuid REFERENCES procedures(id),
  ADD COLUMN IF NOT EXISTS operation_name text,
  ADD COLUMN IF NOT EXISTS sequence_order int,
  ADD COLUMN IF NOT EXISTS spec_data      jsonb DEFAULT '{}'::jsonb,  -- {torque_nm, tool_ids[]}
  ADD COLUMN IF NOT EXISTS safety_data    jsonb DEFAULT '{}'::jsonb,  -- {warnings[]}
  ADD COLUMN IF NOT EXISTS media_assets   jsonb DEFAULT '[]'::jsonb;  -- [{url,type}] or media_asset FKs
```
JSON Schema `AtomicStep` (from your plan) is the validation contract for the
extractor output and the serving API.

### 3.2 Logic nodes (DTC diagnostic trees) — NEW
```sql
CREATE TABLE IF NOT EXISTS logic_nodes (
  node_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id     uuid NOT NULL,            -- groups a diagnostic tree
  vehicle_id  text NOT NULL,
  dtc_code    text,
  node_type   text NOT NULL CHECK (node_type IN ('decision','measurement','terminal_action')),
  input_criteria jsonb DEFAULT '{}'::jsonb,  -- {dtc_code, expected_range}
  edge_logic  jsonb DEFAULT '[]'::jsonb,      -- [{condition, next_node_id}]
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logic_nodes_tree ON logic_nodes(tree_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logic_nodes_vehicle ON logic_nodes(vehicle_id);
```
`dtcs` stays as the DTC summary; `logic_nodes` holds the branching graph keyed by
`tree_id` + `dtc_code`. JSON Schema `LogicNode` is the validation contract.

---

## 4. Lazy-load normalization pipeline

Implements your operational framework. Per (vehicle, content-type):
1. **Cache check** — repository hit in Cloud SQL? serve normalized.
2. **Raw fetch** (miss) — pull vendor data via Motor proxy; persist a raw
   fallback copy (`evidence_ingest` / object storage) keyed by sha256.
3. **Normalize** — AI extraction engine segments raw → `AtomicStep` /
   `LogicNode` rows; validated against the JSON Schemas before insert.
4. **Audit** — background LLM auditor cross-checks normalized vs raw to confirm
   no torque/safety/spec data dropped; flags discrepancies to
   `failed_extractions` / `ai_processing_logs`.
5. **Store & serve** — relational insert; monetization gate (the "30s ad")
   gates *serving*, not extraction.

Reuses existing `ai_processing_logs`, `failed_extractions`, `evidence_ingest`,
`content_chunk`. Built as a service invoked by serving endpoints on cache-miss.

### 4.1 Identity-fix supporting index
To make `resolveVehicleName` step 3 fast + correct without `data::text LIKE`,
either:
- (a) a generated/materialized `vehicle_metadata_models(base_vehicle_id, year,
  make, model, engine_ids)` projection table, refreshed on metadata upsert; or
- (b) a GIN/expression index over the models array.
Plan favors (a): a small, queryable, indexable projection — deterministic and
cheap.

---

## 5. Phased execution (each phase: PR + verify + sign-off)

| Phase | Scope | Risk | Fixes |
|-------|-------|------|-------|
| **1. Identity module** | Extract `vehicle-identity.js`; rewrite `/name`; add `vehicle_metadata_models` projection + backfill; unit tests incl. Rogue/Dodge regression | Low | **Rogue→Dodge bug** | ✅ 2026-05-23 |
| **2. Repository extraction** | Move all SQL from db-endpoints/data-api/function.js middlewares into `repositories/`; no behavior change; contract tests | Med | consistency | ✅ 2026-05-23 |
| **3. Service layer** | Thin routes; centralize reshaping + normalization eligibility + monetization gate | Med | maintainability | ✅ 2026-05-23 |
| **4. Content schema** | `procedure_step` ALTERs + `logic_nodes` table (online/additive); JSON Schema validators | Low | enables steps/DTC trees | ✅ 2026-05-23 |
| **5. Normalization pipeline** | Lazy-load extract→audit→store; serving endpoints for atomic steps + DTC trees | High | new capability | ✅ 2026-05-23 |
| **6. Cleanup** | Delete dead Supabase-era code paths; docs; consolidate ID forms | Low | tech debt | ✅ 2026-05-24 |

**Phase 1 is the priority** — it fixes the visible bug and establishes the ID
authority everything else depends on.

---

## 6. Open questions for sign-off
1. Phase 1 first (bug fix) before the larger content work — confirm ordering?
2. AI extraction/audit: which model + budget? (existing pipeline uses Gemini
   2.5 Flash Lite per project notes — reuse?)
3. Monetization "30s ad" gate — existing credits/unlock system, or new?
4. Projection table (4.1 option a) vs index (option b) for identity lookup?
5. Keep `procedures.steps jsonb` (coarse) as a denormalized cache, or fully
   replace with `procedure_step` rows?
