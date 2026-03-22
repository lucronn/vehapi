# Vehicle Service API Frontend - Documentation Package

This directory contains comprehensive documentation for recreating the Vehicle Service API Frontend application in any programming language or framework.

## 📚 Documentation Files

### 1. **`AGENTS.md`** (repo root) ⭐ **Torque / this monorepo**
**Purpose**: How the actual app in this repository is structured, built, and deployed (Angular 19 + `vehapiproxi`).

**Use first** when editing Torque. Pair with **`PROGRESS.md`** for delivery status.

### 2. **IMPLEMENTATION_GUIDE.md** (~3,500 lines)
**Purpose**: Comprehensive implementation guide covering all aspects of the application.

**Contains**:
- Architecture overview and patterns
- API integration setup
- Mobile-first design requirements (CRITICAL)
- AI-powered content rewriting system (CRITICAL)
- AI-generated stepper tutorials (CRITICAL)
- State management architecture
- Core data models
- Routing & URL state management
- Search functionality
- Categorization & bucketing logic
- Article display system
- Vehicle selection flow
- Maintenance schedules
- Parts management
- Labor operations
- Bookmarks
- UI component patterns
- User settings system
- Error handling
- Performance optimizations
- Data processing algorithms
- Implementation checklist
- Testing considerations
- Appendix (AI integration guidelines, mobile design guidelines)

### 3. **`vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md`** (~1,600+ lines)
**Purpose**: **Reference** for M1/upstream Vehicle Service behavior (params, flows, shapes). Lives next to the proxy. **Torque `src/` must only call vehapiproxi**, not Motor hosts directly.

### 4. **VEHAPIPROXI_API_CONSUMPTION.md**
**Purpose**: **Torque proxy** (`vehapiproxi/`) — first-party routes, CORS, Supabase JWT vs Motor session, middleware, and how `/api/*` is proxied. Use with **`vehapiproxi/src/swagger.json`** and **`/docs`**.

### 5. **`vehapiproxi/src/swagger.json`**
**Purpose**: OpenAPI-style schema for the Vehicle Service / proxy API **in this repository** (there is no `documentation/openapi.json`).

**Use it to**: generate clients, inspect paths, and validate request/response shapes.

## 🚀 Quick Start

### For AI Agents

**Torque (this repo):**
```
Read AGENTS.md and PROGRESS.md. Use documentation/IMPLEMENTATION_GUIDE.md for
algorithms and IMPLEMENTATION_GUIDE.md §23.0 for delivery snapshot. Backend:
vehapiproxi/src. API schema: vehapiproxi/src/swagger.json.
```

**Greenfield port (new codebase):**
```
Read IMPLEMENTATION_GUIDE.md and vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md. Use
vehapiproxi/src/swagger.json for contracts. Track work against IMPLEMENTATION_GUIDE.md §23.1.
```

### For Developers

1. **Torque:** read **`AGENTS.md`** + **`PROGRESS.md`**. **Greenfield:** start with **`IMPLEMENTATION_GUIDE.md`** §1–3
2. **Review IMPLEMENTATION_GUIDE.md Section 1-3** - Architecture and requirements
3. **Review `vehapiproxi/src/swagger.json`** - API schema in this repo
4. **Reference IMPLEMENTATION_GUIDE.md** - Algorithms and patterns (TOC)
5. **Use the checklist** - **§23.0** (Torque snapshot) or **§23.1** (greenfield reference list)

## 🎯 Critical Requirements

These are **MANDATORY** features that must be implemented:

1. **Mobile-First Design**
   - Maximize screen space (100vw/100vh, safe areas)
   - Bottom navigation, drawer menus, swipe gestures
   - Touch-optimized (44x44px minimum targets)
   - See: IMPLEMENTATION_GUIDE.md Section 3

2. **AI Content Rewriting**
   - ALL text content must be AI-rewritten
   - PDFs and images remain UNTOUCHED
   - See: IMPLEMENTATION_GUIDE.md Section 4

3. **AI-Generated Stepper Tutorials**
   - Generate from article data (after AI rewriting)
   - Mobile-optimized UI
   - Progress tracking
   - See: IMPLEMENTATION_GUIDE.md Section 5

4. **API Proxy**
   - **Torque:** browser → `/api` (dev) or deployed `vehapiproxi`; never call Motor directly from the client.
   - Legacy examples may cite a Cloud Function URL — only if that deployment is still in use.

## 📖 Documentation Navigation

| What You Need | Where to Find It |
|--------------|------------------|
| How to start (Torque) | **`AGENTS.md`**, **`PROGRESS.md`**, **`VEHAPIPROXI_API_CONSUMPTION.md`** |
| How to start (greenfield) | **IMPLEMENTATION_GUIDE.md**, **`vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md`** |
| Torque proxy (credits, CORS, Bearer, `/api` proxy) | **VEHAPIPROXI_API_CONSUMPTION.md** |
| M1/upstream API semantics (reference) | **`vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md`** |
| Architecture patterns | IMPLEMENTATION_GUIDE.md Section 1, 6 |
| API integration | IMPLEMENTATION_GUIDE.md Section 2, **VEHAPIPROXI_API_CONSUMPTION.md**, `vehapiproxi/src/swagger.json` |
| Mobile-first design | IMPLEMENTATION_GUIDE.md Section 3, 17.4 |
| AI content rewriting | IMPLEMENTATION_GUIDE.md Section 4, 22.3, 25.6 |
| Stepper tutorials | IMPLEMENTATION_GUIDE.md Section 5, 22.4 |
| Algorithms | IMPLEMENTATION_GUIDE.md Section 22 |
| API endpoints | IMPLEMENTATION_GUIDE.md Section 25.1, `vehapiproxi/src/swagger.json` |
| Data models | IMPLEMENTATION_GUIDE.md Section 7, `vehapiproxi/src/swagger.json` |
| Implementation checklist | IMPLEMENTATION_GUIDE.md Section 23 (§23.0 Torque / §23.1 reference) |

## 🔑 Key Concepts

- **Language-Agnostic**: Documentation focuses on patterns, algorithms, and logic - not specific language syntax
- **Framework-Agnostic**: Architecture patterns can be implemented in any framework
- **Mobile-First**: Design for mobile, enhance for larger screens
- **Reactive**: Use observable/stream patterns available in your framework
- **URL-Driven**: Application state synchronized with URL parameters
- **Type-Safe**: Strong typing recommended for API contracts

## ✅ Success Criteria

The application is complete when:

- [ ] Greenfield: **§23.1** complete. Torque: **§23.0** + `PROGRESS.md`
- [ ] Mobile-first design implemented and tested on mobile devices
- [ ] AI content rewriting works (all text rewritten, PDFs/images untouched)
- [ ] Stepper tutorials are generated and functional
- [ ] All API endpoints integrated correctly
- [ ] State management follows described patterns
- [ ] URL state synchronization works
- [ ] Performance optimizations implemented
- [ ] Error handling is comprehensive
- [ ] Application works on mobile devices

## 📝 Notes

- All documentation is comprehensive and detailed
- Algorithms are provided in pseudocode - implement in your chosen language
- Patterns are framework-agnostic - adapt to your technology stack
- Critical requirements are mandatory - do not skip
- Use `vehapiproxi/src/swagger.json` for API contracts in this repo
- Reference `vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md` for upstream/M1 implementation patterns

## 🆘 Need Help?

1. **Unclear requirements?** → Reference specific section in IMPLEMENTATION_GUIDE.md
2. **Missing details?** → Check IMPLEMENTATION_GUIDE.md Section 22 (Algorithms) or Section 25 (Appendix)
3. **API questions?** → **VEHAPIPROXI_API_CONSUMPTION.md** (proxy) + `vehapiproxi/src/swagger.json` + IMPLEMENTATION_GUIDE.md Section 25.1
4. **Pattern questions?** → Check IMPLEMENTATION_GUIDE.md Section 25.8 (Framework-Agnostic Patterns)
5. **Implementation order?** → IMPLEMENTATION_GUIDE.md TOC + `vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md`

---

**Version**: 1.1  
**Last Updated**: 2026-03-20  
**Note**: Line counts vary; primary depth is in IMPLEMENTATION_GUIDE.md and `vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md`.
