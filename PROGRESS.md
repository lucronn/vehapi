# PROGRESS

**Last updated**: 2026-03-15

## Summary

| Area | Status |
|------|--------|
| Stripe Integration (Checkout, Portal, Webhooks) | Complete |
| Credits Service (Balance, Unlocks, Transactions) | Complete |
| Section-Level Content Locking | Complete |
| Article-Level Content Locking | Complete |
| Navigation Access Control | Complete |
| UI/UX Copy Cleanup | Complete |
| Desktop UI Polish | Complete |

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
- [x] Browse-all article links route through onArticleClick (not direct routerLinks)
- [x] Sidebar category tree replaced with section links (no unprotected article tree)

### Navigation
- [x] Sidebar redesigned with clean section links + lock indicators
- [x] Sections conditionally shown based on data availability
- [x] Credit balance visible in sidebar footer and mobile header
- [x] Mobile nav overlay shows all available sections (mirrors sidebar)
- [x] Removed redundant category tree from sidebar

### UI/UX Cleanup
- [x] Removed verbose marketing copy from home page
- [x] Removed fluff section labels from dashboard
- [x] Tightened lock overlay descriptions to concise one-liners
- [x] Simplified credits dashboard text
- [x] Removed alert()/confirm() dialogs from unlock flows
- [x] Removed internal status badges (Supabase Cached, Connected, version)
- [x] Removed card/glass-card hover lift animations (layout shift)
- [x] Toned down button hover glow effects
- [x] Removed decorative blur orbs from dashboard

## Bugs & Known Issues

_None currently tracked._

## What's Left to Do

| Priority | Task |
|----------|------|
| Medium | Backend-side access enforcement (currently client-side only) |
| Medium | Rate limiting on article content API |
| Low | Full-vehicle unlock option from lock overlay |
