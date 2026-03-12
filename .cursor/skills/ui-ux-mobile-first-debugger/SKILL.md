---
name: ui-ux-mobile-first-debugger
description: Reviews web UI for mobile-first responsive layout and user experience issues, combining static code analysis with live-browser inspection. Use when debugging UI/UX, especially on small viewports, or when the user asks about layout bugs, mobile responsiveness, or friction in user flows.
---

# UI/UX Debugger – Mobile First

## Purpose

Focus on **mobile-first** UI/UX quality for web apps:

- Prioritize **small viewports** (≈320–480px width) before desktop.
- Catch **responsive layout problems** (overflow, stacking, spacing, typography).
- Evaluate **core user flows** (first-time visit, main task completion, key forms).
- Suggest **concrete, minimal code changes** to improve usability.

This skill may use both **static code review** and **browser tools/dev server** when available.

---

## When to Use This Skill

Use this skill when:

- The user reports UI issues on **mobile** or small screens (e.g., “button off-screen on iPhone”).
- There are **layout bugs** (overlapping elements, horizontal scrollbars, clipped text).
- The user wants a **UX review of a flow** (onboarding, checkout, dashboard, forms).
- The user asks to **make a page mobile-first** or “feel better on phones”.

---

## Overall Workflow

When invoked, follow this workflow:

1. **Understand the context**
   - Identify the **page(s)** or **component(s)** being debugged.
   - Determine **primary user goals** on those screens (e.g., “buy credits”, “upload file”).
   - Note any **device/viewport hints** (e.g., mobile Safari, Android Chrome).

2. **Static analysis (code-focused pass)**
   - Locate relevant files (examples, adapt as needed):
     - UI components and templates (e.g., `*.component.html`, `*.tsx`, `*.vue`).
     - Styles (e.g., `*.scss`, `*.css`, `tailwind` configs).
     - Routing and layout shells (e.g., main layout, nav, sidebars).
   - Review markup and styles for:
     - Hard-coded widths/heights that break on small screens (e.g., `width: 800px`).
     - Fixed positioning that might obscure content or CTAs.
     - Insufficient use of **flex/grid** or modern layout primitives.
     - Missing or inconsistent **breakpoints** / responsive utilities.
     - Overly dense content, tiny tap targets, or low-contrast text.

3. **Runtime analysis (browser/dev-server pass) – when allowed**
   - If permitted and possible:
     - Start or use existing dev server.
     - Open the relevant page with a small viewport (e.g., 375×812).
   - In the browser:
     - Scroll top-to-bottom; watch for **horizontal scrollbars**, clipped content, overlapping elements.
     - Exercise main flows: tap primary CTAs, open menus, fill forms.
     - Observe perceived **latency**, confusing states, missing feedback (loading, success, error).
   - Use snapshots / DOM inspection to pinpoint problematic elements and their styles.

4. **Synthesize findings**
   - Group issues into:
     - Layout responsiveness
     - Interaction / flows
     - Accessibility & clarity
   - For each issue, assign **severity** (High/Medium/Low) and link to root causes in code when possible.

5. **Propose fixes**
   - For each high/medium issue:
     - Propose **1–3 minimal code changes** (CSS/HTML/JS) aligned with the project’s stack.
     - Prefer **mobile-first** approaches (styles for small screens as default, then enhance with larger breakpoints).
     - Note likely side effects or trade-offs.

---

## Mobile-First Review Checklist (Output Format)

Always produce a **checklist-style report** as your primary output.

Use this structure:

```markdown
## Mobile-First UI/UX Report

### Summary
- Overall status: [Good / Needs work / Critical]
- Key themes: [short phrases, e.g., “overflow on small screens”, “unclear primary action”]

### Layout & Responsiveness
- [ ] (Severity: High/Medium/Low) [short title]
  - Context: [page/component, viewport, state]
  - Problem: [1–2 sentences]
  - Suggested fix: [specific CSS/HTML/JS changes]
- [ ] ...

### Interaction & User Flows
- [ ] (Severity: High/Medium/Low) [short title]
  - Context: [which flow and step]
  - Problem: [why this harms UX on mobile]
  - Suggested fix: [change to flow, copy, or component behavior]
- [ ] ...

### Accessibility & Clarity
- [ ] (Severity: High/Medium/Low) [short title]
  - Context: [control/content]
  - Problem: [tap targets, contrast, labels, focus, etc.]
  - Suggested fix: [ARIA roles, font size/weight, spacing, labels, etc.]

### Suggested Next Actions
1. [ ] Address all **High** severity issues.
2. [ ] Address **Medium** issues that affect main flows.
3. [ ] Re-test on small viewport(s) after changes.
```

- **Severity guidance**:
  - **High**: Blocks or seriously degrades a core flow on mobile (e.g., CTA off-screen, form unusable).
  - **Medium**: Noticeable friction but flow still works (e.g., awkward scroll, confusing label).
  - **Low**: Polish, consistency, visual refinements.

---

## Heuristics for Mobile-First Review

Use these heuristics while analyzing:

### Layout & Responsiveness

- Prefer **fluid layouts**:
  - Use percentages, `flex`, `grid`, or responsive utilities over fixed pixel widths.
  - Avoid large fixed widths (e.g., `width: 800px`) on container elements.
- Eliminate **horizontal scrolling** on main content.
- Ensure:
  - Content stacks vertically on small screens.
  - Sidebars/secondary panels collapse into drawers, accordions, or bottom sheets when appropriate.
- Typography:
  - Ensure base font size is comfortable on mobile.
  - Avoid overly long lines; consider max-width on text blocks.

### Interaction & Flows

- Identify **primary action** on each screen; ensure it is clear and reachable without awkward scrolling.
- Check **tap targets**:
  - Sufficient size and spacing for touch.
  - Not too close to destructive actions.
- Feedback:
  - Show **loading states**, **disabled states**, and **error messages** clearly.
  - Avoid silent failures or tiny messages at the very top of long screens.

### Accessibility & Clarity

- Check:
  - Color contrast for key text and buttons.
  - Labels on inputs and icons (avoid icons without supporting labels for key actions).
  - Focus and keyboard navigation where applicable.
- Prefer **descriptive text** over ambiguous labels for key CTAs, especially in critical flows.

---

## Using Browser & Dev Tools (When Allowed)

When runtime inspection is permitted:

- May start or reuse a **dev server**.
- May use **browser automation tools** to:
  - Navigate to the relevant route.
  - Resize viewport to a typical mobile size.
  - Capture page snapshots or inspect DOM/styles.
- Use this data to:
  - Confirm whether static concerns actually manifest at runtime.
  - Prioritize issues that are clearly reproducible in the live UI.

If runtime tools are not available or fail, fall back to the **static-only workflow** but note this limitation in the report.

---

## Example (Abbreviated)

```markdown
## Mobile-First UI/UX Report

### Summary
- Overall status: Needs work
- Key themes: horizontal overflow, hidden primary CTA on small screens

### Layout & Responsiveness
- [ ] (Severity: High) Checkout summary overflows on 375px width
  - Context: `/checkout`, 375×812, items list with long names
  - Problem: Items list causes horizontal scroll; total and “Pay now” button partially off-screen.
  - Suggested fix: Make container `width: 100%` with `display: flex; flex-direction: column;` and allow text wrapping; ensure CTA is pinned or clearly visible at bottom.

### Interaction & User Flows
- [ ] (Severity: Medium) No visual feedback on “Apply coupon”
  - Context: `/checkout`, tapping “Apply coupon”
  - Problem: On mobile, user taps “Apply coupon” and nothing appears to happen for ~1–2s.
  - Suggested fix: Add loading state to the button and inline success/error message near the input.

### Accessibility & Clarity
- [ ] (Severity: Low) Low-contrast secondary text in totals section
  - Context: `/checkout`, tax and fee labels
  - Problem: Gray text on light background is hard to read on mobile in bright light.
  - Suggested fix: Increase contrast via darker text color or bolder weight.
```

Use this structure as a template, adapting the specifics to the project and stack in use.

