# Golden vehicle verification

- Run mode: local proxy
- Generated at: 2026-03-23T07:47:56.887Z

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
  ... not ready (33s): content_item=true enrich=true evidence=3 links=0
  ... not ready (39s): content_item=true enrich=true evidence=3 links=0
  ... not ready (44s): content_item=true enrich=true evidence=3 links=0
  ... not ready (49s): content_item=true enrich=true evidence=3 links=0
  ... not ready (55s): content_item=true enrich=true evidence=3 links=0
  ... not ready (60s): content_item=true enrich=true evidence=3 links=0
  ... not ready (66s): content_item=true enrich=true evidence=3 links=0
  ... not ready (71s): content_item=true enrich=true evidence=3 links=0
  ... not ready (77s): content_item=true enrich=true evidence=3 links=0
  ... not ready (82s): content_item=true enrich=true evidence=3 links=0
  ... not ready (88s): content_item=true enrich=true evidence=3 links=0
  ... not ready (93s): content_item=true enrich=true evidence=3 links=0
  ... not ready (98s): content_item=true enrich=true evidence=3 links=0
  ... not ready (104s): content_item=true enrich=true evidence=3 links=0
  ... not ready (109s): content_item=true enrich=true evidence=3 links=0
  ... not ready (114s): content_item=true enrich=true evidence=3 links=0
  ... not ready (120s): content_item=true enrich=true evidence=3 links=0
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
