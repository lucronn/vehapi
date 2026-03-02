---
name: angular-developer
description: Provides Angular development guidance tailored to the vehapi app, using standalone components, Angular signals, lucide-angular UI, and HTTP services with proxy-based API access. Use when implementing or refactoring Angular components, services, routing, or UI flows in this project.
---

# Angular Developer (vehapi)

## Purpose

This skill guides the agent to behave like the primary Angular developer for the vehapi app.
It encodes the project’s conventions so Angular changes are consistent, idiomatic, and aligned with the existing codebase.

## When to Use

Use this skill whenever:
- Working on `src` UI features (pages, components, dialogs, layouts).
- Creating or updating Angular services for HTTP APIs, credits, auth, or Stripe-related flows.
- Modifying routing, navigation, or template control-flow.
- Refactoring Angular code that uses signals, `inject()`, or standalone components.

## Project Architecture Snapshot

- **Angular style**: Standalone components (no NgModules) with `@Component({ standalone: true, imports: [...] })`.
- **State**: Prefer **Angular signals** (`signal`, `computed`, `effect`) for local component and service state.
- **Dependency injection**: Use **`inject()`** instead of constructor injection.
- **Templates**: Use new **Angular control flow** (`@if`, `@for`) instead of `*ngIf` / `*ngFor` in new code.
- **UI libraries**:
  - `CommonModule` for directives and pipes.
  - `RouterLink` for navigation.
  - `LucideAngularModule` and an `icons` map for icons.
- **Styling**: Utility-first classes (Tailwind-like) with responsive and accessibility-conscious design.
- **HTTP & backend**:
  - Use `HttpClient` with typed responses.
  - Use an `environment`-based `apiUrl` pattern: production hits the deployed proxy, development uses a relative `/api/...` path that goes through `proxy.conf.json`.
  - Authenticated calls attach `Authorization: Bearer <token>` and `x-user-id` headers, derived from `AuthService` and `UserIdService`.

## Components & Templates

When creating or updating a component:

1. **Structure**
   - Use standalone components:
     - `@Component({ selector: 'app-...', standalone: true, imports: [...] })`.
   - Import only what is needed (`CommonModule`, `RouterLink`, `LucideAngularModule`, other components).

2. **State & DI**
   - Declare injected dependencies via `inject()` at the top of the class.
   - Use `signal`, `computed`, and `effect` for reactive state, consistent with `CreditsDashboardComponent`.
   - Keep state minimal and derive as much as possible via `computed`.

3. **Templates**
   - Prefer `@if` / `@for` / `@switch` blocks rather than legacy structural directives.
   - Keep touch targets large (≈ `min-h-[44px]`) and responsive layouts as seen in `credits-dashboard.component.ts`.
   - Use `lucide-icon` with an `icons` map on the component class to render icons.

4. **UX & Accessibility**
   - Ensure buttons and links have clear labels and appropriate ARIA when dismissing banners or modals.
   - Use non-blocking banners (success, error) similar to the credits dashboard patterns.

## Services & HTTP Calls

When working on Angular services (e.g. credits, auth, API wrappers):

1. **Injection and state**
   - Decorate services with `@Injectable({ providedIn: 'root' })`.
   - Use `inject()` for `HttpClient`, `AuthService`, and other dependencies.
   - Represent mutable state with signals (e.g. `balance`, `unlocks`, `transactions`, `isLoading`, `lastError`).

2. **API URL pattern**
   - Follow the `CreditsService` pattern:
     - Provide a private `apiUrl` getter using `environment.production` to switch between deployed and proxied endpoints.
     - In development, prefer relative paths like `/api/credits` which are mapped by `proxy.conf.json`.

3. **Authentication & headers**
   - Centralize header construction in a helper like `getHeaders()`:
     - If a user is authenticated, use `AuthService` to fetch an ID token and set `Authorization: Bearer <token>` and `x-user-id`.
     - For guests (if supported), use `UserIdService` to set `x-user-id`.

4. **HTTP usage**
   - Use `firstValueFrom(this.http.get/post/...)` for async/await style calls.
   - Type responses precisely using interfaces.
   - On failure, log using `console.error` and propagate a **user-facing** message via a signal such as `lastError`.

5. **Loading & error states**
   - Use dedicated `isLoading`, `transactionsLoading`, or `portalLoading` signals and always clear them in `finally` blocks.
   - Do not throw raw errors into components; instead, expose clean signals that templates can bind to.

## Routing & Navigation

When modifying or adding navigation:
- Use `RouterLink` in templates rather than imperative navigation where possible.
- Follow existing patterns for returning to home or switching tabs (e.g. back link in the credits dashboard).
- If adding new routes, prefer **lazy-loaded** routes and standalone components consistent with the current routing setup.

## Workflow: Adding a New Page with Backend Calls

Use this checklist when implementing a new feature page that talks to the backend:

1. **Service**
   - [ ] Extend or create an Angular service under `src/services/` that:
     - [ ] Uses `inject(HttpClient)` and `inject(AuthService)` as needed.
     - [ ] Uses the existing `apiUrl` + `getHeaders()` patterns.
     - [ ] Exposes state via signals and methods returning `Promise<...>` using `firstValueFrom`.

2. **Component**
   - [ ] Create a standalone component under `src/pages/...` with:
     - [ ] `standalone: true` and `imports: [...]` including `CommonModule`, `RouterLink`, icons, and any child components.
     - [ ] Signals for UI state (loading, error, data).
     - [ ] Templates using `@if` / `@for` and Tailwind-like utility classes for layout.

3. **Integration**
   - [ ] Wire up the service in the component using `inject()`.
   - [ ] Trigger data loading in `ngOnInit` or `effect` based on signals.
   - [ ] Handle loading and error states using banners and disabled buttons similar to the credits dashboard.

4. **Polish**
   - [ ] Verify mobile and desktop layouts look good.
   - [ ] Ensure buttons are accessible and keyboard-friendly.

## Examples

- When asked to "add a new credits-related view", reuse:
  - Signals-based state from `CreditsDashboardComponent`.
  - HTTP patterns and header construction from `CreditsService`.
- When asked to "integrate a new backend endpoint":
  - Add a method to the appropriate service using the same `apiUrl` and headers pattern.
  - Expose results via signals or return typed `Promise` values for components to consume.

Keep answers concise and align with these conventions unless the user explicitly requests a different approach.

