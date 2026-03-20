# API Consumption & Logic Documentation

**Version**: 1.1  
**Last Updated**: 2026-03-20  

## Where this file lives

**`vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md`** — backend-adjacent reference for **what the Vehicle Service / M1-shaped API expects** (parameters, buckets, labor IDs, maintenance frequency codes, response envelopes). It is **not** a cue to call Motor from the Torque SPA.

## Torque frontend (Angular) — hard rule

All vehicle/API traffic from **`src/`** goes to **vehapiproxi** only (`environment.apiUrl` / `MOTOR_API_BASE_URL`). **Never** call **`motor.com`**, **`api.motor.com`**, or **`sites.motor.com`** from browser code. Those hosts are used **upstream inside the proxy**, not by the client.

Proxy wiring (CORS, Supabase JWT, credits, article access): **`documentation/VEHAPIPROXI_API_CONSUMPTION.md`**.

## Scope (read this first)

This document describes the **legacy M1 web client** architecture (Akita stores, generated API layer, facades, search/bucket/article flows) as a **reference** for the same **`/api/...` paths** that **`vehapiproxi`** proxies. Use it to align Torque’s requests with upstream semantics **through the proxy**.

**Torque implementation** in this repo: **`AGENTS.md`**, **`src/services/`** (e.g. `MotorApiService`), not the M1 Angular codebase.

**Repo note**: **`randdev/m1_crawler`** mirrors these HTTP conventions where applicable (`searchTerm`, `frequencyTypeCode` for maintenance-by-frequency, `motorVehicleId` for GM, labor only for `L:` articles, skipping `-997`/`-998`/`-999` for labor calls).

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [API Integration Layer](#api-integration-layer)
3. [Search Functionality](#search-functionality)
4. [Categorization & Bucketing](#categorization--bucketing)
5. [Sorting Logic](#sorting-logic)
6. [Data Processing Pipeline](#data-processing-pipeline)
7. [Display Logic](#display-logic)
8. [State Management](#state-management)
9. [API Endpoints Reference](#api-endpoints-reference)
10. [Quick Reference Guide](#quick-reference-guide)

---

## Architecture Overview

The application follows a **reactive, state-driven architecture** using:
- **Akita State Management** - Centralized state store
- **RxJS Observables** - Reactive data flow
- **Facade Pattern** - Simplified API access layer
- **Query Pattern** - Derived state computation

### Data Flow Architecture

```
API Request → Facade → API Service → Response → Store → Query → Component
     ↑                                                           ↓
     └────────────────── Router Query Params ←──────────────────┘
```

### Key Architectural Components

1. **Facades** - Orchestrate API calls and state updates
2. **Stores** - Hold application state (Akita EntityStore)
3. **Queries** - Compute derived state from stores
4. **API Services** - Type-safe HTTP client wrappers
5. **Components** - Present data using observables

---

## API Integration Layer

### Base Configuration

The API integration uses Angular's HttpClient with a centralized configuration:

**Location**: `src/app/generated/api/api.module.ts`

```typescript
ApiModule.forRoot({ rootUrl: '.' })
```

### API Service Structure

All API services extend `BaseService` and use the `RequestBuilder` pattern:

- **Base URL**: Configured via `ApiConfiguration`
- **Request Building**: Typed request builder with path/query parameters
- **Response Handling**: Typed responses with `StrictHttpResponse<T>`

### Content Sources

The API supports multiple content sources (vehicle manufacturers):

```typescript
enum ContentSource {
  MOTOR = 'MOTOR',
  GeneralMotors = 'GeneralMotors',
  Honda = 'Honda',
  Stellantis = 'Stellantis',
  Toyota = 'Toyota',
  Nissan = 'Nissan',
  Ford = 'Ford'
}
```

---

## Search Functionality

### Search API Endpoint

**Endpoint**: `GET /api/source/{contentSource}/vehicle/{vehicleId}/articles/v2`

**Parameters**:
- `contentSource` (path): Content source identifier
- `vehicleId` (path): Selected vehicle ID
- `searchTerm` (query, optional): Search query string
- `motorVehicleId` (query, optional): Motor/engine variant ID

**Response**: `SearchResultsResponse`
```typescript
{
  articleDetails: ArticleDetails[];
  filterTabs: FilterTab[];
  vehicleGeoBlockingDetails?: VehicleGeoBlockingDetails;
}
```

### Search Flow

#### 1. Search Trigger

Search is triggered through multiple reactive streams:

```typescript
// Location: search-results.facade.ts
combineLatest([
  contentSource$,      // Selected content source
  activeVehicleId$,    // Selected vehicle ID
  searchTerm$,         // Search query from URL
  motorVehicleId$      // Motor vehicle variant
])
```

#### 2. Debouncing & Deduplication

```typescript
.pipe(
  debounceTime(0),  // Immediate execution after all values emit
  distinctUntilChanged((a, b) => 
    a.every((value, index) => value === b[index])
  )
)
```

**Purpose**: Prevents duplicate API calls when multiple parameters change simultaneously.

#### 3. API Request Execution

```typescript
switchMap(([contentSource, vehicleId, searchTerm, motorVehicleId]) => {
  return this.searchApi.getSearchResultsByVehicleId({
    contentSource,
    vehicleId,
    searchTerm,
    motorVehicleId
  }).pipe(
    setLoading(this.searchResultsStore),  // Update loading state
    catchError((e) => {
      this.errorHandler.handleError(e);
      return EMPTY;  // Swallow errors gracefully
    })
  );
})
```

#### 4. Response Processing

```typescript
.subscribe(({ body: entities }) => {
  // Update filter tabs store
  this.filterTabsStore.set(entities?.filterTabs ?? []);
  
  // Update search results store
  this.searchResultsStore.set(entities?.articleDetails ?? []);
  
  // Handle geo-blocking information
  this.geoBlocking$.next(entities?.vehicleGeoBlockingDetails);
});
```

### Search State Management

**Store**: `SearchResultsStore` (Akita EntityStore)
- Stores `ArticleDetails[]` as entities
- Tracks active article selection
- Manages loading state

**Query Parameters** (URL-based):
- `searchTerm`: Current search query
- `vehicleId`: Selected vehicle
- `contentSource`: Content provider
- `motorVehicleId`: Engine variant
- `articleIdTrail`: Breadcrumb trail of articles

### Search User Interaction

```typescript
// Trigger search from component
search(searchTerm?: string): void {
  this.router.navigate([], {
    queryParams: {
      [QueryStringParameters.searchTerm]: searchTerm,
      [QueryStringParameters.articleIdTrail]: null,  // Reset navigation
      [QueryStringParameters.bookmarkId]: null,      // Clear bookmark
    },
    queryParamsHandling: 'merge',  // Preserve other params
  });
}
```

**Key Points**:
- Search updates URL query parameters
- Router changes trigger reactive streams
- State updates cascade through observables
- UI updates automatically via ChangeDetection

---

## Categorization & Bucketing

### Filter Tabs Structure

Search results are organized into **Filter Tabs**:

```typescript
interface FilterTab {
  name: string;              // e.g., "Basic", "All", "Engine"
  filterTabType: FilterTabType;  // "Basic", "All", "Other"
  buckets: Bucket[];         // Categories within this tab
  articleTrailId?: string;   // Default article to show
  isCountUnknown?: boolean;  // Count display flag
}
```

**Filter Tab Types**:
- `All`: Shows all articles across all categories
- `Basic`: Essential/common articles
- `Other`: Additional/specialized articles

### Bucket Structure

Articles are organized into **Buckets** (categories):

```typescript
interface Bucket {
  name: string;                    // Category name
  nameOverride?: string;           // Display name override
  sort: number;                    // Display order
  children?: Bucket[];             // Nested buckets (parent-child)
}
```

**Example Buckets**:
- "Diagnosis"
- "Maintenance"
- "Repair"
- "Procedures" (with children: "Diagnosis Procedures", "Repair Procedures")

### Bucketing Logic

#### Step 1: Article Assignment

Each `ArticleDetails` contains:
```typescript
interface ArticleDetails {
  id: string;
  title: string;
  bucket: string;              // Primary bucket assignment
  parentBucket?: string;       // Parent bucket (for nested)
  thumbnailHref?: string;      // Image URL
  // ... other properties
}
```

#### Step 2: Bucket Organization

**Location**: `search-results.query.ts` - `bucketsFilledWithArticles$`

```typescript
bucketsFilledWithArticles$: Observable<Array<BucketArticles>> = 
  combineLatest([
    this.selectAll(),              // All articles from store
    this.filterTabsQuery.filterTabs$,  // Filter tab definitions
    this.userSettings.showProcedureSilo$  // User preference
  ]).pipe(
    map(([articleDetails, filterTabs, showProcedureSilo]) => {
      let bucketList = new Array<BucketArticles>();
      
      // Handle Procedure Silo collapsing (user setting)
      if (!showProcedureSilo) {
        // Merge Procedure children into parent
        articleDetails = articleDetails.map((item) => {
          if (item.parentBucket === 'Procedures') {
            return { ...item, bucket: 'Procedures', parentBucket: undefined };
          }
          return item;
        });
      }
      
      // Process each filter tab (excluding "All")
      filterTabs
        .filter((item) => item.filterTabType !== FilterTabType.All)
        .forEach((tab) => {
          tab.buckets?.forEach((bucket) => {
            const childrenBucketList = new Array<BucketArticles>();
            
            // Process child buckets
            bucket.children?.forEach((childBucket) => {
              childrenBucketList.push({
                bucketName: childBucket.name ?? '',
                bucketFilterCategory: tab.name ?? '',
                articles: articleDetails?.filter(
                  (item) => item.bucket === childBucket.name
                ) ?? [],
                sort: bucket.sort ?? 0,
                bucketNameOverride: childBucket.nameOverride,
                bucketFilterTabType: tab.filterTabType,
              });
            });
            
            // Process parent bucket articles
            const nonParentedArticles = articleDetails?.filter(
              (item) => !item.parentBucket
            );
            
            bucketList.push({
              bucketName: bucket.name ?? '',
              bucketFilterCategory: tab.name ?? '',
              articles: nonParentedArticles?.filter(
                (item) => item.bucket === bucket.name
              ) ?? [],
              sort: bucket.sort ?? 0,
              bucketNameOverride: bucket.nameOverride,
              bucketFilterTabType: tab.filterTabType,
              isParent: bucket.children && bucket.children.length > 0,
              children: childrenBucketList,
            });
          });
        });
      
      // Filter out empty buckets
      bucketList = bucketList.filter(
        (bucketArticles) =>
          bucketArticles.articles.length > 0 ||
          (bucketArticles.isParent === true && 
           bucketArticles.children?.some(
             (item) => item.articles.length > 0
           ))
      );
      
      return bucketList;
    })
  );
```

#### Step 3: Filter Tab Aggregation

**Location**: `search-results.query.ts` - `filterTabsAndTheirFullBuckets$`

```typescript
filterTabsAndTheirFullBuckets$ = combineLatest([
  this.bucketsFilledWithArticles$,
  this.filterTabsQuery.filterTabs$
]).pipe(
  map(([fullBuckets, filterTabs]) => {
    const fullBucketByFilterTab: { [key: string]: Array<BucketArticles> } = {};
    const allTab = filterTabs.find(
      (tab) => tab.filterTabType === FilterTabType.All
    );
    
    // Initialize buckets for each filter tab
    filterTabs?.forEach((tab) => {
      fullBucketByFilterTab[tab.name ?? ''] = [];
    });
    
    // Distribute buckets to appropriate filter tabs
    for (const fullBucket of fullBuckets) {
      fullBucketByFilterTab[fullBucket.bucketFilterCategory]?.push(fullBucket);
      fullBucketByFilterTab[allTab?.name!]?.push(fullBucket);  // Also add to "All"
    }
    
    // Calculate article counts per filter tab
    const bucketCategoryArticleCount: { [key: string]: number } = {};
    for (const [category, buckets] of Object.entries(fullBucketByFilterTab)) {
      bucketCategoryArticleCount[category] = buckets.reduce((count, bucket) => {
        const childArticleCount = bucket.children?.reduce(
          (childCount, childBucket) => 
            childCount + childBucket.articles.length, 
          0
        ) ?? 0;
        return count + 
          bucket.articles.filter(
            (x) => x.id !== '-999' && x.id !== '-998'  // Exclude special IDs
          ).length + 
          childArticleCount;
      }, 0);
    }
    
    // Build final structure
    return Object.entries(fullBucketByFilterTab).map(([key, value]) => ({
      filterTab: key,
      articlesCount: bucketCategoryArticleCount[key],
      buckets: value,
      articleTrailId: filterTabs.find((i) => i.name === key)?.articleTrailId,
      isCountUnknown: filterTabs.find((x) => x.name === key)?.isCountUnknown,
      filterTabType: filterTabs.find((x) => x.name === key)?.filterTabType!,
    }));
  })
);
```

### Special Handling: Procedures Silo

**User Setting**: `showProcedureSilo`

When disabled, nested Procedure buckets are flattened:
- Child buckets (e.g., "Diagnosis Procedures") are merged into parent "Procedures"
- Articles with `parentBucket === 'Procedures'` are reassigned to `bucket = 'Procedures'`

---

## Sorting Logic

### Bucket Sorting

Buckets are sorted by their `sort` property (numeric order):

```typescript
bucketList.sort((a, b) => {
  return a.sort - b.sort;  // Ascending numeric sort
});
```

**Source**: Defined in API response `filterTabs[].buckets[].sort`

### Article Sorting

Articles within buckets maintain API response order (no client-side sorting).

**Exception**: For "All" filter tab, articles are limited to first 15 items:
```typescript
const articleSubset = showAllArticles 
  ? articles 
  : articles.slice(0, 15);  // First 15 only
```

### Vehicle Model Sorting

When fetching vehicle models:

```typescript
getMotorModels(contentSource, vehicleId).pipe(
  map((response) => 
    [...response.body!].sort((a, b) => 
      a.model.localeCompare(b.model)  // Alphabetical sort
    )
  )
)
```

### Recent Vehicles Sorting

Recent vehicles are sorted by timestamp (most recent first):

```typescript
selectedVehicles.sort((a, b) => b.id - a.id);  // Descending by timestamp
```

---

## Data Processing Pipeline

### 1. API Response Processing

#### Search Results

```typescript
API Response → SearchResultsResponse
  ↓
Filter Tabs → FilterTabsStore (entities)
  ↓
Article Details → SearchResultsStore (entities)
  ↓
Geo-blocking → Subject<VehicleGeoBlockingDetails>
```

#### Article Content

```typescript
API Response → ArticleResponse
  ↓
HTML Processing → Transform custom tags
  ↓
AssetsState → Store update
  ↓
Component Display (HTML/PDF/Full Page detection)
```

**Special Article Types**:
- **Labor Articles**: Article IDs starting with `'L:'` prefix are handled specially via `AssetsApi.getLaborDetails()`
- **Maintenance Schedule Articles**: Special IDs `'-997'` and `'-998'` are skipped (handled separately)
- **Labor Tab Article**: Special ID `'-999'` is skipped (handled via labor API)
- **Root vs Leaf**: Articles can be loaded as root (first in breadcrumb trail) or leaf (nested article)

### 2. HTML Transformation

Articles contain custom XML-like tags that are transformed to HTML:

**Location**: `assets.facade.ts` - `requestArticle()`

```typescript
const html = result?.html
  ?.replace(
    /<mtr-doc-link id=['"](.*?)['"]>([\s\S]*?)<\/mtr-doc-link>/g,
    ($0, id: string, innerHtml: string) => {
      const navigationAttributes = 
        this.calculateNavigationAttributesForId(
          id, idsToCurrentArticle, currentQueryParams
        );
      return `<a ${navigationAttributes}>${innerHtml}</a>`;
    }
  )
  .replace(
    /<mtr-image-link id='(.*?)'([^>]*)>([^<]*)<\/mtr-image-link>/g,
    ($0, id: string, extraAttributes: string, text: string) => {
      return `<span class='image-hover'>${text}
        <img src='api/source/${contentSource}/graphic/${id}'
          ${extraAttributes} loading='lazy'>
      </span>`;
    }
  )
  .replace(
    /<mtr-image id='(.*?)'([^>]*)><\/mtr-image>/g,
    ($0, id: string, extraAttributes: string) => {
      return `<img src='api/source/${contentSource}/graphic/${id}'
        ${extraAttributes}>`;
    }
  )
  .replace(
    /<mtr-area id=['"](.*?)['"]([^>]*)>([^<]*)<\/mtr-area>/g,
    ($0, id: string, extraAttributes: string, innerHtml: string) => {
      const navigationAttributes = 
        this.calculateNavigationAttributesForId(
          id, idsToCurrentArticle, currentQueryParams
        );
      return `<area ${navigationAttributes}${extraAttributes}>
        ${innerHtml}</area>`;
    }
  );
```

**Transformations**:
1. **`<mtr-doc-link>`** → `<a>` tags with navigation attributes
2. **`<mtr-image-link>`** → Image hover spans with lazy loading
3. **`<mtr-image>`** → Direct `<img>` tags
4. **`<mtr-area>`** → Image map areas with navigation

### 3. Navigation Attribute Calculation

```typescript
calculateNavigationAttributesForId(
  id: string,
  idsToCurrentArticle: Array<string>,
  currentQueryParams: { [_: string]: any }
) {
  // Prevent reloading same article
  const nextArticleIds = 
    idsToCurrentArticle[idsToCurrentArticle.length - 1] === id
      ? idsToCurrentArticle  // Same article, keep current trail
      : [...idsToCurrentArticle, id];  // Append to trail
  
  const newQueryParameters = { 
    [QueryStringParameters.articleIdTrail]: nextArticleIds.join(',')
  };
  const mergedQueryParameters = new HttpParams({
    fromObject: { ...currentQueryParams, ...newQueryParameters },
  });
  
  // Generate href for browser behavior (middle-click, hover preview)
  return `href="${location.pathname}?${mergedQueryParameters.toString()}" 
    merge-query-params='${JSON.stringify(newQueryParameters)}'`;
}
```

**Purpose**: Creates breadcrumb trails for article navigation while maintaining browser compatibility.

### 4. Filtering & Search Processing

#### Client-Side Filtering (Delta Report Example)

```typescript
filteredReport$ = combineLatest([
  this.report$,
  this.filterTerm$.pipe(
    debounceTime(150),  // Debounce input
    map((s) => (s ?? '').trim().toLowerCase()),
    distinctUntilChanged()
  ),
]).pipe(
  map(([rows, q]) => {
    if (!q) return rows;
    
    // Tokenize search query (supports quoted phrases)
    const tokens = (q.match(/"([^"]+)"|\S+/g) || [])
      .map((t) => t.replace(/^"|"$/g, '').toLowerCase());
    
    return rows.filter((r) => {
      // Create searchable string from all fields
      const dateStr = r.publishedDate 
        ? new Date(r.publishedDate).toLocaleDateString('en-US') 
        : '';
      const searchableItems = [
        r.year ?? '',
        r.make ?? '',
        r.model ?? '',
        r.processedQuarter ?? '',
        r.actionState ?? '',
        dateStr
      ].join(' ').toLowerCase();
      
      // All tokens must match (AND logic)
      return tokens.every((tok) => searchableItems.includes(tok));
    });
  })
);
```

**Features**:
- **Debouncing**: 150ms delay to reduce filter operations
- **Tokenization**: Splits query into words/phrases
- **Quoted Phrases**: `"exact phrase"` matches as single token
- **AND Logic**: All tokens must match
- **Case Insensitive**: Converts to lowercase

---

## Display Logic

### Display Pipeline

```
Store State → Query Observable → Component Observable → Template
     ↑                                              ↓
     └────────── User Interaction ──────────────────┘
```

### Search Results Display

#### Component: `SearchResultsPanelComponent`

**Observable Chain**:

```typescript
itemsToDisplay$: Observable<Array<PossibleItemTypes>> = 
  combineLatest([
    this.searchResultsFacade.selectedFilter$,      // Active filter tab
    this.searchResultsFacade.filterTabsAndTheirFullBuckets$,  // Bucket data
    this.isCollapsedByBucket$,                     // UI state
    this.isShowingAllByBucket$,                    // UI state
  ]).pipe(
    map(([filter, tabs, isCollapsedByBucket, isShowingAllByBucket]) => {
      const tab = tabs.find((t) => t.filterTab === filter);
      const buckets = tab?.buckets || [];
      
      // Transform buckets to display items
      return buckets.reduce<Array<PossibleItemTypes>>((prev, curr) => {
        if (curr.isParent) {
          prev.push(...addBucketItems(curr));
          const bucketName = curr.bucketNameOverride || curr.bucketName;
          if (!isCollapsedByBucket[bucketName]) {
            curr.children?.forEach((childBucket) => {
              prev.push(...addBucketItems(childBucket, true));
            });
          }
        } else {
          prev.push(...addBucketItems(curr));
        }
        return prev;
      }, []);
    })
  );
```

#### Display Item Types

```typescript
type PossibleItemTypes = 
  | BucketHeaderItem      // Bucket title
  | BucketShowAllItem     // "Show All" button
  | ArticleDetailsItem    // Single article
  | ArticleDetailsList;   // Article grid (thumbnails)
```

#### Article Display Modes

**1. List Mode** (no thumbnails):
```typescript
articleSubset.forEach((article) => {
  items.push({ kind: 'ArticleDetails', details: article, isChild });
});
```

**2. Grid Mode** (with thumbnails):
```typescript
if (this.hasThumbnails(articleSubset)) {
  items.push({ kind: 'ArticleDetailsList', list: articleSubset, isChild });
}
```

**Thumbnail Detection**:
```typescript
hasThumbnails(item: Array<ArticleDetails>): boolean {
  // All articles in bucket must have thumbnails
  return Boolean(item[0]?.thumbnailHref);
}
```

#### Pagination Logic ("Show All")

For "All" filter tab, articles are limited to 15 initially:

```typescript
const showAllArticles = 
  tab?.filterTabType !== FilterTabType.All || 
  isShowingAllByBucket[bucketName];

const articleSubset = showAllArticles 
  ? articles           // Show all
  : articles.slice(0, 15);  // Show first 15

// Add "Show All" button if needed
if (tab?.filterTabType === FilterTabType.All && 
    articles.length > 15 && 
    !isShowingAllByBucket[bucketName]) {
  items.push({ 
    kind: 'BucketShowAll', 
    bucket: bucketName, 
    count: articles.length, 
    isChild 
  });
}
```

### Collapsible Buckets

**User Setting**: `lhNavigationDefaultMode`

When set to `'Collapsed'`, all buckets start collapsed:

```typescript
combineLatest([
  this.searchResultsFacade.selectedFilter$,
  this.searchResultsFacade.filterTabsAndTheirFullBuckets$,
  this.userSettingsService.lhNavigationDefaultMode$,
]).subscribe(([filter, tabs, lhNavigationDefaultMode]) => {
  if (lhNavigationDefaultMode?.trim() === 'Collapsed') {
    const tab = tabs.find((t) => t.filterTab === filter);
    const buckets = tab?.buckets || [];
    const collapsedByBuckets: { [key: string]: boolean } = {};
    
    const collapseBucket = (bucket: BucketArticles) => {
      const bucketName = bucket.bucketNameOverride || bucket.bucketName;
      collapsedByBuckets[bucketName] = true;
      bucket.children?.forEach(collapseBucket);  // Recursive
    };
    
    buckets.forEach(collapseBucket);
    this.isCollapsedByBucket$.next(collapsedByBuckets);
  }
});
```

### Article Activation

Clicking an article updates the URL and triggers article loading:

```typescript
activateArticle(doc: ArticleDetails): void {
  this.router.navigate([], {
    queryParams: {
      [QueryStringParameters.articleIdTrail]: doc.id,
      [QueryStringParameters.bookmarkId]: null,  // Clear bookmark
    },
    queryParamsHandling: 'merge',
  });
}
```

---

## State Management

### Akita Store Pattern

The application uses **Akita** for state management with three core concepts:

1. **Store** - Holds state
2. **Query** - Reads/derives state
3. **Facade** - Coordinates actions

### Store Structure

#### SearchResultsStore

```typescript
interface SearchResultsState extends EntityState<ArticleDetails>, ActiveState {
  active: string | null;    // Active article ID
  loading: boolean;         // Loading state
  entities: { [id: string]: ArticleDetails };  // Entity map
  ids: string[];            // Entity IDs array
}
```

**Operations**:
- `set(entities)` - Replace all entities
- `setActive(id)` - Set active article
- `reset()` - Clear store
- `setLoading(state)` - Update loading state

#### FilterTabsStore

```typescript
interface FilterTabsState extends EntityState<FilterTab>, ActiveState {
  active: string | null;
  loading: boolean;
  entities: { [name: string]: FilterTab };
  ids: string[];
}
```

**Store Configuration**: Uses `idKey: 'name'` to use the filter tab name as the entity ID instead of a default ID.

#### MaintenanceSchedulesByIndicatorStore & MaintenanceSchedulesByIntervalStore

```typescript
// Uses idKey: 'name' for entity identification
@StoreConfig({ name: 'maintenance-schedules-by-indicators', resettable: true, idKey: 'name' })
export class MaintenanceSchedulesByIndicatorStore extends EntityStore<MaintenanceSchedulesByIndicatorState> {}

@StoreConfig({ name: 'maintenance-schedules-by-intervals', resettable: true, idKey: 'name' })
export class MaintenanceSchedulesByIntervalStore extends EntityStore<MaintenanceSchedulesByIntervalState> {}
```

#### VehiclePartsStore

```typescript
// Uses idKey: 'partNumber' for entity identification
@StoreConfig({ name: 'vehicle-parts', resettable: true, idKey: 'partNumber' })
export class VehiclePartsStore extends EntityStore<VehiclePartsState> {}
```

### Query Pattern

Queries compute derived state from stores:

```typescript
// Base query
class SearchResultsQuery extends QueryEntity<SearchResultsState> {
  // All articles
  selectAll(): Observable<ArticleDetails[]>
  
  // Active article
  selectActive(): Observable<ArticleDetails | undefined>
  
  // Loading state
  selectLoading(): Observable<boolean>
  
  // Custom computed observables
  bucketsFilledWithArticles$: Observable<Array<BucketArticles>>
  filterTabsAndTheirFullBuckets$: Observable<...>
}
```

### Facade Pattern

Facades orchestrate multiple stores and API calls:

```typescript
class SearchResultsFacade {
  constructor(
    private searchApi: SearchApi,
    private searchResultsStore: SearchResultsStore,
    private searchResultsQuery: SearchResultsQuery,
    private filterTabsStore: FilterTabsStore,
    private router: Router,
    // ...
  ) {
    // Set up reactive subscriptions
    this.setupSearchSubscription();
  }
  
  // Public API for components
  search(searchTerm?: string): void { }
  activateArticle(doc: ArticleDetails): void { }
  
  // Public observables
  all$ = this.searchResultsQuery.selectAll();
  loading$ = this.searchResultsQuery.selectLoading();
  // ...
}
```

### State Synchronization

State is synchronized via URL query parameters:

```typescript
// Read from URL
searchTerm$ = this.routerQuery.selectQueryParams<string>(
  QueryStringParameters.searchTerm
);

// Write to URL (triggers state update)
search(searchTerm: string) {
  this.router.navigate([], {
    queryParams: { [QueryStringParameters.searchTerm]: searchTerm },
    queryParamsHandling: 'merge',
  });
}
```

**Benefits**:
- **Shareable URLs**: State in URL = shareable links
- **Browser History**: Back/forward navigation works
- **Bookmarkable**: Users can bookmark specific states
- **Deep Linking**: Direct access to articles/search

---

## API Endpoints Reference

### Search Endpoints

#### Get Search Results
```
GET /api/source/{contentSource}/vehicle/{vehicleId}/articles/v2
```

**Parameters**:
- `contentSource` (path, required): Content source enum
- `vehicleId` (path, required): Vehicle identifier
- `searchTerm` (query, optional): Search query
- `motorVehicleId` (query, optional): Motor variant ID

**Response**: `SearchResultsResponse`
```typescript
{
  articleDetails: ArticleDetails[];
  filterTabs: FilterTab[];
  vehicleGeoBlockingDetails?: VehicleGeoBlockingDetails;
}
```

### Article Endpoints

#### Get Article by ID
```
GET /api/source/{contentSource}/vehicle/{vehicleId}/article/{articleId}
```

**Parameters**:
- `contentSource` (path, required)
- `vehicleId` (path, required)
- `articleId` (path, required)
- `motorVehicleId` (query, optional)
- `prettyPrint` (query, optional, boolean)
- `bucketName` (query, optional)
- `articleSubtype` (query, optional)
- `searchTerm` (query, optional)

**Response**: `ArticleResponse`
```typescript
{
  html?: string;
  pdf?: string;  // Base64 encoded
  documentId?: string;
  publishedDate?: string;
  releaseDate?: string;
  isOutdated?: boolean;
  contentSilos?: string[];
  sourceSilos?: string[];
}
```

#### Get Article Title
```
GET /api/source/{contentSource}/vehicle/{vehicleId}/article/{articleId}/title
```

**Response**: `StringResponse`
```typescript
{
  value: string;
}
```

### Vehicle Endpoints

#### Get Years
```
GET /api/years
```

**Response**: `Int32ListResponse`
```typescript
{
  items: number[];
}
```

#### Get Makes
```
GET /api/year/{year}/makes
```

**Response**: `MakeListResponse`
```typescript
{
  items: string[];
}
```

#### Get Models
```
GET /api/year/{year}/make/{make}/models
```

**Response**: `ModelsResponseResponse`
```typescript
{
  models: Array<{
    model: string;
    vehicleId: string;
  }>;
}
```

#### Get Vehicle by VIN
```
GET /api/vin/{vin}/vehicle
```

**Response**: `VinVehicleResponseResponse`

#### Get Vehicles (POST)
```
POST /api/source/{contentSource}/vehicles
```

**Request Body**: `GetVehiclesRequest`
```typescript
{
  vehicleIds: string[];
}
```

**Response**: `ModelAndVehicleIdListResponse`

### Parts Endpoints

#### Get Parts for Vehicle
```
GET /api/source/{contentSource}/vehicle/{vehicleId}/parts
```

**Parameters**:
- `contentSource` (path, required)
- `vehicleId` (path, required)
- `motorVehicleId` (query, optional)
- `searchTerm` (query, optional)

**Response**: `PartLineItemListResponse`
```typescript
{
  items: PartLineItem[];
}

interface PartLineItem {
  partNumber: string;
  partDescription: string;
  quantity?: number;
  isAdded?: boolean;  // Set when part is added to labor operation
  // ...
}
```

**Usage**: Parts are fetched when a vehicle is selected and stored in `VehiclePartsStore` (using `idKey: 'partNumber'`). Parts can be searched/filtered and added to labor operations.

### Labor Endpoints

#### Get Labor Details
```
GET /api/source/{contentSource}/vehicle/{vehicleId}/labor/{articleId}
```

**Parameters**:
- `contentSource` (path, required)
- `vehicleId` (path, required)
- `articleId` (path, required): Labor article ID (format: `L:12345` or just the ID)
- `motorVehicleId` (query, optional)
- `searchTerm` (query, optional)

**Response**: `Labor` object containing main operation and associated parts

**Usage**: Labor articles are identified by IDs starting with `'L:'` prefix. The `AssetsFacade.requestLaborArticlesOnIdChange()` method handles fetching labor details separately from regular articles. Labor operations can have associated parts that can be added/removed.

### Bookmark Endpoints

#### Save Bookmark
```
POST /api/source/{contentSource}/vehicle/{vehicleId}/article/{articleId}/bookmark
```

**Parameters**:
- `contentSource` (path, required)
- `vehicleId` (path, required)
- `articleId` (path, required)

**Response**: `ArticleBookmarkResponse`
```typescript
{
  bookmarkId: number;
  articleId: string;
  vehicleId: string;
}
```

**Usage**: Bookmarks are saved via the `BookmarkApi.saveBookmark()` method. After saving, the bookmark ID is returned and can be used to retrieve the article later. Bookmarks support external system integration (e.g., CCCIS browser API).

#### Get Bookmark
```
GET /api/bookmark/{bookmarkId}
```

**Parameters**:
- `bookmarkId` (path, required): Bookmark ID (number)

**Response**: `ArticleResponse` (same structure as regular article response)

**Usage**: When a `bookmarkId` query parameter is present in the URL, the `AssetsFacade` automatically uses `BookmarkApi.getBookmark()` instead of `AssetApi.getArticleById()` to retrieve the bookmarked article. Bookmarks may include an `isOutdated` flag indicating the article content has changed since bookmarking.

### Graphic/Image Endpoints

#### Get Graphic
```
GET /api/source/{contentSource}/graphic/{id}
```

**Parameters**:
- `contentSource` (path, required)
- `id` (path, required): Image ID
- `w` (query, optional): Width
- `h` (query, optional): Height

**Response**: Image binary data

### Maintenance Schedule Endpoints

#### Get Indicators with Maintenance Schedules
```
GET /api/source/{contentSource}/vehicle/{vehicleId}/maintenanceSchedules/indicators
```

**Parameters**:
- `contentSource` (path, required): Must be `ContentSource.Motor`
- `vehicleId` (path, required): Motor vehicle ID if content source is not MOTOR
- `severity` (query, optional): `MaintenanceScheduleSeverity` enum
- `searchTerm` (query, optional)

**Response**: Returns indicators with associated maintenance schedules

**Usage**: Used by `MaintenanceSchedulesFacade.searchByIndicators()` to fetch maintenance schedules organized by indicator lights.

#### Get Maintenance Schedules by Frequency
```
GET /api/source/{contentSource}/vehicle/{vehicleId}/maintenanceSchedules/frequency
```

**Parameters**:
- `contentSource` (path, required): Must be `ContentSource.Motor`
- `vehicleId` (path, required): Motor vehicle ID if content source is not MOTOR
- `frequencyTypeCode` (query, required): Single character code ('F', 'N', 'R')
- `severity` (query, optional): `MaintenanceScheduleSeverity` enum
- `searchTerm` (query, optional)

**Response**: Maintenance schedule applications grouped by frequency type

**Usage**: Used by `MaintenanceSchedulesFacade.searchByFrequency()` to fetch schedules for specific frequency types.

#### Get Maintenance Schedules by Interval
```
GET /api/source/{contentSource}/vehicle/{vehicleId}/maintenanceSchedules/intervals
```

**Parameters**:
- `contentSource` (path, required): Must be `ContentSource.Motor`
- `vehicleId` (path, required): Motor vehicle ID if content source is not MOTOR
- `intervalType` (query, optional): `IntervalType` enum (Miles/Kilometers/Months)
- `interval` (query, optional, number): Specific interval value
- `severity` (query, optional): `MaintenanceScheduleSeverity` enum
- `searchTerm` (query, optional)

**Response**: Maintenance schedules organized by intervals

**Usage**: Used by `MaintenanceSchedulesFacade.searchByInterval()` to fetch schedules filtered by interval type and value.

**Note**: All maintenance schedule endpoints require MOTOR content source and may need `motorVehicleId` for non-MOTOR content sources.

---

## Error Handling

### Error Handling Strategy

```typescript
.pipe(
  catchError((e) => {
    this.errorHandler.handleError(e);  // Global error handler
    return EMPTY;  // Swallow error, continue stream
  })
)
```

**Approach**:
- Errors are logged via global error handler
- Streams continue with `EMPTY` (no values emitted)
- UI shows empty states gracefully
- Loading states are cleared

### Common Error Scenarios

1. **Network Errors**: Handled by HttpClient, caught in catchError
2. **404 Not Found**: Article not found, handled gracefully
3. **Geo-blocking**: Returned in response, displayed as modal (`geo-blocking-modal` component)
4. **Invalid Vehicle**: No search results, empty state shown
5. **Missing Content Source/Vehicle ID**: API calls return `EMPTY` observable when required parameters are missing
6. **Special Article IDs**: Articles with IDs `-997`, `-998`, `-999`, or `L:*` are skipped (handled by specialized endpoints)

---

## Performance Optimizations

### 1. Debouncing

**Search Input**: 150ms debounce (delta report filtering)
**API Calls**: 0ms debounce (immediate after all values emit)

### 2. Distinct Until Changed

Prevents duplicate operations when values haven't changed:

```typescript
distinctUntilChanged((a, b) => 
  a.every((value, index) => value === b[index])
)
```

### 3. Lazy Loading

Images use lazy loading attribute:
```html
<img src='...' loading='lazy'>
```

### 4. Change Detection

Components use `OnPush` change detection:
- Only updates when observables emit
- Reduces unnecessary DOM updates

### 5. Entity Store Pattern

Akita EntityStore provides:
- Efficient entity lookups by ID
- Automatic deduplication
- Optimized updates

---

## URL Query Parameters

### Parameter Definitions

**Location**: `url-parameters.ts`

```typescript
enum QueryStringParameters {
  searchTerm = 'searchTerm',
  vehicleId = 'vehicleId',
  contentSource = 'contentSource',
  motorVehicleId = 'motorVehicleId',
  articleIdTrail = 'articleIdTrail',
  bookmarkId = 'bookmarkId',
  vin = 'vin',
  vehicleIdChoices = 'vehicleIdChoices'
}

enum PathParameters {
  filterTab = 'filterTab',
  vehicleId = 'vehicleId',
  contentSource = 'contentSource',
  articleId = 'articleId',
  bookmarkId = 'bookmarkId'
}
```

### URL Structure Examples

**Search Results**:
```
/docs/Basic?vehicleId=12345&contentSource=MOTOR&searchTerm=brake
```

**Article View**:
```
/docs/Basic?vehicleId=12345&contentSource=MOTOR&articleIdTrail=98765
```

**Article Breadcrumb**:
```
/docs/Basic?vehicleId=12345&articleIdTrail=98765,54321,11111
```

**Bookmark**:
```
/docs/Basic?vehicleId=12345&bookmarkId=42
```

---

## Summary

This application implements a sophisticated reactive data flow:

1. **User Input** → URL Query Parameters
2. **Router Changes** → Reactive Observables
3. **Observables Combine** → API Requests
4. **API Responses** → Store Updates
5. **Stores** → Query Computations
6. **Queries** → Component Observables
7. **Components** → UI Updates

Key strengths:
- **Type-safe**: Full TypeScript coverage
- **Reactive**: RxJS observables throughout
- **State-driven**: Akita state management
- **URL-synced**: Shareable, bookmarkable state
- **Performant**: Debouncing, lazy loading, OnPush
- **Maintainable**: Clear separation of concerns

The architecture supports complex categorization, sorting, filtering, and display logic while maintaining clean code organization and excellent user experience.

---

## Quick Reference Guide

### Common Tasks

#### 1. Trigger a Search
```typescript
// From a component
this.searchResultsFacade.search('brake pads');
```

#### 2. Load an Article
```typescript
// From a component
this.searchResultsFacade.activateArticle(articleDetails);
```

#### 3. Filter Search Results
Search filtering is handled by the API. The `searchTerm` parameter filters articles server-side.

#### 4. Access Search Results
```typescript
// In a component
this.searchResultsFacade.all$.subscribe(articles => {
  console.log('All articles:', articles);
});

this.searchResultsFacade.bucketsFilledWithArticles$.subscribe(buckets => {
  console.log('Organized buckets:', buckets);
});
```

#### 5. Get Filter Tabs
```typescript
this.searchResultsFacade.filterTabs$.subscribe(tabs => {
  console.log('Available filter tabs:', tabs);
});
```

#### 6. Check Loading State
```typescript
this.searchResultsFacade.loading$.subscribe(isLoading => {
  if (isLoading) {
    // Show loading indicator
  }
});
```

### Key Files Reference

| File | Purpose |
|------|---------|
| `search-results.facade.ts` | Main search orchestration |
| `search-results.store.ts` | Search results state store |
| `search-results.query.ts` | Search results queries & derived state |
| `search-results-panel.component.ts` | Search results display component |
| `assets.facade.ts` | Article content loading (root/leaf, PDF/HTML) |
| `assets.store.ts` | Article content state stores (RootAssetsStore, LeafAssetsStore, LaborStore, VehiclePartsStore) |
| `assets.query.ts` | Article content queries |
| `vehicle-selection.facade.ts` | Vehicle selection logic |
| `maintenance-schedules.facade.ts` | Maintenance schedule operations (indicators, intervals, frequency) |
| `maintenance-schedules.store.ts` | Maintenance schedule state stores |
| `maintenance-schedules.query.ts` | Maintenance schedule queries |
| `url-parameters.ts` | URL parameter constants (QueryStringParameters, PathParameters) |
| `filter-tabs.store.ts` | Filter tabs state store (uses idKey: 'name') |
| `filter-tabs.query.ts` | Filter tabs queries |

### Observable Patterns

#### Combining Multiple Observables
```typescript
combineLatest([
  observable1$,
  observable2$,
  observable3$
]).pipe(
  map(([val1, val2, val3]) => {
    // Process combined values
  })
)
```

#### Conditional API Calls
```typescript
switchMap(([param1, param2]) => {
  if (!param1 || !param2) {
    return of(undefined);  // Skip API call
  }
  return this.apiService.call({ param1, param2 });
})
```

#### Error Handling
```typescript
.pipe(
  catchError((error) => {
    this.errorHandler.handleError(error);
    return EMPTY;  // Continue stream with no values
  })
)
```

### State Update Patterns

#### Update Store from API Response
```typescript
this.apiService.getData().subscribe(({ body }) => {
  this.store.set(body.items ?? []);
});
```

#### Update Store Loading State
```typescript
this.apiService.getData().pipe(
  setLoading(this.store)
).subscribe(({ body }) => {
  this.store.set(body.items);
});
```

#### Reset Store Before New Request
```typescript
tap(() => this.store.reset()),
switchMap(() => this.apiService.getData())
```

#### Update Non-Entity Store (AssetsState)
```typescript
// For non-entity stores, use update() instead of set()
this.store.update({
  html: result.html,
  base64Pdf: result.pdf,
  documentId: result.documentId,
  // ...
});
```

#### Entity Store with Custom ID Key
```typescript
// Stores using idKey (FilterTabsStore, VehiclePartsStore, etc.)
// Entities are keyed by the specified field (name, partNumber, etc.)
@StoreConfig({ name: 'filter-tabs', resettable: true, idKey: 'name' })
export class FilterTabsStore extends EntityStore<FilterTabsState> {}
```

### URL Parameter Management

#### Read Parameter
```typescript
this.routerQuery.selectQueryParams<string>(
  QueryStringParameters.searchTerm
).subscribe(searchTerm => {
  console.log('Current search:', searchTerm);
});
```

#### Update Parameter
```typescript
this.router.navigate([], {
  queryParams: {
    [QueryStringParameters.searchTerm]: 'new search',
  },
  queryParamsHandling: 'merge',  // Preserve other params
});
```

#### Clear Parameter
```typescript
this.router.navigate([], {
  queryParams: {
    [QueryStringParameters.searchTerm]: null,
  },
  queryParamsHandling: 'merge',
});
```

### Bucket Processing Example

```typescript
// Process articles into buckets
const bucketMap = new Map<string, ArticleDetails[]>();

articles.forEach(article => {
  const bucketName = article.bucket;
  if (!bucketMap.has(bucketName)) {
    bucketMap.set(bucketName, []);
  }
  bucketMap.get(bucketName)!.push(article);
});

// Convert to array
const buckets = Array.from(bucketMap.entries()).map(([name, articles]) => ({
  bucketName: name,
  articles: articles,
  sort: getSortOrder(name)
}));

// Sort buckets
buckets.sort((a, b) => a.sort - b.sort);
```

### HTML Transformation Example

```typescript
// Transform custom tags in article HTML
const transformedHtml = html
  .replace(/<mtr-doc-link id=['"](.*?)['"]>(.*?)<\/mtr-doc-link>/g, 
    (match, id, content) => {
      return `<a href="/article/${id}">${content}</a>`;
    }
  )
  .replace(/<mtr-image id='(.*?)'><\/mtr-image>/g,
    (match, imageId) => {
      return `<img src="/api/image/${imageId}" />`;
    }
  );
```

---

## Glossary

- **Bucket**: A category/group that contains articles (e.g., "Diagnosis", "Repair")
- **Filter Tab**: A top-level grouping of buckets (e.g., "Basic", "All")
- **Article Details**: Metadata about an article (ID, title, bucket, thumbnail)
- **Article Response**: Full article content (HTML, PDF, metadata)
- **Content Source**: The vehicle manufacturer/OEM (MOTOR, Honda, Toyota, etc.)
- **Motor Vehicle**: Engine/submodel variant of a vehicle (identified by `motorVehicleId`)
- **Facade**: Service layer that orchestrates API calls and state management
- **Store**: Akita store that holds application state (EntityStore for collections, Store for objects)
- **Query**: Akita query that computes derived state from stores
- **Observable**: RxJS stream that emits values over time
- **Entity State**: Akita pattern for managing collections of entities
- **idKey**: Store configuration option to use a custom field as entity ID (e.g., 'name', 'partNumber')
- **Root Article**: The first article in a breadcrumb trail (articleIdTrail)
- **Leaf Article**: A nested article in the breadcrumb trail (after the root)
- **Bookmark**: Saved reference to an article that can be retrieved later by bookmark ID
- **Labor Article**: Special article type with ID prefix `'L:'` handled via labor API
- **Full Page HTML**: Complete HTML document with DOCTYPE, displayed in iframe
- **Procedure Silo**: User setting that controls whether Procedure buckets show nested children or flattened structure

---

## Best Practices

1. **Always use Facades**: Don't call API services directly from components
2. **Leverage Observables**: Use reactive patterns for data flow
3. **Handle Errors Gracefully**: Use catchError to prevent stream failures
4. **Debounce User Input**: Prevent excessive API calls
5. **Use distinctUntilChanged**: Avoid duplicate operations
6. **Reset Stores**: Clear state before new data loads
7. **URL as Source of Truth**: Keep state synchronized with URL parameters
8. **OnPush Change Detection**: Use for better performance
9. **Type Safety**: Leverage TypeScript for type-safe API calls
10. **Loading States**: Always track and display loading indicators

---

## Troubleshooting

### Search Not Triggering
- Check URL query parameters are set correctly
- Verify observables are subscribed
- Check for errors in console

### Articles Not Displaying
- Verify store has entities: `this.store.getValue().entities`
- Check query observables are emitting
- Verify filter tab selection

### API Errors
- Check network tab for failed requests
- Verify content source and vehicle ID are valid
- Check API response format matches expected types

### State Not Updating
- Ensure observables are properly subscribed
- Check for errors preventing stream completion
- Verify store updates are happening

---

**End of Documentation**
