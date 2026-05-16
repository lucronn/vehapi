## Ingest verification matrix (V1)

Pragmatic checks for the bulk Motor ingest CLI and the live `background_worker` path. Stricter checks can be added as PostgREST RPCs or views.

| Bucket | Source | Strict check (worker / DB) | Known gaps |
|--------|--------|---------------------------|------------|
| **catalog** | `articles/v2` JSON | Supabase `articles` row count (per `vehicle_id`) equals deduped Motor `articleDetails[].id` count; optional `content_item` count match | Does not re-fetch Motor to compare titles; drift after partial deletes is not auto-healed. |
| **proxy route** | API paths | Composite `engine_id` (`base:engine`) uses `/api/source/MOTOR/vehicle/{engine_id}/…`, matching `motorVehicleRoute` in the Angular client | OEM-only rows without a colon rely on CSV `content_source` + id; extend CSV if you need `motorVehicleId` query style routes. |
| **evidence** | Catalog ingest | `insertEvidenceIngest` best-effort; failures are logged only | Not required for completion in V1. |
| **reference — fluids** | `GET .../fluids` | Upsert returns success; no row-count vs Motor `data[]` length verify (Motor shape varies) | Empty fluids array leaves `reference.fluids` complete with 0 rows — may be valid. |
| **reference — parts** | `GET .../parts` | Upsert success; no API total compare | OEM routes may need `motorVehicleId` query — CSV may not encode OEM/base ids separately. |
| **reference — maintenance** | intervals + frequency | Upsert success per interval/code | Interval picker may not match requested miles exactly (flatten uses nearest bucket — same as app). |
| **corpus (articles)** | `GET .../article/:id/html` + `processTaskImmediate` | `ai_processing_logs` row `status=COMPLETED` for normalized `source_file`; `checkParsedArticle` finds a normalized row | AI/Nemotron failures, rate limits, and schema resolution (procedure vs tsb vs dtc) are **not** fully distinguished in logs; some articles may complete with low-value parses. |
| **L1 links / media** | Worker extensions | Not part of bulk CLI verify matrix | `evidence_link`, `media_asset`, L2 chunks require separate audits. |

### Normalization

- Catalog path must match `documentation/DATA_SOURCE_AND_NORMALIZATION.md`: Supabase is runtime truth after ingest; Motor is ingest-only for this worker.
