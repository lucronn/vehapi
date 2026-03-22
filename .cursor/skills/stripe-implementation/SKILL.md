---
name: stripe-implementation
description: Implement and maintain Stripe payments, credits, and billing portal flows for this project using the established backend and Angular patterns. Use when adding or updating Stripe-related endpoints, webhooks, or frontend flows, or when troubleshooting Stripe issues.
---

# Stripe Implementation

## Quick Start

When working on Stripe in this project:

1. Use `vehapiproxi/src/stripe.js` for server-side Stripe logic (Checkout, billing portal, webhooks).
2. Use `src/services/credits.service.ts` for client-side credit purchase, billing portal, and unlock flows.
3. Route all browser calls through the API proxy defined in `proxy.conf.json` (`/api` → `http://localhost:3001`).
4. Keep environment-specific Stripe keys and webhook secrets in environment variables, never in the repo.

### Core Files

- `vehapiproxi/src/stripe.js`: Stripe SDK initialization, Checkout, billing portal, webhook handling.
- `vehapiproxi/src/credits.js`: Credits and Stripe customer persistence (referenced by `stripe.js`).
- `src/services/credits.service.ts`: Angular service for starting Checkout, opening billing portal, and unlocking modules.

---

## Environment & Configuration

Follow these rules when configuring Stripe:

- **Secret keys**
  - Use `STRIPE_SANDBOX_SKEY` for local/testing when available, otherwise `STRIPE_SECRET_KEY`.
  - Do **not** hard-code keys in source; read from `process.env` in backend.
- **Webhook secret**
  - Use `STRIPE_WEBHOOK_SECRET` for constructing and verifying webhooks in `vehapiproxi/src/stripe.js`.
- **Local API routing**
  - Frontend uses `/api/credits/*` which is proxied to `http://localhost:3001` via `proxy.conf.json`.

Before running Stripe-dependent code:

1. Ensure `STRIPE_SANDBOX_SKEY` or `STRIPE_SECRET_KEY` is set.
2. Ensure `STRIPE_WEBHOOK_SECRET` matches the value from the Stripe Dashboard for the active endpoint.

---

## Pattern: Creating a Checkout Flow (Credits Purchase)

Use this workflow when adding or modifying credit purchase flows.

### Backend

- Add or update a handler that calls `createCheckoutSession(userId, amount, origin)` from `vehapiproxi/src/stripe.js`.
- Enforce minimum purchase:
  - Keep the constraint `amount >= 1000` (1 credit = 1 cent, $10 minimum purchase).
- Ensure Checkout session is created with:
  - `mode: 'payment'`
  - `metadata` including:
    - `userId`
    - `credits` (number of credits to add on success)
  - `client_reference_id` set to the user ID as a fallback.

### Frontend

- Use `CreditsService.startCheckout(amount)` to initiate the flow:
  - Requires an authenticated user.
  - Calls `POST ${apiUrl}/checkout` with `{ amount, origin: window.location.origin }`.
  - Redirects the browser to the returned `url` if present.
- When extending or reusing:
  - Always clear `lastError` before starting a new action.
  - Surface user-facing errors from `startCheckout` to the UI.

---

## Pattern: Handling Webhooks and Adding Credits

Use this workflow when updating credit logic or adding new webhook event handling.

1. **Verify the webhook:**
   - Use `stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET)` as in `vehapiproxi/src/stripe.js`.
   - Do not bypass signature verification in production.
2. **On `checkout.session.completed`:**
   - Extract `userId` from `session.metadata.userId` or `session.client_reference_id`.
   - Read `credits` from `session.metadata.credits` and parse as integer.
   - Capture monetary info:
     - `usdCents = session.amount_total`
   - Call `addCredits(userId, credits, { stripeSessionId, stripePaymentIntent, usdCents })`.
   - Store `stripeCustomerId` via `setStripeCustomerId(userId, session.customer)` for future billing portal access.
3. **Response:**
   - Return JSON confirmation `{ received: true }` to Stripe.

When extending:

- Keep credit bookkeeping in `vehapiproxi/src/credits.js` so business logic is centralized.
- If you add new event types, ensure idempotency and logging via `logger`.

---

## Pattern: Opening the Billing Portal

Use this workflow when exposing or adjusting the Stripe Customer Billing Portal.

### Backend

- Use `createBillingPortalSession(customerId, returnUrl)` from `vehapiproxi/src/stripe.js`:
  - Throws if `customerId` is missing; frontend should ensure at least one purchase exists.
  - Returns a `session.url` to redirect the user.

### Frontend

- Use `CreditsService.openBillingPortal()`:
  - Ensures the user is signed in (attempts Google sign-in if not).
  - Calls `POST ${apiUrl}/portal` with `{ origin: window.location.origin }`.
  - Redirects to `res.url` if present.
  - On error, sets a user-facing message in `lastError`.

When modifying:

- Keep authentication behavior in `CreditsService` (do not duplicate sign-in logic in components).
- Preserve the expectation that a user must have at least one purchase to manage billing.

---

## Pattern: Unlocking Modules with Credits

Use this when changing how credits unlock vehicle modules.

- Frontend:
  - Call `CreditsService.unlockModule(vehicleId, vehicleName, moduleType, cost)`:
    - Checks `balance >= cost` before making a request.
    - On success, updates `balance` and `unlocks` from the backend response.
  - Use `CreditsService.hasAccess(vehicleId, moduleType)` to gate premium content.
- Backend:
  - Ensure corresponding `/api/credits/unlock` endpoint:
    - Validates user identity from headers (Authorization and `x-user-id`).
    - Checks stored balance, decrements credits, and persists unlocks.
    - Returns updated `credits` and `unlocks`.

---

## Error Handling & Logging

When debugging or extending Stripe flows:

- Use the existing `logger` from `vehapiproxi/src/logger.js` for backend errors.
- On the frontend, surface user-friendly messages via `CreditsService.lastError` and avoid exposing raw Stripe error objects.
- Preserve or add structured logs around:
  - Checkout creation failures.
  - Webhook verification failures.
  - Billing portal session failures.

---

## Implementation Checklist

Before considering a Stripe-related change complete, verify:

- [ ] Environment variables (`STRIPE_SANDBOX_SKEY`/`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) are documented and set.
- [ ] Backend endpoints use `vehapiproxi/src/stripe.js` helpers instead of inlining Stripe calls.
- [ ] Webhooks correctly verify signatures and handle `checkout.session.completed`.
- [ ] Credit changes are persisted via the shared credits layer and reflected in `CreditsService`.
- [ ] Frontend uses `CreditsService` methods (`startCheckout`, `openBillingPortal`, `unlockModule`) instead of duplicating HTTP calls.
- [ ] User-facing error states are handled and cleared appropriately.

