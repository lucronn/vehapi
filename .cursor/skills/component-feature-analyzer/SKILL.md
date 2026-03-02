---
name: component-feature-analyzer
description: Analyze, improve, fix, and implement application components and features in this project. Use when working on UI components, services, or features, especially when the user asks to analyze, refactor, extend, or fix behavior.
---

# Component & Feature Analyzer

## Purpose

This skill guides the agent through a consistent workflow for:

- Analyzing existing components and features
- Identifying bugs, gaps, and quality issues
- Proposing targeted improvements
- Implementing or extending behavior safely

Use it for both frontend (components, services, routing, state) and backend/proxy pieces related to a feature.

## When to Use This Skill

- User asks to **analyze** a component/feature (correctness, quality, UX, performance)
- User asks to **fix** a bug in a specific component/feature
- User asks to **improve or refactor** a component/feature
- User asks to **implement or extend** a feature end‑to‑end (UI + services + proxy)
- Work clearly maps to a well-defined **screen, section, or flow** (e.g. credits dashboard, article viewer, mobile UX)

---

## High-Level Workflow

Follow this workflow unless the user explicitly asks for something different:

1. **Understand the request and scope**
2. **Locate and read the relevant code**
3. **Analyze current behavior against requirements**
4. **Design the change (fix/improvement/implementation)**
5. **Implement changes in small, verifiable steps**
6. **Run checks (lint/tests/manual reasoning) and summarize impact**

Keep the user-facing explanation concise and concrete.

---

## Phase 1: Understand Request & Constraints

1. **Infer requirements from context** instead of asking the user to restate them.
2. If something is truly ambiguous:
   - Document assumptions explicitly (e.g. "Assuming this is mobile-first only for the credits dashboard").
   - Proceed with the most reasonable approach.
3. Identify:
   - **Target area** (component, feature, route, API, service)
   - **Primary goal** (bug fix, UX improvement, performance, new behavior)
   - **Constraints** (no breaking API, mobile-first, keep current UX patterns, etc.)

---

## Phase 2: Code Discovery

When locating the relevant code:

1. **Search intelligently**
   - Use filename conventions (e.g. `*-dashboard.component.*`, `*-service.*`, proxy files under `vehapiproxi/src`).
   - Use text search for key symbols, routes, or user-facing strings.
2. Map the feature:
   - **UI layer**: components, templates, styles, routing entries.
   - **Logic layer**: services, helpers, state management.
   - **Backend/proxy** (if applicable): API handlers, integration code.
3. Skim related files to understand:
   - Data flow (props/inputs, outputs/events, injected services)
   - Side effects (HTTP calls, navigation, global state changes)

Only read as much as needed to build a correct mental model.

---

## Phase 3: Analysis Checklist

When analyzing a component/feature, check:

- **Functional correctness**
  - Does it meet the described behavior?
  - Are edge cases (empty states, errors, loading) handled?
- **State & data flow**
  - Is state stored in appropriate places (component vs service vs route)?
  - Are inputs/outputs and subscriptions managed cleanly?
- **Error handling & resilience**
  - Are HTTP or async errors surfaced to the user appropriately?
  - Are fallback behaviors defined (e.g. AI or external APIs unavailable)?
- **UX & accessibility**
  - Are controls clear, consistent, and reasonably sized (especially on mobile)?
  - Are loading and error states clearly communicated?
- **Performance**
  - Avoid unnecessary re-renders or redundant calls.
  - Consider debouncing, caching, and route-level loading where appropriate.
- **Consistency with project conventions**
  - Follow existing patterns for services, routing, and components.

Summarize key findings in a short list (what works, what is risky, what is missing).

---

## Phase 4: Design the Change

Before editing:

1. Draft a **small plan** that covers:
   - What will change in each file (high level, not line-by-line)
   - Any new functions, APIs, or component inputs/outputs
   - How the change will be validated (lint/test/manual scenario)
2. Prefer **incremental changes** over large rewrites.
3. Reuse existing utilities, patterns, and services whenever possible.

Keep the plan short (a few bullets) and actionable.

---

## Phase 5: Implementation Workflow

When editing code:

1. **Work in small steps**
   - Make cohesive edits per concern (e.g. routing, service, component) rather than touching everything at once.
2. **Maintain type safety and linter friendliness**
   - Align with existing types and interfaces.
   - Avoid introducing obvious linter errors; fix them when they appear.
3. **Preserve behavior where required**
   - For refactors, ensure the external behavior remains the same unless explicitly changing it.
4. **Update related pieces**
   - If adding/changing a feature, consider whether tests, documentation, or configuration need updates.

For bug fixes, prefer the **minimal change** that clearly addresses the root cause without introducing new risk.

---

## Phase 6: Verification & Progress

After making changes:

1. **Self-check**
   - Walk through at least one realistic user flow in your head using the updated code.
   - Ensure error paths and edge cases make sense.
2. **Automated checks where applicable**
   - Run or reason about relevant tests or linters if they exist.
3. **Project progress integration**
   - If the change clearly completes or verifies a checklist item in `PROGRESS.md`, update the appropriate checkbox and/or notes following that file’s instructions.
4. **Summarize for the user**
   - What you changed (at a high level)
   - Why you changed it
   - Any follow-up or limitations the user should know about

Keep the final explanation within a few sentences unless the user explicitly asks for more detail.

---

## Output Format for Analyses

When replying to the user while using this skill, structure responses as:

1. **Summary**
   - 1–3 sentences describing the main outcome.
2. **Findings**
   - Short bullet list of issues or observations from analysis.
3. **Plan / Changes**
   - Short bullet list of planned or completed changes by file/area.
4. **Validation**
   - How behavior was validated (reasoning, tests, or lints) and any remaining caveats.

This structure keeps responses clear while still giving enough insight into the component/feature work performed.

