# Production readiness: paid product v1 + data platform (L2) complete

**Status:** Completed  
**Date:** 2026-03-21  
**Related:** `docs/plans/2026-03-18-normalization-schema-design.md`, `PROGRESS.md`

**Status note:** The design was approved on 2026-03-21. **Why ops are not fully mirrored here:** feature flags, Vercel environment variables, and one-off Supabase SQL in the hosted project are **outside git**—this file stays the **scope/decision record**, while **execution outcomes** (what was toggled, verified, or migrated on which date) live in **`PROGRESS.md`** so there is a single operational changelog. **New gaps** discovered after GA (normalization bugs, embedding client tweaks, RLS follow-ups, etc.) are tracked there under **Bugs & Known Issues** and **What's Left to Do**, not by continuously rewriting this milestone doc.

## Decision

Ship **two parallel tracks** (not strictly sequential):

1. **Paid product v1** — Revenue-grade reliability, abuse bounds, observability, and safe Supabase access patterns.
2. **Data platform complete** — L0/L1 as already shipped in-repo; **L2** ingest exists (`vehapiproxi/src/l2_rag_ingest.js`); **complete** means **retrieval + product integration** (API + UI) per normalization goals, with **`media_asset`** wired where the schema/migration already defines it.

## Goals

### Track A — Paid product v1

- Stripe checkout, portal, and webhooks behave correctly in production (session hydration and backend verification already fixed per `PROGRESS.md`; verify post-deploy).
- **Rate limiting** on high-abuse surfaces (article content routes at minimum).
- **Operational visibility:** structured logs, error rates, and alerts on critical paths (API 5xx, Stripe webhook failures, worker failures if applicable).
- **Security:** review and tighten Supabase **RLS** where policies are still “MVP permissive”; validate with staging before production.
- **Deploy discipline:** frontend + backend workflows (`deploy.yml`, `deploy-backend.yml`); environment variables documented and consistent between Vercel and local.

### Track B — Data platform complete (L2)

- **Ingest:** Continue/enforce worker path for `content_chunk` + embeddings (`ENABLE_L2_EMBEDDINGS`, `EMBEDDING_MODEL`, `L2_EMBEDDING_DIMS`) aligned with `documentation/migrations/20260324_l2_content_chunk_pgvector.sql` / `vehapiproxi/scripts/run-migrate-l2-content-chunk.js`.
- **Query:** Implement **RAG retrieval** (pgvector similarity over `content_chunk`, scoped by `vehicle_id` / `content_item` as appropriate) exposed via **vehapiproxi** (not direct Supabase from browser for service-role operations).
- **UI:** Surface retrieval in the Angular app (vehicle dashboard or article context) behind a **feature flag** until quality gates pass.
- **Media:** Wire **`media_asset`** per schema design where required for diagrams/component locations — phased if needed, but “complete” means the planned tables and code paths are not stubs.

## Non-goals (unless blocking)

- Full penetration test or compliance certification (SOC2, etc.).
- Re-enabling fluids sync unless it blocks technician-truth goals.
- Committing Cursor-only automation (`.cursor/hooks/*`) unless the team decides to share it.

## Mobile + desktop

- **Same flows:** sign-in, credits purchase return, unlock article, open article — verified on a narrow viewport and desktop width.
- **Mobile:** bottom navigation, sheets, touch targets, safe-area — no regressions on lock overlay and article reader.
- **Desktop:** sidebar navigation and modals — keyboard escape behavior and layout unchanged from established patterns.

## Milestones

1. **Baseline** — Staging/prod deploy verified; “pending deploy” fixes from `PROGRESS.md` confirmed in production.
2. **Track A alpha** — Rate limits + monitoring + RLS staging pass.
3. **Track B alpha** — L2 retrieval API + one UI entry point; golden vehicle/article smoke.
4. **Joint GA** — Checklist passes on mobile + desktop; feature flags default **on** for L2 where agreed.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| RLS breaks worker or app | Staging first; migrations ordered; rollback SQL prepared |
| L2 quality poor at launch | Feature flag; narrow initial surfacing; iterate on chunking (`text_chunk.js`, env tunables) |
| Calendar slip on dual goals | Weekly milestone; explicit descope list documented in implementation plan |

## Approval

Approved by product owner conversation on 2026-03-21 (“yes” to parallel dual-track design combining paid v1 and data platform complete).
