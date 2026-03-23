# Golden vehicle verification

- Run mode: local proxy
- Generated at: 2026-03-22T21:11:38.264Z

| Case | Vehicle | Source | Result |
|------|---------|--------|--------|
| GM representative | `2854` | `GeneralMotors` | FAIL |

## GM representative

- Vehicle: `2854`
- Source: `GeneralMotors`
- Exit status: `1`
- Result: FAIL

```text
Local proxy: http://localhost:3001 (default :3001 = Express; use PROXY_URL=http://localhost:3000 for ng serve). vehapiproxi/.env: SKIP_ARTICLE_ACCESS_AUTH=true, NODE_ENV not production. Restart proxy after code changes.
Using article: 7042430
Polling Supabase (up to 120s, interval 5s). Ensure vehapiproxi is running and NVIDIA_API_KEY / LLM_API_KEY is set for AI parse.
  ... not ready (0s): content_item=true enrich=true evidence=3 links=0
  ... not ready (6s): content_item=true enrich=true evidence=3 links=0
  ... not ready (11s): content_item=true enrich=true evidence=3 links=0
  ... not ready (17s): content_item=true enrich=true evidence=3 links=0
  ... not ready (22s): content_item=true enrich=true evidence=3 links=0
  ... not ready (28s): content_item=true enrich=true evidence=3 links=0
  ... not ready (33s): content_item=true enrich=true evidence=3 links=0
  ... not ready (38s): content_item=true enrich=true evidence=3 links=0
  ... not ready (44s): content_item=true enrich=true evidence=3 links=0
  ... not ready (49s): content_item=true enrich=true evidence=3 links=0
  ... not ready (55s): content_item=true enrich=true evidence=3 links=0
```
