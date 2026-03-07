# Torque Application Architecture & Progress

This document outlines the goals, progress, and detailed architecture for two major ongoing initiatives within the Torque application: **Article Organization** (Category Tree) and **Supabase Data Normalization**.

---

## 1. Article Organization (Category Tree Architecture)

### Goal
Replace the legacy, flat, bucket-based sidebar navigation with a structured, hierarchical tree. This reorganization clearly categorizes vehicle service data into intuitive, nested levels (e.g., System -> Group -> Subgroup -> Article), significantly improving user navigation and information discovery.

### Progress & Architecture
*   **State Management:** Introduced the `CategoryTreeService` (`src/services/category-tree.service.ts`). This service acts as the bridge between flat data and hierarchical UI. Currently, it takes the flat array of articles from `SearchResultsState` and dynamically processes them into a nested, recursive tree structure (`TreeNode`).
*   **UI/UX Overhaul:** The sidebar navigation (`DashboardSidebarComponent`) has been completely rewritten. It now utilizes an Angular recursive template (`ngTemplateOutlet`) to display expand/collapse folder icons (using `lucide-angular`) for systems and groups, with individual articles presented as clickable leaf nodes.
*   **Routing & State Synchronization:** The interaction between the sidebar and the main content area has been solidified. Clicking an article in the sidebar accurately syncs state, emitting an object containing both the `id` and `title`. This ensures seamless opening of the desktop `ArticleViewerComponent` or triggers correct mobile routing without losing context.
*   **Responsive Integrity:** Resolved CSS bugs that prevented the new sidebar structure from displaying correctly within the Desktop flex-layout (`hidden md:flex w-64 flex-col flex-shrink-0`).

---

## 2. Supabase Data Normalization Architecture

### Goal
Transition the application from relying entirely on live, on-the-fly Motor API calls to a structured, cached database architecture hosted on Supabase. This transition is essential for massive performance improvements (reducing API latency), ensuring data consistency, and enabling advanced querying capabilities that a flat API response cannot provide.

### Detailed Architecture

The data normalization process relies on a background worker pipeline that intercepts API traffic, processes it asynchronously using an AI parser, and upserts the structured data into Supabase.

#### 1. The Intercept and Enqueue Phase
*   **Proxy Interception:** The Node.js Express server (`vehapiproxi/src/function.js`) proxies requests to the Motor API. Using `http-proxy-middleware`, it intercepts the JSON responses.
*   **Background Queueing:** To prevent slowing down the immediate user request, the response payload is handed off to a background worker (`enqueueParsingTask` in `background_worker.js`) via a non-blocking, detached promise.
*   **Deduplication:** Before invoking the expensive AI parsing step, the worker checks Supabase (`wasAlreadyParsed`) to see if that specific endpoint/payload has already been successfully processed.

#### 2. The AI Parsing Phase (`ai_parser.js`)
*   **Schema-Driven Extraction:** We utilize the Gemini REST API (`gemini-2.0-flash`) for intelligent data extraction. The parser is provided with strict JSON schemas (`SCHEMAS` object) defining the exact shape of the expected output.
*   **Supported Entities:** The AI is configured to extract and normalize:
    *   **Procedures:** Articles, steps, tools required, parts required.
    *   **DTCs (Diagnostic Trouble Codes):** Codes, symptoms, diagnostic steps, criteria.
    *   **TSBs (Technical Service Bulletins):** Bulletin numbers, affected models, content.
    *   **Specifications:** Key-value pairs for vehicle specs.
    *   **Categories (Taxonomy):** Hierarchical relationships (`id`, `parent_id`, `name`, `type`, `sort_order`).

#### 3. Normalization and Upsert Phase (`background_worker.js` & `supabase.js`)
*   **Data Sanitization:** The `normalizeForSupabase` function ensures the AI output perfectly matches the database constraints (e.g., ensuring arrays exist, formatting dates, parsing strings to integers).
*   **Upsert Logic (Merge-Duplicates):** Data is inserted into Supabase using the REST API. Crucially, the process uses UPSERT operations (`Prefer: return=minimal,resolution=merge-duplicates`).
*   **Conflict Resolution:** Specific unique constraints define how duplicates are merged:
    *   `procedures`: `vehicle_id, title`
    *   `tsbs`: `vehicle_id, bulletin_number`
    *   `dtcs`: `vehicle_id, code`
    *   `specifications`: `vehicle_id, category, name`
    *   `categories`: `name, type` (Ensures taxonomy nodes aren't duplicated across different vehicle API calls).

#### 4. Frontend Integration Strategy
*   **Hybrid Data Fetching:** The `CategoryTreeService` has been updated to query the Supabase `categories` table via the `SupabaseService`.
*   **Graceful Fallback:** Because the background synchronization is ongoing and the database relationships (e.g., linking a `procedure` row to a specific `category_id`) are still being populated, the frontend employs a hybrid approach. It attempts to fetch the DB taxonomy, but gracefully falls back to synthesizing the category tree from the live `SearchResultsState` (the active API session data).
*   **Future State:** Once the Supabase caching pipeline has fully populated the `categories` and `procedures` tables with proper foreign key relationships, the `CategoryTreeService` will be flipped to construct the tree *entirely* from the Supabase data, bypassing the live API fallback logic entirely.

### Next Steps
1.  **Refining DB Relationships:** Update the AI parser hints and normalization logic to ensure that when `procedures` (articles) are parsed, the AI successfully extracts and assigns the correct `category_id` mapping them back to the newly populated `categories` table.
2.  **Full DB Tree Switchover:** Complete the frontend transition to rely solely on the Supabase `categories` and relational data for the sidebar navigation.
