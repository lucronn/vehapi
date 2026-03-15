# PROGRESS — Vehicle Service API Frontend (Torque)

**Last updated**: 2026-03-15

---

## Summary

| Area                | Status       |
|---------------------|-------------|
| Home / Search       | Working     |
| Vehicle Dashboard   | Working     |
| Article Viewer      | Working     |
| Credits Dashboard   | Working     |
| Motor API Service   | Working     |
| Vehicle Data Service| Working     |
| Mobile UX           | Improved    |
| Swagger/API Parity  | Improved    |

---

## Implementation Checklist

### Core Infrastructure
- [x] Angular 19 standalone components with signals
- [x] Motor API proxy integration (`vehapiproxi`)
- [x] Supabase auth and data storage
- [x] Hash-based routing configuration
- [x] Environment configurations (dev/prod)

### Home Page
- [x] Year → Make → Model → Engine selection flow
- [x] VIN decode with progressive detection feedback
- [x] Smart input parsing ("2011 Ford F-150")
- [x] Mobile wizard for vehicle selection
- [x] Persisted vehicle "welcome back" card
- [x] Keyboard navigation (Arrow keys, Enter, Escape)
- [x] Feature badges display

### Vehicle Dashboard
- [x] Route-driven vehicle context (contentSource, vehicleId)
- [x] Overview section with quick-access cards for all available sections
- [x] Section availability detection (from filter tabs + parts API)
- [x] Desktop sidebar navigation
- [x] Mobile bottom tab bar
- [x] Comprehensive mobile navigation overlay with all sections
- [x] Search with loading indicator and max-height scrollable results
- [x] Browse-all section with filter tabs and article listing
- [x] Browse-all articles open in desktop window via onArticleClick
- [x] Orientation selector modal for non-MOTOR sources
- [x] Vehicle name display with "Unknown Vehicle" fallback
- [x] Vehicle persistence to localStorage for welcome-back experience
- [x] vehicleName passed to all section components for credit unlock display

### Dashboard Sections
- [x] DTCs section (Diagnostic Trouble Codes)
- [x] TSBs section (Technical Service Bulletins)
- [x] Procedures section
- [x] Diagrams section (Wiring Diagrams)
- [x] Component Locations section
- [x] Specs & Fluids section
- [x] Maintenance Schedules section
- [x] Parts section
- [x] Common Issues & AI section

### Article Viewer
- [x] Article content loading with HTML processing
- [x] PDF viewer (desktop inline iframe + mobile card)
- [x] Table of contents (desktop sidebar + mobile overlay)
- [x] Image viewer modal
- [x] AI rewrite (background)
- [x] Step-by-step tutorial generation
- [x] Auth retry on 401/403 with polling
- [x] Error states with friendly messages
- [x] Re-authentication indicator
- [x] Lazy sync to Supabase

### API / Swagger Parity
- [x] All endpoints mapped in MotorApiService
- [x] `withCredentials: true` on all HTTP calls for session consistency
- [x] Response unwrapping (header/body pattern)
- [x] Article search caching
- [x] Maintenance schedules by frequency, interval, indicators
- [x] Parts endpoint with Motor compatibility mapping
- [x] Bookmark save/get
- [x] Vehicle name endpoint with fallback handling
- [x] Auth status polling
- [x] Track change / delta report endpoints
- [x] UI settings, feedback, error logging endpoints

### Credits & Auth
- [x] Supabase auth (sign in, sign up, sign out)
- [x] Credits balance and unlock flow
- [x] Stripe checkout and billing portal
- [x] Auth modal component
- [x] Section lock/unlock with credit costs

### Shared Components
- [x] Loading skeleton (list, card, text, grid)
- [x] Empty state (alert, info, package icons)
- [x] Theme toggle (light/dark)
- [x] Logo component
- [x] Auth modal
- [x] Orientation selector modal
- [x] Image viewer modal
- [x] Tutorial stepper
- [x] Window manager (desktop windowed mode)

---

## Bugs & Known Issues

_(none currently tracked)_

---

## Unfinished / Stub Components

- Data sync progress overlay (present but sync disabled in dashboard constructor)
- Category tree service (used by sidebar, may need further tuning)

---

## What's Left to Do

| Priority | Item                                                    |
|----------|---------------------------------------------------------|
| Medium   | End-to-end testing with live Motor API proxy            |
| Medium   | Performance audit on large article lists                |
| Low      | Accessibility audit (ARIA labels, focus management)     |
| Low      | Dark/light theme refinements for article content        |
