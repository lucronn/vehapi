---
name: stripe-debug-devtools
description: Debug Stripe integration issues by inspecting runtime state (network requests, console logs, DOM) using Chrome DevTools MCP. Use when troubleshooting Stripe API errors, payment failures, or frontend integration issues.
---

# Stripe Debugging with Chrome DevTools

This skill guides you through debugging Stripe integration issues using the `user-chrome-devtools` MCP server. It focuses on inspecting network traffic, console errors, and the runtime environment to diagnose problems.

## Workflow

1.  **Check for Console Errors**:
    -   Use `user-chrome-devtools` -> `list_console_messages` to find client-side errors.
    -   Look for `IntegrationError` or messages starting with `Stripe.js`.
    -   Common issues: Invalid publishable key, missing elements container, CSP violations.

2.  **Inspect Network Requests**:
    -   Use `user-chrome-devtools` -> `list_network_requests` to see API calls.
    -   Filter for `xhr` and `fetch` requests to `api.stripe.com` or `m.stripe.com`.
    -   Check for `400 Bad Request` or `401 Unauthorized` responses.
    -   Use `get_network_request` to inspect the full request/response body for error details (e.g., `code`, `message`, `param`).

3.  **Verify Stripe Object**:
    -   Use `user-chrome-devtools` -> `evaluate_script` to check if `window.Stripe` is defined.
    -   Ensure the publishable key used in initialization matches the environment.

4.  **Inspect Elements (Iframes)**:
    -   Stripe Elements run in secure iframes. Use `take_snapshot` to verify iframes are present in the DOM.
    -   Look for iframes with names like `__privateStripeFrame...`.

## Common Issues & Fixes

### 1. `IntegrationError`
-   **Symptom**: Console error "IntegrationError: ...".
-   **Cause**: Invalid configuration passed to `Stripe()` or `elements.create()`.
-   **Fix**: Check `src/services/credits.service.ts` for correct initialization parameters.

### 2. 400 Bad Request on `api.stripe.com`
-   **Symptom**: Network request to Stripe API fails with status 400.
-   **Cause**: Invalid parameters sent to Stripe.
-   **Fix**: Inspect the request body in DevTools. Compare with Stripe API docs.

### 3. Webhook Failures
-   **Symptom**: Payment succeeds but credits are not added.
-   **Cause**: Webhook signature verification failed or backend logic error.
-   **Fix**:
    -   Check backend logs for "Webhook Error".
    -   Verify `STRIPE_WEBHOOK_SECRET` in `.env` matches the Stripe Dashboard.
    -   Use `stripe` CLI to forward webhooks locally for testing.

## Related Resources

-   **Stripe Implementation Skill**: See `.cursor/skills/stripe-implementation/SKILL.md` for code patterns and file locations.
-   **Stripe API Docs**: https://stripe.com/docs/api
