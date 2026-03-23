# Golden vehicle verification

- Run mode: local proxy
- Generated at: 2026-03-22T21:08:11.285Z

| Case | Vehicle | Source | Result |
|------|---------|--------|--------|
| GM representative | `2854` | `GeneralMotors` | FAIL |

## GM representative

- Vehicle: `2854`
- Source: `GeneralMotors`
- Exit status: `2`
- Result: FAIL

```text
Local proxy: http://localhost:3001 (default :3001 = Express; use PROXY_URL=http://localhost:3000 for ng serve). vehapiproxi/.env: SKIP_ARTICLE_ACCESS_AUTH=true, NODE_ENV not production. Restart proxy after code changes.
Using article: 7042430
Polling Supabase (up to 120s, interval 5s). Ensure vehapiproxi is running and NVIDIA_API_KEY / LLM_API_KEY is set for AI parse.
  ... not ready (1s): content_item=true enrich=true evidence=3 links=0
  ... not ready (6s): content_item=true enrich=true evidence=3 links=0
  ... not ready (12s): content_item=true enrich=true evidence=3 links=0
  ... not ready (17s): content_item=true enrich=true evidence=3 links=0
  ... not ready (23s): content_item=true enrich=true evidence=3 links=0
  ... not ready (28s): content_item=true enrich=true evidence=3 links=0
  ... not ready (34s): content_item=true enrich=true evidence=3 links=0
  ... not ready (40s): content_item=true enrich=true evidence=3 links=0
  ... not ready (45s): content_item=true enrich=true evidence=3 links=0
  ... not ready (50s): content_item=true enrich=true evidence=3 links=0
  ... not ready (56s): content_item=true enrich=true evidence=3 links=0
  ... not ready (61s): content_item=true enrich=true evidence=3 links=0
  ... not ready (67s): content_item=true enrich=true evidence=3 links=0
  ... not ready (72s): content_item=true enrich=true evidence=3 links=0
  ... not ready (78s): content_item=true enrich=true evidence=3 links=0
  ... not ready (83s): content_item=true enrich=true evidence=3 links=0
  ... not ready (88s): content_item=true enrich=true evidence=3 links=0
  ... not ready (94s): content_item=true enrich=true evidence=3 links=0
  ... not ready (99s): content_item=true enrich=true evidence=3 links=0
  ... not ready (105s): content_item=true enrich=true evidence=3 links=0
  ... not ready (110s): content_item=true enrich=true evidence=3 links=0
  ... not ready (115s): content_item=true enrich=true evidence=3 links=0
--- Verification Result ---
vehicle_id: 2854
catalog_content_source: GeneralMotors
content_item.content_source: GENERALMOTORS
article_id: 7042430
content_item_found: true
content_item_enrichment_present: true
evidence_ingest_rows: 3
evidence_link_rows_for_latest_evidence: 0
```
