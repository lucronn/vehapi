# Subagent prompts (copy-paste for Cursor Task / new chat)

These mirror the **Superpowers** `subagent-driven-development` skill templates so you don’t have to hunt in your Cursor plugin cache.

**Typical order (one task at a time):** 1) Implementer → 2) Spec reviewer → 3) Code quality reviewer (only after spec is ✅).

## Quick start (3 minutes)

1. Pick **one task** from an implementation plan (e.g. `docs/plans/2026-03-21-production-readiness-paid-plus-l2.md` or a new plan).
2. **New Cursor chat** or **Task** with a **fresh context** (no polluted history).
3. Paste **everything** in [`implementer-prompt.md`](./implementer-prompt.md) (the fenced block), then replace the bracketed placeholders:
   - `[FULL TEXT of task from plan]` — copy the **entire** Task N section from the plan.
   - `[Scene-setting...]` — 2–5 sentences: repo path, branch, related files.
   - `[directory]` — e.g. `X:\cursor\vehapi` or your worktree.
4. Run the implementer; when it reports **DONE**, open a **new** chat and paste [`spec-reviewer-prompt.md`](./spec-reviewer-prompt.md), filling in the task text + implementer report.
5. If spec is ✅, **new** chat again with [`code-quality-reviewer-prompt.md`](./code-quality-reviewer-prompt.md) (fill SHAs if you use git diff review).

## Torque repo conventions

- **Branch:** use a feature branch or worktree; avoid committing directly to `main` unless you intend to.
- **After changes:** `npm run verify:prod-readiness` (root); for worker/API integration with secrets `cd vehapiproxi && npm run verify:evidence-links -- --local`.
- **Proxy:** see `AGENTS.md` and `vehapiproxi/.env.example`.

## Files in this folder

| File | Role |
|------|------|
| `implementer-prompt.md` | Build + test + commit + self-review |
| `spec-reviewer-prompt.md` | Check spec only (read code, don’t trust the report) |
| `code-quality-reviewer-prompt.md` | Style, structure, tests (after spec passes) |

Upstream copies may live under `.cursor/plugins/.../skills/subagent-driven-development/`; this folder is **your stable copy** in git.
