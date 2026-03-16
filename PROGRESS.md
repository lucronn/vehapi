# PROGRESS

**Last updated**: 2026-03-16

## Summary

| Area | Status |
|------|--------|
| Stripe Integration (Checkout, Portal, Webhooks) | Complete |
| Credits Service (Balance, Unlocks, Transactions) | Complete |
| Section-Level Content Locking | Complete |
| Article-Level Content Locking | Complete |
| UI/UX Copy Cleanup | Complete |
| Lock Overlay UX | Complete |
| Data Normalization Pipeline | Complete |

## Implementation Checklist

### Stripe & Credits
- [x] Stripe Checkout flow (backend + frontend)
- [x] Webhook handling for `checkout.session.completed`
- [x] Billing portal (payment methods, invoices)
- [x] Session verification after redirect
- [x] Credits balance & unlocks persistence (Supabase)
- [x] Transaction history
- [x] Credit pack purchase UI (1000/2500/5000)

### Content Access Control
- [x] Section-level locking (blur + overlay) on all sections
- [x] Article viewer access gating via `moduleType` input/query param
- [x] All section components propagate `moduleType` when opening articles
- [x] Component-locations module type aligned to `diagrams` (was mismatched)
- [x] Locked sections show limited preview items (max 8)
- [x] Direct URL access to articles is blocked when section is locked

### UI/UX Cleanup
- [x] Removed verbose marketing copy from home page
- [x] Removed fluff section labels from dashboard (Tactical Overview, Intelligence, etc.)
- [x] Tightened lock overlay descriptions to concise one-liners
- [x] Simplified credits dashboard text (pack descriptions, billing portal, empty states)
- [x] Removed alert()/confirm() dialogs from unlock flows
- [x] Removed internal status badges (Supabase Cached, Connected, version number)
- [x] Cleaned up sidebar and mobile nav labels

## Bugs & Known Issues

_None currently tracked._

## What's Left to Do

| Priority | Task |
|----------|------|
| Medium | Backend-side access enforcement (currently client-side only) |
| Medium | Rate limiting on article content API |
| Low | Add moduleType to browse-all article links |
| Low | Full-vehicle unlock option from lock overlay |

## Vehicle data normalization / migration

### Completed

- [x] **normalized_schema.ts** – NormalizedArticle added (all Motor API catalog fields). NormalizedVehicle has is_normalized. Existing interfaces unchanged.
- [x] **supabase_schema.sql** – Articles table: added code, description, sort, bulletin_number, release_date columns + parent_bucket index. Migration SQL included.
- [x] **supabase.js** – ensureVehicleExists (FK safety), markVehicleNormalized, checkArticleContent (articles table cache). UPSERT_CONFLICT_COLUMNS unchanged.
- [x] **background_worker.js** – Creates vehicle record before FK-dependent inserts. Articles include all Motor API fields (code, description, sort, bulletin_number, release_date). Marks vehicle normalized after catalog ingest. extractExternalId returns per-article IDs for DTCs/TSBs. Improved content_html extraction (JSON body.html fallback).
- [x] **function.js** – Article content cache checks both normalized tables AND articles table. Articles cache applies normalizeMotorResponse for consistent filterTabs. articles/v2 normalizeMotorResponse always applied (not only for large catalogs).
- [x] **vehicle-data.service.ts** – Section strategies: comprehensive bucket names matching normalizeCategoryParams output (DTCs, TSBs, procedures, diagrams, component-locations). Article filter checks both bucket AND parent_bucket. loadSectionData always uses articles table for list view (simplified flow).
- [x] **data-sync.service.ts** – syncFullVehicle includes parts sync. Sets is_normalized=true after completion. syncSingleArticle stores all article fields (code, description, bulletin_number, release_date, sort).
- [x] **vehicle-dashboard.component.ts** – Re-enabled normalization trigger (checks is_normalized first).
- [x] **ai_parser.js** – SCHEMAS for dtcs, tsbs, procedures, specifications unchanged (already aligned).

### Data flow

```
Motor API → Proxy → normalizeMotorResponse → Supabase articles table (complete catalog)
                  → background_worker → AI parse → Supabase normalized tables (procedures/dtcs/tsbs/specs)
                  → content_html cached in normalized tables + articles.original_content

Supabase articles (list) → frontend section strategies → section components (DTCs, TSBs, Procedures, etc.)
Supabase normalized tables (content) → proxy cache middleware → article viewer (HTML content)
Supabase specifications/maintenance/parts → vehicle-data.service → specs/fluids/maintenance sections
```

### What remains (optional)

- **Diagrams/component-locations** – No normalized table; section lists use articles only.
- **Future API fields** – Parts: quantity, fitment_notes. Maintenance: is_severe_service, labor_time_hours.
