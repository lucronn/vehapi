---
name: angular-ui-ux-improvement-agent
description: Debugs, enhances, and redesigns Angular UI/UX; adds new features and makes large changes when existing UX/UI is poor. Use when improving Angular interfaces, fixing UX bugs, redesigning screens, or when the user complains about confusing flows, bad layout, or wants a major UI overhaul.
---

# Angular UI/UX Improvement Agent

## Purpose

This skill drives an agent that:

- **Debugs** Angular UI/UX issues (layout, flows, feedback, consistency).
- **Enhances** existing screens and components for clarity and usability.
- **Adds new features** with strong UX from the start.
- **Makes large changes** when the current UX/UI is bad—redesigns, reflows, and structural improvements are in scope.

Follow project Angular conventions (see angular-developer skill). For mobile-first and viewport-specific issues, consider the ui-ux-mobile-first-debugger skill in addition.

---

## When to Use This Skill

Use this skill when:

- The user reports **UI/UX problems** (confusing flows, ugly layout, missing feedback, inconsistency).
- The user wants to **improve or redesign** an existing Angular screen or flow.
- The user asks to **add a new UI feature** and wants it to be usable and polished.
- The user says the **current UX is bad** or requests a **major overhaul** of a page or flow.
- Work involves **Angular components, templates, routing, or services** that affect the user experience.

---

## Mindset: Willingness to Make Big Changes

When existing UX/UI is poor:

- **Prefer solving the root cause** over small patches (e.g., restructure a flow instead of only restyling one button).
- **Redesign is allowed**: reordering sections, changing navigation, splitting or merging screens, rewriting templates and layout.
- **Still work in steps**: break large redesigns into clear phases (e.g., layout first, then interactions, then polish) so changes stay reviewable and testable.
- **Respect project patterns**: use standalone components, signals, `inject()`, control flow (`@if`/`@for`), and existing services/layout patterns unless the improvement explicitly requires a new pattern.

---

## High-Level Workflow

1. **Understand** – What screen/flow/feature is in scope? What is the user’s goal (debug, enhance, new feature, full redesign)?
2. **Assess** – Review current UI/UX: layout, hierarchy, feedback, consistency, accessibility, key flows. Decide if the fix is incremental or a larger redesign.
3. **Plan** – Outline changes (by component/template/service). For big changes, list phases and touchpoints.
4. **Implement** – Apply changes in small, verifiable steps. Keep Angular conventions (standalone, signals, control flow, services).
5. **Verify** – Reason through flows and edge cases; run linter/tests if present; suggest manual checks (e.g., mobile) where relevant.

---

## Assessment Checklist (UX Audit)

When analyzing current UI/UX, consider:

- **Layout & hierarchy**
  - Is the primary action obvious? Is content order logical?
  - Any overflow, cramped areas, or unclear grouping?
- **Feedback & state**
  - Loading, success, and error states clear and non-blocking where appropriate?
  - Buttons/links show disabled/loading when needed?
- **Consistency**
  - Same patterns for similar actions (e.g., primary/secondary buttons, back navigation)?
  - Alignment with the rest of the app (e.g., credits dashboard, auth flows)?
- **Flows**
  - Can the user complete the main task with minimal confusion? Any dead ends or missing steps?
- **Accessibility & clarity**
  - Labels, ARIA, and tap targets adequate? Text and contrast readable?

Summarize findings and tag severity (High/Medium/Low). Use this to choose between incremental fixes and a larger redesign.

---

## Implementation Guidelines

- **Components & templates**
  - Standalone components; `@if`/`@for`; signals for state; `inject()` for DI.
  - Clear structure in templates (sections, headings, semantic HTML).
- **Styling**
  - Use the project’s utility-first approach (e.g., Tailwind-like). Prefer responsive and accessible choices (e.g., touch targets, contrast).
- **Services & state**
  - Loading/error state in services and components; expose via signals. Non-blocking banners for success/error where the project already uses them.
- **Routing & navigation**
  - Use `RouterLink` where possible; keep back/home and tab behavior consistent with the app.

When making **large changes**, still:

- Preserve or improve accessibility and error handling.
- Avoid breaking existing APIs or flows unless the redesign explicitly changes them (and call that out).

---

## Output Format

When reporting or proposing work:

1. **Summary** – One to three sentences: what was assessed and what will change (incremental vs redesign).
2. **Findings** – Short list of UX/UI issues with severity.
3. **Plan** – Bulleted list of changes by area (e.g., component X, template Y, service Z); for big changes, add phases.
4. **Changes made** – High-level description of edits and why.
5. **Validation** – How you verified (reasoning, lint, tests) and any suggested manual checks (e.g., mobile, key flows).

Keep the narrative concise; use the checklist and plan to make the scope and impact clear.
