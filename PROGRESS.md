# PROGRESS

**Last updated**: 2026-03-15

## Summary

| Area | Status |
|------|--------|
| Stripe Integration (Checkout, Portal, Webhooks) | Complete |
| Credits Service (Balance, Unlocks, Transactions) | Complete |
| Section-Level Content Locking | Complete |
| Article-Level Content Locking | Complete |
| UI/UX Copy Cleanup | Complete |
| Lock Overlay UX | Complete |

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
# Progress

**Last updated:** 2025-03-15

## Vehicle data normalization / migration

- [x] **normalized_schema.ts** – Interfaces aligned with Supabase (procedures, tsbs, dtcs, specifications, maintenance_schedules, parts, ai_processing_logs). Optional fields and DB column notes documented.
- [x] **background_worker.js** – determineSchemaType, extractVehicleId, extractExternalId; normalizeForSupabase sets all fields with safe defaults (no undefined) for procedures, tsbs, dtcs, specifications.
- [x] **ai_parser.js** – SCHEMAS for dtcs, tsbs, procedures, specifications aligned with normalized types.
- [x] **supabase.js** – UPSERT_CONFLICT_COLUMNS (procedures: vehicle_id,external_id; articles: vehicle_id,original_id; specifications; parts; maintenance_schedules). logAiProcessing sends only schema columns (no vehicle_id).
- [x] **vehicle-data.service.ts** – Section strategies and mappers (original_id/external_id for list item ids); loadMaintenance reads maintenance_schedules columns (interval_value, action, item, frequency_code).
- [x] **data-sync.service.ts** – Articles upsert (original_id, no client id); syncFluids (specs with unit, display_text, metadata); syncMaintenance (frequency_code); syncParts (nullable fields, conflict vehicle_id,part_number).

## What's left (optional)

- **Diagrams/component-locations** – No normalized table; section lists use articles only (see `supabase_schema.sql`).
- **Future API fields** – Parts: quantity, fitment_notes. Maintenance: is_severe_service, labor_time_hours (in contract when API/DB support them).
