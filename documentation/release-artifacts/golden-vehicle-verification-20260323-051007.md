# Golden vehicle verification

- Run mode: local proxy
- Generated at: 2026-03-23T09:10:07.642Z

| Case | Vehicle | Source | Result |
|------|---------|--------|--------|
| GM representative | `2854` | `GeneralMotors` | PASS |

## GM representative

- Vehicle: `2854`
- Source: `GeneralMotors`
- Exit status: `0`
- Result: PASS

```text
Local proxy: http://localhost:3001 (default :3001 = Express; use PROXY_URL=http://localhost:3000 for ng serve). vehapiproxi/.env: SKIP_ARTICLE_ACCESS_AUTH=true, NODE_ENV not production. Restart proxy after code changes.
Using article: 7042430
Polling Supabase (up to 120s, interval 5s). Ensure vehapiproxi is running and NVIDIA_API_KEY / LLM_API_KEY is set for AI parse.
--- Verification Result ---
vehicle_id: 2854
catalog_content_source: GeneralMotors
content_item.content_source: GeneralMotors
article_id: 7042430
content_item_found: true
content_item_enrichment_present: true
evidence_ingest_rows: 3
evidence_link_rows_for_latest_evidence: 1

PASS: content_item enrichment + evidence_ingest + evidence_link verified.
```
