# Instructions for Building the Vehicle Service API Frontend Application

This document provides instructions for AI agents or developers to build the application using the documentation package.

## Overview

Use the documentation in this directory to recreate the Vehicle Service API Frontend application. The documentation is language-agnostic and framework-agnostic, focusing on architecture patterns, business logic, algorithms, and implementation details.

## Documentation Structure

1. **`IMPLEMENTATION_GUIDE.md`** - Start here. This is the comprehensive implementation guide (3,454 lines) covering all aspects of the application.

2. **`API_CONSUMPTION_DOCUMENTATION.md`** - Reference documentation for API consumption patterns, state management, and existing implementation details.

3. **`openapi.json`** or **`openapi.yaml`** - Complete API schema. Use this to:
   - Generate API client code in your chosen language
   - Understand all available endpoints
   - Understand request/response structures
   - Understand data models

## Step-by-Step Agent Instructions

### Phase 1: Initial Setup and Understanding

**Instruction to Agent:**

```
You are tasked with building a Vehicle Service API Frontend application based on the 
documentation in the 'documentation' directory.

STEP 1: Read and understand the following files in order:
1. documentation/IMPLEMENTATION_GUIDE.md - Sections 1-3 (Introduction, API Setup, Mobile-First Requirements)
2. documentation/openapi.json or openapi.yaml - Review the API schema structure
3. documentation/API_CONSUMPTION_DOCUMENTATION.md - Review architecture patterns

STEP 2: Confirm understanding of:
- The application is mobile-first with AI-powered content rewriting and stepper tutorials
- API base URL: https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy/
- The application uses reactive state management patterns
- All text content must be AI-rewritten (PDFs and images remain untouched)

STEP 3: Choose your technology stack:
- Programming language (JavaScript/TypeScript, Python, Java, etc.)
- Framework (React, Vue, Angular, Svelte, etc. OR native mobile framework)
- State management library (Redux, Zustand, MobX, etc.)
- HTTP client library
- UI framework/library for mobile-first design
```

### Phase 2: API Integration Setup

**Instruction to Agent:**

```
STEP 4: Set up API integration:
1. Generate API client code from documentation/openapi.json using appropriate tool 
   (OpenAPI Generator, swagger-codegen, etc.) OR manually implement based on schema
2. Configure HTTP client to use base URL: 
   https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy/
3. Implement error handling infrastructure
4. Set up request/response interceptors if needed
5. **IMPORTANT**: Understand that API responses wrap data in a `{header, body}` structure:
   - Access actual data via `response.body` property
   - List responses: `response.body` contains the array
   - Object responses: `response.body` contains the object
   - See IMPLEMENTATION_GUIDE.md Section 2.3 and 7.0 for details

Reference: IMPLEMENTATION_GUIDE.md Section 2 (API Integration Setup)
Reference: IMPLEMENTATION_GUIDE.md Section 7.0 (API Response Structure)
```

### Phase 3: Core Architecture Implementation

**Instruction to Agent:**

```
STEP 5: Implement state management architecture:
1. Implement Store pattern (entity stores and regular stores)
2. Implement Query pattern (computed/derived state)
3. Implement Facade pattern (orchestration layer)
4. Set up URL state synchronization

Reference: IMPLEMENTATION_GUIDE.md Section 6 (State Management Architecture)
Reference: API_CONSUMPTION_DOCUMENTATION.md (State Management section)

Follow the patterns described - these are framework-agnostic patterns that can be 
implemented in any language/framework.
```

### Phase 4: Core Features Implementation

**Instruction to Agent:**

```
STEP 6: Implement core features in this order:

A. Vehicle Selection (Section 12):
   - Year/Make/Model cascade
   - VIN lookup
   - Motor vehicle selection
   - Recent vehicles (session storage)

B. Search Functionality (Section 9):
   - Search API integration
   - Reactive search triggers
   - Debouncing and deduplication
   - State management

C. Categorization & Bucketing (Section 10):
   - Filter tabs
   - Bucket organization algorithm
   - Procedure silo flattening
   - Filter tab aggregation

D. Article Display System (Section 11):
   - Article loading (root vs leaf)
   - Bookmark handling
   - Special article IDs (-997, -998, -999, L:*)
   - HTML transformation
   - Content display modes (HTML, Full Page HTML, PDF)

Reference: IMPLEMENTATION_GUIDE.md Sections 9-12
```

### Phase 5: AI Integration (CRITICAL)

**Instruction to Agent:**

```
STEP 7: Implement AI Content Rewriting System (CRITICAL REQUIREMENT):

1. Set up AI service integration (OpenAI, Anthropic, or local LLM)
2. Implement content extraction pipeline:
   - Parse HTML structure
   - Extract text nodes (separate from images/PDFs)
   - Preserve content hierarchy
3. Implement AI rewriting pipeline:
   - Send text to AI service
   - Receive rewritten text
   - Validate/process response
4. Implement content merging:
   - Re-insert original images at appropriate positions
   - Re-insert PDFs at appropriate positions
   - Maintain image-to-text relationships
5. Implement caching strategy (rewritten content cache)
6. Implement fallback handling (show original if rewriting fails)

IMPORTANT: 
- ALL text content must be AI-rewritten
- PDFs and images remain UNTOUCHED
- See IMPLEMENTATION_GUIDE.md Section 4 for detailed algorithms and patterns
- See IMPLEMENTATION_GUIDE.md Section 25.6 (AI Integration Guidelines) for prompt engineering
```

### Phase 6: Stepper Tutorials (CRITICAL)

**Instruction to Agent:**

```
STEP 8: Implement AI-Generated Stepper Tutorials (CRITICAL REQUIREMENT):

1. Implement tutorial generation pipeline:
   - Analyze article content (after AI rewriting)
   - Identify procedural elements
   - Extract steps, warnings, checkpoints
   - Generate tutorial structure
2. Implement tutorial UI component:
   - Vertical step indicator (mobile-optimized)
   - Progress bar
   - Step content display
   - Navigation controls (Next/Previous)
   - Step completion tracking
3. Implement tutorial storage:
   - Cache generated tutorials
   - Store user progress (localStorage)
   - Version tracking
4. Implement tutorial triggers:
   - "Start Tutorial" button
   - Auto-detection for procedural articles
   - Direct URL access

IMPORTANT:
- Tutorials generated ONLY from article data (after AI rewriting)
- Mobile-optimized UI (full-screen, swipe navigation)
- See IMPLEMENTATION_GUIDE.md Section 5 for complete specifications
- See IMPLEMENTATION_GUIDE.md Section 22.4 (Tutorial Generation Algorithm)
```

### Phase 7: Mobile-First UI Implementation (CRITICAL)

**Instruction to Agent:**

```
STEP 9: Implement Mobile-First Design (CRITICAL REQUIREMENT):

1. Set up mobile-first CSS/responsive system:
   - Base styles for mobile (< 768px)
   - Progressive enhancement for larger screens
   - Safe area insets support
   - Touch-optimized controls (44x44px minimum)
2. Implement navigation patterns:
   - Bottom navigation bar
   - Slide-out menu
   - Swipe gestures
3. Implement layout components:
   - Mobile dashboard
   - Collapsible headers
   - Full-screen content areas
   - Modal overlays
4. Implement touch optimizations:
   - Gesture support (swipe, long-press, pinch)
   - Touch target sizing
   - Haptic feedback (if available)
5. Maximize screen space:
   - Use 100vw/100vh
   - Hide chrome when reading
   - Collapsible UI elements
   - Bottom sheets for secondary actions

IMPORTANT:
- Design mobile-first, enhance for larger screens
- Maximize screen space usage
- See IMPLEMENTATION_GUIDE.md Section 3 for complete mobile-first requirements
- See IMPLEMENTATION_GUIDE.md Section 17 for UI component patterns
```

### Phase 8: Additional Features

**Instruction to Agent:**

```
STEP 10: Implement additional features:

1. Maintenance Schedules (Section 13):
   - By Indicators
   - By Interval
   - By Frequency
   
2. Parts Management (Section 14):
   - Parts fetching
   - Parts search/filter
   - Parts integration with labor
   
3. Labor Operations (Section 15):
   - Labor article handling (L:* prefix)
   - Labor details API
   - Parts association
   
4. Bookmarks (Section 16):
   - Save bookmark
   - Get bookmark
   - Bookmark outdated detection
   
5. User Settings (Section 18):
   - Settings API integration
   - Settings observables
   - Cookie fallback

Reference: IMPLEMENTATION_GUIDE.md Sections 13-18
```

### Phase 9: Data Processing Algorithms

**Instruction to Agent:**

```
STEP 11: Implement data processing algorithms:

1. Bucket Organization Algorithm (Section 22.1):
   - Filter tab processing
   - Parent-child bucket relationships
   - Empty bucket filtering
   - Sorting

2. Article Filtering Algorithm (Section 22.2):
   - Article grouping
   - Parented vs non-parented articles
   - Procedure silo handling

3. HTML Transformation (Section 11.5):
   - Custom tag transformation
   - Navigation attribute calculation

4. AI Rewriting Algorithm (Section 22.3):
   - Content extraction
   - AI rewriting
   - Content merging

5. Tutorial Generation Algorithm (Section 22.4):
   - Article analysis
   - Step extraction
   - Tutorial structure creation

Reference: IMPLEMENTATION_GUIDE.md Section 22 (Data Processing Algorithms)
```

### Phase 10: Performance and Optimization

**Instruction to Agent:**

```
STEP 12: Implement performance optimizations:

1. Debouncing (search inputs, API calls)
2. Distinct until changed (prevent duplicates)
3. Lazy loading (images, routes, components)
4. Change detection optimization
5. Entity store efficiency
6. Request deduplication
7. Image optimization (WebP, responsive images)
8. Code splitting
9. Caching strategies
10. AI rewriting optimization (batch, cache)

Reference: IMPLEMENTATION_GUIDE.md Section 20 (Performance Optimizations)
```

### Phase 11: Error Handling and Testing

**Instruction to Agent:**

```
STEP 13: Implement error handling:

1. Global error handler
2. Error boundary components
3. API error handling (network, HTTP errors)
4. Graceful degradation
5. Mobile error states

STEP 14: Implement testing:

1. API integration tests
2. State management tests
3. Component tests
4. Routing tests
5. Error scenario tests
6. Mobile device tests
7. AI rewriting tests
8. Tutorial generation tests
9. Performance tests
10. Accessibility tests

Reference: IMPLEMENTATION_GUIDE.md Section 19 (Error Handling)
Reference: IMPLEMENTATION_GUIDE.md Section 24 (Testing Considerations)
```

### Phase 12: Final Checklist

**Instruction to Agent:**

```
STEP 15: Verify implementation against checklist:

Go through IMPLEMENTATION_GUIDE.md Section 23 (Implementation Checklist) 
and verify all items are completed:

- [ ] API client setup with proxy endpoint
- [ ] State management system
- [ ] Routing system with URL state sync
- [ ] Mobile-first responsive design system
- [ ] AI content rewriting integration
- [ ] Stepper tutorial system
- [ ] Search functionality
- [ ] Article display system (with AI rewriting)
- [ ] Vehicle selection
- [ ] Maintenance schedules
- [ ] Parts management
- [ ] Bookmarks
- [ ] Labor operations
- [ ] User settings
- [ ] Error handling
- [ ] UI components (mobile-optimized)
- [ ] Performance optimizations
- [ ] Safe area support
- [ ] Touch gesture support
- [ ] Tutorial progress tracking

Ensure all critical requirements are met:
✓ Mobile-first design
✓ AI content rewriting (all text, preserve PDFs/images)
✓ Stepper tutorials (AI-generated from article data)
✓ API proxy endpoint configuration
```

## Key Points to Emphasize to the Agent

### Critical Requirements (Must-Have)

1. **Mobile-First Design**: The application MUST be mobile-first. Maximize screen space, use bottom navigation, implement touch optimizations.

2. **AI Content Rewriting**: ALL text content from the API MUST be rewritten using AI. PDFs and images remain untouched. This is a critical requirement to avoid plagiarism.

3. **Stepper Tutorials**: Generate interactive step-by-step tutorials from article content using AI. Tutorials must be mobile-optimized with swipe navigation.

4. **API Proxy**: All API calls must go through: `https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy/`

### Architecture Patterns

- **State Management**: Use Store/Query/Facade pattern (language-agnostic)
- **Reactive Programming**: Use observable/stream patterns available in your framework
- **URL as State**: Synchronize application state with URL parameters
- **Type Safety**: Strong typing for API contracts and data models

### Implementation Order

1. API Integration → 2. State Management → 3. Core Features → 4. AI Integration → 5. Tutorials → 6. Mobile UI → 7. Additional Features → 8. Performance → 9. Testing

## Sample Agent Instruction Prompt

```
You are tasked with building a Vehicle Service API Frontend application.

INSTRUCTIONS:
1. Read all documentation in the 'documentation' directory
2. Start with IMPLEMENTATION_GUIDE.md Section 1-3 to understand requirements
3. Review openapi.json to understand the API schema
4. Follow the implementation phases described in documentation/AGENT_INSTRUCTIONS.md
5. Implement all critical requirements:
   - Mobile-first design (maximize screen space)
   - AI content rewriting (all text, preserve PDFs/images)
   - AI-generated stepper tutorials
   - API proxy endpoint: https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy/
6. Use the Implementation Checklist (Section 23) to track progress
7. Reference specific sections of IMPLEMENTATION_GUIDE.md for detailed algorithms and patterns

The documentation is language-agnostic - choose your preferred technology stack but 
follow the architecture patterns and business logic described.

CRITICAL: Do not skip AI rewriting or stepper tutorials - these are mandatory features.
```

## Technology Stack Recommendations

While the documentation is language-agnostic, here are recommendations:

**Web Application:**
- **Frontend Framework**: React, Vue, Angular, Svelte, or Next.js
- **State Management**: Redux Toolkit, Zustand, MobX, or Akita
- **HTTP Client**: Axios, Fetch API, or framework-specific (Angular HttpClient)
- **Routing**: React Router, Vue Router, Angular Router, or Next.js routing
- **Mobile Framework**: React Native, Flutter, Ionic, or PWA

**Mobile Application:**
- **Native**: Swift (iOS), Kotlin/Java (Android)
- **Cross-platform**: React Native, Flutter, Xamarin
- **State Management**: Redux, MobX, Provider, or native patterns

**AI Integration:**
- **AI Service**: OpenAI API, Anthropic API, or local LLM (Llama, Mistral)
- **Prompt Engineering**: Follow guidelines in IMPLEMENTATION_GUIDE.md Section 25.6

## Documentation Navigation

**For Architecture Patterns:**
→ IMPLEMENTATION_GUIDE.md Section 1, 6

**For API Integration:**
→ IMPLEMENTATION_GUIDE.md Section 2
→ openapi.json / openapi.yaml

**For Mobile-First Design:**
→ IMPLEMENTATION_GUIDE.md Section 3, 17.4

**For AI Content Rewriting:**
→ IMPLEMENTATION_GUIDE.md Section 4, 22.3
→ Section 25.6 (AI Integration Guidelines)

**For Stepper Tutorials:**
→ IMPLEMENTATION_GUIDE.md Section 5, 22.4

**For Algorithms:**
→ IMPLEMENTATION_GUIDE.md Section 22

**For API Endpoints:**
→ IMPLEMENTATION_GUIDE.md Section 25.1
→ openapi.json / openapi.yaml

**For Data Models:**
→ IMPLEMENTATION_GUIDE.md Section 7
→ openapi.json / openapi.yaml (schemas section)

**For State Management:**
→ IMPLEMENTATION_GUIDE.md Section 6
→ API_CONSUMPTION_DOCUMENTATION.md (State Management section)

## Troubleshooting Guide for Agents

**If agent asks about unclear requirements:**
→ Reference specific section in IMPLEMENTATION_GUIDE.md
→ Check API_CONSUMPTION_DOCUMENTATION.md for existing implementation patterns
→ Review openapi.json for API contract details

**If agent asks about missing details:**
→ All details are in IMPLEMENTATION_GUIDE.md - encourage thorough reading
→ Algorithms are in Section 22
→ API details are in Section 25.1 and openapi.json
→ UI patterns are in Section 17

**If agent needs clarification on patterns:**
→ Patterns are framework-agnostic - encourage adapting to chosen framework
→ Reference Section 25.8 (Framework-Agnostic Patterns)
→ State management patterns can be implemented in any framework

## Success Criteria

The application is complete when:

1. ✅ All checklist items in Section 23 are completed
2. ✅ Mobile-first design is implemented and tested on mobile devices
3. ✅ AI content rewriting works for all text content (with fallback)
4. ✅ Stepper tutorials are generated and functional
5. ✅ All API endpoints are integrated correctly
6. ✅ State management follows described patterns
7. ✅ URL state synchronization works
8. ✅ Performance optimizations are implemented
9. ✅ Error handling is comprehensive
10. ✅ Application works on mobile devices (iOS/Android or responsive web)

## Final Notes

- The documentation is comprehensive - encourage the agent to read thoroughly
- Algorithms are detailed - they can be implemented in any language
- Patterns are framework-agnostic - adapt to chosen technology stack
- Critical requirements (mobile-first, AI rewriting, tutorials) are mandatory
- All API details are in openapi.json/openapi.yaml
- Reference API_CONSUMPTION_DOCUMENTATION.md for existing implementation patterns

---

**Last Updated**: 2025-12-30  
**Version**: 1.0
