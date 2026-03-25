# Data source and normalization (product architecture)

This document is the **authoritative description** of how Torque uses **Supabase** versus the **Motor API** (accessed only through **`vehapiproxi`**, never from the browser). Agents and implementers should align new work with it; existing code may still be migrating—see **Implementation status** in `PROGRESS.md`.

---

## Goal

**Supabase is the runtime source of truth** for vehicle-scoped data the app displays. The Motor API is an **upstream catalog and content supplier** used to **discover** what exists and to **ingest** normalized rows. User-facing flows should **read Supabase** whenever the data is present; Motor involvement should **shrink over time** as normalization fills the database (including **lazy** per-resource ingest on first access).

---

## Rules

### 1. Read path: Supabase first; Motor only to fill gaps

- If the required rows **exist in Supabase**, the **frontend reads Supabase only** (via the app’s Supabase client and/or backend APIs backed by Supabase).
- If the data **does not exist** in Supabase, the system may use Motor (through the proxy/worker) as an **index**: discover what is available, **normalize**, **persist**, then serve from Supabase.
- The Motor API must **not** be treated as a permanent parallel “live” source for the same vehicle once Supabase has authoritative normalized data for that scope.

### 2. First vehicle access: catalog/index normalization (one-time, permanent)

When a vehicle is accessed and Supabase has **no** (or incomplete) **catalog-level** data—article list, buckets/silos, titles/metadata needed to build the menu—the app **ingests from Motor once**, **writes normalized catalog rows to Supabase**, and the UI reflects **persisted** data.

- That ingest is **durable**: future visits use **Supabase only** for that catalog scope unless a deliberate **repair/re-sync** is required (bad rows, schema migration, operator tooling).

### 3. Lazy normalization by usage (article bodies and heavy payloads)

Catalog rows record **that** an article exists (e.g. a procedure) and how it is grouped; **full HTML/body** may not be stored yet.

- When the user **opens** that article, if the normalized content is **still missing** in Supabase, the pipeline **fetches from Motor as needed**, **normalizes**, **persists** (e.g. article body, linked normalized tables), and returns data to the client.
- After that write, **future opens** read **from Supabase** without Motor on the hot path.

This **lazy-by-usage** pattern **phases Motor out** of routine use: the more the app is used, the more Supabase holds the material users actually touch.

---

## Terminology

| Term | Meaning |
|------|--------|
| **Index (Motor)** | Discovery responses: lists, buckets, IDs, metadata—used to know *what* to store, not the long-term read path once Supabase is populated. |
| **Normalized** | Data transformed to Torque’s Supabase schema (including AI rewrite where required by product rules), stored durably. |
| **Eager** | Catalog/reference ingest tied to first dashboard load or explicit sync—runs to completion for that vehicle’s catalog scope. |
| **Lazy** | Ingest triggered when the user requests a specific resource whose body/detail is not yet in Supabase. |

---

## Anti-patterns

- **No `motor.com` from the SPA** — unchanged: all upstream calls go through **`vehapiproxi`** (`environment.apiUrl`).
- **No “Motor fallback” for display** when Supabase is already supposed to hold normalized data for that vehicle—fix **ingest**, **flags**, or **RLS**, not the read contract.
- **No repeated full-catalog Motor reads** for routine navigation once Supabase has the catalog for that vehicle (unless repair).

---

## Related code (non-exhaustive)

- `src/services/data-sync.service.ts` — eager reference sync, catalog upserts, per-article sync.
- `src/services/vehicle-data.service.ts` — for `vehicles.is_normalized`, section lists (`loadSectionData`), specs (`loadSpecs`), availability (`getAvailableSections`), maintenance (`loadMaintenanceSchedules`), and parts (`loadParts`) **do not** use Motor for display when Supabase is empty; background lazy/eager ingest fills gaps.
- `vehapiproxi/src/background_worker.js` — server-side parse and normalized inserts.

---

## Implementation status

| Area | Status |
|------|--------|
| **Dashboard sections (normalized)** | `loadSectionData`, `loadMaintenanceSchedules`, `loadParts` — Supabase-only; empty → UI empty + background `DataSyncService` lazy ingest where applicable (2026-03-25). |
| **Specs / section availability** | Already Supabase-only when normalized. |
| **Article bodies** | Lazy via article viewer / proxy + `syncSingleArticle` (existing). |
| **Pre-normalization vehicles** | Motor proxy reads remain until `is_normalized` is false. |

---

## Document history

- **2026-03-25** — Initial version: codifies Supabase-first reads, first-touch catalog ingest, lazy per-article normalization, and Motor as ingest/index only.
- **2026-03-25** — `VehicleDataService` aligned: no Motor display fallback for normalized vehicles on section lists, maintenance, or parts; implementation status table added.
