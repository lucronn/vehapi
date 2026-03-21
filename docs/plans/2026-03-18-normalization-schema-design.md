# Normalization & Supabase schema design (greenfield)

**Status:** Draft for review  
**Date:** 2026-03-18  
**Goals:** Technician-truth canonical data, cross-make consistency, no silent loss of useful Motor information, future LLM chatbot grounding. Supabase may be **dropped and recreated** from scratch.

**Implementation order (L1 facts):** **1 → 2 → 3** — (1) specs / `spec_fact`, (2) maintenance / `maintenance_task`, (3) procedures / `procedure`. **In parallel or immediately after phase 1:** wiring diagrams, component locations, labor, TSB+DTC normalization **including PDF/image text extraction via Nemotron** when native text is insufficient.

---

## 1. Ground truth model (agreed)

- **C + technician truth:** We keep **evidence** (what Motor sent) and **assertions** (what we believe is true for a tech).
- **Reshaping and inference are required** because OEM data is inconsistent across makes and even within the same Y/M/M/E.
- **Inference must be traceable:** every derived field links to **sources** (raw payload refs, article ids, rules version) so we can audit and re-run extractors.

### 1.1 Media retention (near term vs long term)

- **Long run:** **Do not rely on durable storage of PDFs or raster images** as the product source of truth. Durable artifacts should be **L1 structured data**, **extracted text** (from PDFs/HTML), and **embedding vectors** (and any **vector graphics** source files Motor provides, e.g. SVG, when available). Binary PDFs/images are **ingest inputs**, not the archival format.
- **Near term (now):** **Allowed and expected** to **store the image or vector file** in L0/Storage when it exists, so extractors can run, regressions can compare, and gaps in automation are covered.
- **Diagrams:** **Semantic vectorization** (high-quality **embeddings** for whole-diagram and/or regions, and/or **structured circuit/graph** extracted via **VLM or specialized tooling**) is **required eventually** for accurate search and chatbot grounding. Until then, keep **`media_asset`** + extract **L1 labels/edges** + **L2 embeddings** as the path off ramps from raw pixels.

### 1.2 Catalog presentation (silos, buckets, titles)

Every **`content_item`** should support **consistent navigation and search** across OEMs:

- **Structured placement:** canonical **silo** (module), **category**, **subcategory** (FKs to `canonical_bucket` or parallel `content_category` tree), plus optional **tags** (e.g. system: brakes, HVAC; symptom; component).
- **Rich copy (technician-useful):** beyond Motor’s raw `title`, persist **`subtitle`** and **`description`** that are **useful and accurate** — sourced from Motor fields when good; otherwise **refined or generated from content** (catalog fields first; **lazy upgrade** when article body / PDF extract / diagram OCR becomes available). Enriched text must be **traceable** (`enrichment_source`: motor_raw | rules | llm_extract, `enrichment_version`).
- **No silent overwrite:** keep **`motor_title`**, **`motor_subtitle`**, **`motor_description`**, **`motor_parent_bucket`**, **`motor_bucket`** alongside canonical fields so regressions and audits can compare OEM vs normalized.

---

## 2. Three layers (logical)

| Layer | Purpose | Loss policy |
|-------|---------|-------------|
| **L0 Evidence** | Append-only **ingest** of Motor responses (JSON/HTML) and, **for now**, binaries (PDF, PNG, JPEG, SVG, …). Keyed by URL/path, vehicle key, timestamp/hash. Long-term policy may **purge blobs** after validated L1+L2 backfill while keeping **hashes + metadata** for audit. | **No silent loss during ingest** (except secrets). **Retention** of blobs is a **policy decision** once extraction is trusted. |
| **L1 Canonical documents** | Normalized **technician-facing** structures: procedures as steps, specs as quantity+unit+context, maintenance as interval+action+conditions. Filled by rules + optional LLM **with JSON schema** and validation. | Allowed to **omit** only after explicit mapping table (“deprecated / not used”). |
| **L2 Retrieval / chat** | Chunks, **embedding vectors**, citation pointers into L1; diagram retrieval leans on **vectors + structured diagram facts**, not on serving archived images. | Optimized for recall; must **cite** L1 ids + (where kept) L0 evidence ids / content hashes. |

Supabase can host L0–L2 in one project with clear **table prefixes or schemas** (`evidence.*`, `core.*`, `rag.*`) to avoid mixing concerns.

### 2.1 Backend reality check (Torque / vehapiproxi + `MotorApiService`)

Verified from repo/docs (not a guarantee of every OEM response):

| Asset | How it arrives | Normalization implication |
|-------|----------------|---------------------------|
| **Graphics** (diagrams, component-location images, inline article images) | `GET /api/source/{contentSource}/graphic/{id}` → **binary** body; optional `w`/`h`. Format is whatever Motor returns — set **`Content-Type` from response** (often `image/png`, `image/jpeg`; **SVG or other vector** possible depending on upstream). | **Now:** L0 blob + `mime_type` + `graphic_id`. **Later:** optional blob purge after **L1 diagram graph / labels** + **L2 embeddings** validated. **Roadmap:** VLM/tooling to **vectorize** diagram semantics (embeddings + structured topology), not just store pixels. |
| **Article body** | Often HTML; **PDF** may appear as **base64** in JSON (`body.pdf`) and is normalized client-side to a data URI for viewing. | **Now:** L0 JSON + PDF bytes for processing. **Long-term:** keep **text/layout extract + L1**; PDF blob **eligible for deletion** after successful extract + hash recorded. |
| **Labor** | `GET /api/source/{contentSource}/vehicle/{vehicleId}/labor/{articleId}` — IDs often **`L:…`**. | L1: **`labor_operation`** (time, description, operation code, linked parts) tied to `content_item` + evidence. |

**Action:** During ingest, always record **`content_type`** / **`mime_type`** and **`content_disposition`** if present so we don’t assume PNG-only.

---

## 3. Schema brainstorm — domains (greenfield)

Below is a **conceptual** set of tables (names negotiable). Intent is **one row = one fact** where possible, with **many-to-many** where Motor collapses dimensions.

### 3.1 Identity & catalog

- **`vehicle`** — Stable app vehicle id; `external_motor_id`, `content_source`, Y/M/M display, optional `engine_id`, VIN decode ref.
- **`vehicle_variant`** (optional) — Trim/engine/body where Motor splits behavior; links articles/specs to a variant set.
- **`make_model_taxonomy`** — Canonical make/model/engine strings + aliases (for cross-source matching and chatbot vocabulary).

### 3.2 Evidence (L0)

- **`evidence_ingest`** — One row per upstream response: `fetched_at`, `url_path`, `http_status`, `content_type`, `body_json` OR `body_storage_ref` (Storage for huge HTML), `sha256`, `vehicle_id` nullable for global metadata.
- **`evidence_link`** — Connects evidence to extracted L1 rows (`entity_type`, `entity_id`, `extractor_version`).

### 3.3 Content catalog (list, not full HTML)

- **`content_item`** — Unified catalog row for each Motor article (or labor id):
  - **Identity:** `kind` (procedure|tsb|dtc|diagram|component_location|spec_article|labor|…), `motor_article_id`, `vehicle_id`, `variant_id` nullable, `content_source`.
  - **Motor verbatim:** `motor_title`, `motor_subtitle`, `motor_description`, `motor_parent_bucket`, `motor_bucket`, `motor_code`, `motor_sort`, bulletin/release fields as applicable.
  - **Canonical structure:** `canonical_silo_code` (UI module: dtcs|tsbs|procedures|diagrams|specs|parts|maintenance|…), **`canonical_category_id`**, **`canonical_subcategory_id`** (nullable), optional **`tags`** (text[] or join table).
  - **Enriched presentation (technician-facing):** `display_title` (may equal motor or cleaned), **`display_subtitle`**, **`display_description`** (short summary, 1–3 sentences where possible), optional **`display_long_description`** once body/OCR exists; **`search_text`** (concat for FTS) maintained by job.
  - **Enrichment meta:** `enrichment_source`, `enrichment_version`, `enriched_at`, link to **`extraction_run`** when LLM involved.
  - **Other:** `thumbnail_href`, `metadata_json` for odd Motor keys **without dropping** them.

- **`canonical_bucket`** — Tree for **silo → category → subcategory**: stable `code`, **`display_name`**, optional **`description`** (what lives in this bucket), **`sort_order`**, `parent_id`, `module_type` (for credits/unlock alignment). Maps OEM bucket strings via **`bucket_alias`** (OEM string → canonical id).

- **`bucket_alias`** (optional table) — `content_source`, `raw_parent_bucket`, `raw_bucket`, `canonical_bucket_id`, `confidence`, so messy Motor labels still land in one tree.

### 3.4 Media & diagrams (L0 + L1 + L2)

- **`media_asset`** — `graphic_id` or URL, `vehicle_id`, `content_source`, `mime_type`, `byte_size`, `storage_path` (Supabase Storage) **optional once purge policy applies**, `sha256` (**always** keep hash for provenance), `source` (inline_from_article | catalog_thumbnail | direct_graphic_api). Links to **`evidence_ingest`** when fetched via graphic API.
- **`diagram_document`** (wiring) — FK `content_item`, title/system/circuit normalized fields, ordered **page** records (each page may reference a `media_asset` **or** only `sha256`/embedding after blob purge), **`embedding`** per page or whole doc (pgvector / external) as the **primary** long-term retrieval handle for “diagram smell.”
- **`component_location_document`** — Same pattern as diagrams; semantic distinction in `canonical_bucket` + L1 fields (e.g. harness connector refs).
- **Extraction:** rules for “find all graphic ids in HTML”; **Nemotron (multimodal / vision)** to extract topology/labels when needed; native text first where applicable. **Goal:** accuracy of **structured + vector** representation; pixels are disposable after quality gates.

### 3.5 Technician-truth facts (L1)

- **`spec_fact`** — `vehicle_id`, `spec_type` (torque, fluid, tire_pressure, capacity, dimension, …), `component` (normalized string or FK), `value_num`, `value_text`, `unit`, `conditions` (JSON: temp, altitude, severe duty), `confidence`, `sources` via `evidence_link`.
- **`maintenance_task`** — Normalized task: action, parts, interval miles/months, severity, notes; link to Motor schedule rows via mapping, not 1:1 only.
- **`procedure`** — Ordered steps, tools, parts, cautions, time; `source_article_id`; versioned when re-extracted.
- **`labor_operation`** — Motor labor row normalized: `article_id` (`L:…`), operation title, **labor hours** (or time bands), difficulty, linked **`part_application`** rows, notes; `evidence_link` to labor API JSON.
- **`tsb_record`** — Bulletin number, title, dates, applicability; **`pdf_media_asset_id`** when content is PDF; **`extracted_text`** / **`ocr_document`** (from native extract or **Nemotron**); **`structured_fields`** (JSON) from validated **Nemotron** on extracted text.
- **`dtc_record`** — Canonical code (P/C/B/U + number), description, monitor, criteria, symptoms, tests; **`pdf_media_asset_id`** when DTC “article” is PDF; same **extract → Nemotron structured** path as TSB; link to related procedures/diagrams via graph edges optional.

### 3.6 PDF / image text pipeline (TSB, DTC, diagrams)

1. **L0 (ingest):** Store PDF in Storage **for now**; hash; `evidence_ingest` row.  
2. **Native text:** embedded PDF text (PyMuPDF / pdfminer / pypdf) when present — no API call.  
3. **When necessary — Nemotron:** rasterized pages or diagram images → **multimodal** NVIDIA API (see **Appendix A**); populate `ocr_document` / `extracted_text`.  
4. **L1:** Deterministic parsers + **Nemotron with JSON schema** on extracted text; tie claims to page/span where possible.  
5. **Catalog sync:** push key facts into **`content_item.display_*`** and **`search_text`**.  
6. **Quarantine / retention:** low-confidence flagged; optional PDF blob delete per policy while keeping hash + extract.

### 3.7 Parts

- **`part_application`** — Part number, description, position, notes, `vehicle_id` or variant; keep Motor list price as **evidence-linked** optional fields; **many rows link to `labor_operation`**.

### 3.8 LLM / RAG (L2)

- **`content_chunk`** — `text`, `content_item_id` or L1 fact ids, **`diagram_embedding_ref`** / **`media_asset_id`** optional during transition, `chunk_index`, **`embedding`** (pgvector or external) — **primary** durable retrieval signal for unstructured/diagram-heavy content alongside **L1 structured diagram** rows.
- **`extraction_run`** — Batch id, model, prompt version, validator result, for reproducibility.

---

## 4. Normalization pipeline (high level)

1. **Ingest** → write **L0** (JSON/HTML; **store PDF/image/vector blob while needed**).  
2. **Classify** → `content_item` rows: map OEM silos/buckets → **`canonical_bucket`** (via rules + **`bucket_alias`**); set **`canonical_silo_code`**, category, subcategory.  
3. **Enrich catalog copy** → populate **`display_subtitle`** / **`display_description`** from Motor when adequate; otherwise rules + **Nemotron** on catalog + first-line extract only (until full body). **Re-run enrichment** when article HTML/PDF/diagram text becomes available (lazy sync) so descriptions stay grounded in content.  
4. **Extract** deeper L1 (procedures, specs, …). **PDF TSB/DTC** → native text then **Nemotron** if needed → structured L1 + **refresh `content_item` descriptions**. **Diagrams** → `media_asset` + **Nemotron** when needed → L1 + L2 embeddings; **refresh catalog descriptions**. **Labor** → labor API parser.  
5. **Validate** (required fields, units, ranges, embedding quality, **enrichment confidence**); failures → quarantine.  
6. **Publish** L2 chunks + embeddings (include **enriched titles/descriptions** in chunk text where helpful); **optional blob lifecycle** after trusted extract.

---

## 5. Consistency across makes

- **Canonical vocabulary tables** (fluids, components, intervals) with **aliases** per OEM wording.  
- **`canonical_bucket` + `bucket_alias`:** one navigable tree in the app; OEM-specific strings never become separate silos unless intentional.  
- **Catalog copy rules:** shared prompts/templates per `kind` so **display_description** tone and structure are consistent (symptom → cause → action for TSB-ish; code + system + meaning for DTC, etc.).  
- **Extractor config per content_source** when behavior diverges (Ford vs MOTOR paths), still writing the **same L1 column shapes**.  
- **Golden vehicles** (few Y/M/M/E): regression fixtures comparing L1 counts, spot facts, and **sample `content_item` enriched fields** after each extractor bump.

---

## 6. Chatbot grounding (later)

- Answers must return **citations**: `content_item_id`, `procedure.id`, `spec_fact.id`, `dtc_record` / `tsb_record`, **`diagram_document` / diagram structured ids**, **embedding / chunk ids** (L2), **`labor_operation`**, and/or `evidence_ingest.id` / **content hash**.  
- Prefer **structured L1** for factual Q&A; use **chunks** (including **`display_title` / `display_description`** from `content_item` in chunk preambles) for browse/discovery-style answers with citations.  
- **Diagram questions:** **L1 topology/labels** + **vector retrieval**; **`media_asset`** only while blobs exist.  
- Never treat LLM extraction as sole source without **traceability** (hash, extract version, or evidence id).

---

## 7. Greenfield migration strategy

1. Export anything you must keep (optional; you prefer clean slate).  
2. Replace `supabase_schema.sql` with new DDL + RLS templates.  
3. Ship **migrations** in order: evidence → catalog → facts → RAG.  
4. Turn on **dual-write** briefly only if production already had users; otherwise **hard cut** is fine.

---

## 8. Open decisions (need your input later)

- **pgvector** in Supabase vs external vector DB (diagram + text embeddings).  
- **Blob lifecycle:** when to **delete** PDFs/images (per content type, per confidence score); minimum **hash + extracted artifact** retention.  
- **Diagram vectorization:** **Nemotron multimodal** vs specialized wiring tools for graph accuracy; single global embedding vs **region / net** embeddings.  
- **Nemotron model ids:** which SKU for **text** vs **document/vision** (e.g. parse/VL families on integrate API) — confirm in NVIDIA catalog.  
- **LLM in extraction loop**: order **specs → maintenance → procedures**; TSB/DTC extract and labor early; diagrams once `media_asset` ingest exists.  
- **Catalog enrichment:** tone/length limits for **`display_description`**; whether to show OEM-only vs enriched copy in UI toggle.  
- **Severity / “confidence”** visible to end users or internal only.

---

## 9. Next step

**In repo (2026-03-19):** Phase-1 DDL — `documentation/migrations/20260319_phase1_normalization.sql` (+ full `supabase_schema.sql`); `npm run migrate:phase1`; worker dual-writes **`content_item`** + L0 **`evidence_ingest`** on articles/v2 catalog; **native PDF text** → `content_html` when HTML absent (`pdf_native_text.js`). **In repo (2026-03-20):** L1 **`spec_fact`** — `documentation/migrations/20260320_l1_spec_fact.sql`; `npm run migrate:l1-spec-fact`; worker dual-writes from parsed specs + **`evidence_link`** (`entity_type=spec_fact`) when L0 insert succeeds. **Next:** `maintenance_task` L1, structured **`procedure`** L1 (beyond current `procedures` table), Nemotron/RAG as scoped.

---

## Appendix A — PDF / image text extraction (Torque: **Nemotron**)

**Product decision:** Use **NVIDIA Nemotron** (already wired in **`vehapiproxi/src/ai_parser.js`** — `OpenAI` SDK, `https://integrate.api.nvidia.com/v1`, `NVIDIA_API_KEY`) to **extract text from PDFs and images when necessary** (scanned TSB/DTC, diagram pages, messy layouts), and to support **structured downstream parsing** (JSON schema, same patterns as `parseWithAI`).

**Current code:** `ai_parser.js` uses **text-only** `chat.completions` with `nvidia/nemotron-3-super-120b-a12b`. **Implementation work:** add **multimodal** messages (base64 `image_url` per page) and/or call **document-oriented** NVIDIA models (e.g. **Nemotron-Parse** / VL models on the same integrate API — **confirm current model ids** in [NVIDIA NIM multimodal / document docs](https://docs.api.nvidia.com/nim/reference/multimodal-apis)). **Single AI vendor** for OCR/VLM + existing rewrite/tutorials/common-issues.

**Cost / scale:** Nemotron is **NVIDIA-billed** (quotas apply). At **hundreds of thousands** of documents, **always run native PDF text first** so Nemotron runs only when needed.

### A.1 Pipeline order (recommended)

1. **Native PDF text (no Nemotron):** **PyMuPDF / pdfminer.six / pypdf** — embedded text per page. If yield is good, **stop**; store in L0/L1.
2. **When necessary — Nemotron on raster:** Rasterize sparse-text pages (or diagram PNG/JPEG) → multimodal `chat.completions` with `image_url` (`data:image/png;base64,...`). Prompt: transcribe with reading order; optional JSON for blocks/tables.
3. **When necessary — parse-specialized models:** Use NVIDIA **document extraction** models where they outperform general VL for bulk PDFs (verify names in NVIDIA catalog).
4. **Structured L1:** Feed extracted text into existing **schema-constrained** flows (`SCHEMAS` for tsbs, dtcs, procedures, specifications, etc.).

### A.2 Implementation (repo)

- Extend **`ai_parser.js`** (or `nemotron_documents.js`) with **`callNemotronMultimodal`**: `content: [{ type: 'text', text }, { type: 'image_url', image_url: { url } }]`, reuse retries and JSON stripping.
- Large assets: follow NVIDIA **NVCF / asset upload** patterns if base64 exceeds practical limits.
- **Workers:** queued jobs, backoff, store raw model output in L0 before L1 upsert.

### A.3 Optional fallback (not primary)

**Tesseract / PaddleOCR** (self-hosted) only if NVIDIA quotas or policy require offline OCR for a subset.

### A.4 Bottom line

- **Primary when necessary:** **Nemotron** (multimodal / parse models, same `NVIDIA_API_KEY` as the rest of vehapiproxi).  
- **Always first:** **native PDF text** to minimize API volume.  
- **One stack** for AI keeps ops and compliance simple.

*Updated 2026-03-18 — Nemotron-first per project direction.*
