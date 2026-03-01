export interface ApiResponse<T> {
  header: {
    status: string;
    statusCode: number;
    date?: string;
    messages?: any[];
  };
  body: T;
}

// Content Source Enum
export type ContentSource = 'MOTOR' | 'GeneralMotors' | 'Honda' | 'Stellantis' | 'Toyota' | 'Nissan' | 'Ford';

// Interval Type Enum
export type IntervalType = 'Miles' | 'Kilometers' | 'Months';

// Maintenance Schedule Severity Enum
export type MaintenanceScheduleSeverity = 'All' | 'Severe' | 'Normal';

// Filter Tab Type Enum
export type FilterTabType = 'Basic' | 'All' | 'Other';

// VIN Decode Response - Updated to match OpenAPI spec
export interface VinDecodeData {
  vin: string;
  vehicleId: string;
  contentSource?: string;
  year?: number;
  make?: string;
  model?: string;
  motorVehicleId?: string;
}

export interface Make {
  makeId: number;
  makeName: string;
}

export interface Model {
  model: string;
  id: string;
  engines?: Engine[];
}

export interface Engine {
  id: string;
  name: string;
}

export interface ModelsData {
  contentSource: string;
  models: Model[];
}

export interface Article {
  id: string;
  title: string;
  subtitle?: string;
  code?: string;
  description?: string;
  bucket: string;
  parentBucket?: string;
  thumbnailHref?: string;
  bulletinNumber?: string;
  releaseDate?: string;
  sort?: number;
}

export interface FilterTab {
  name: string;
  count?: number; // Some APIs use count
  articlesCount?: number; // MOTOR v2 uses articlesCount
  type?: string;
  filterTabType?: FilterTabType;
  buckets?: Bucket[];
  articleTrailId?: string;
  isCountUnknown?: boolean;
  sort?: number;
}

export interface ArticlesData {
  articleDetails: Article[];
  filterTabs: FilterTab[];
}

// Article Response (matches OpenAPI ArticleResponse schema)
export interface ArticleResponse {
  id: string;
  title: string;
  content: string;
  metadata?: Record<string, any>;
}

// Article Content Data (internal use - wraps HTML)
export interface ArticleContentData {
  html: string;
  content?: string;
  html_content?: string;
  pdfDataUri?: string;  // Set when article content is a PDF (base64 data URI)
  id?: string;
  title?: string;
  metadata?: Record<string, any>;
}

// Labor Response (matches OpenAPI LaborResponse schema)
export interface LaborResponseOpenApi {
  id: string;
  title: string;
  content: string;
  metadata?: Record<string, any>;
}

// String Response Wrapper
export interface StringResponse {
  value: string;
}

// Maintenance Schedules Response Types
export interface MaintenanceSchedulesByFrequencyResponse {
  schedules: any[];
}

export interface MaintenanceSchedulesByIntervalResponse {
  schedules: any[];
}

export interface IndicatorsWithMaintenanceSchedulesResponse {
  indicators: any[];
}

export interface PersistedVehicle {
  vehicleId: string;
  contentSource: string;
  name: string;
}

export interface AISearchSummary {
  likelyCauses: {
    cause: string;
    articles: { title: string; id: string; }[];
  }[];
}

// --- New Interfaces ---

export interface Category {
  name: string;
  count: number;
}

export interface CategoriesResponse {
  categories: Category[];
}

export interface Dtc {
  id: string;
  code: string;
  description: string;
  bucket: string;
}

export interface DtcsResponse {
  total: number;
  data: Dtc[];
}

export interface Tsb {
  id: string;
  bulletinNumber: string;
  title: string;
  releaseDate: string;
  thumbnailHref?: string;
  description?: string;
}

export interface TsbsResponse {
  total: number;
  data: Tsb[];
}

export interface WiringDiagram {
  id: string;
  bucket: string;
  title: string;
  subtitle?: string;
  thumbnailHref: string;
}

export interface WiringDiagramsResponse {
  total: number;
  allDiagramsTotal: number;
  data: WiringDiagram[];
}

export interface ComponentLocation {
  id: string;
  bucket: string;
  title: string;
  thumbnailHref: string;
}

export interface ComponentLocationsResponse {
  total: number;
  data: ComponentLocation[];
}

export interface DiagramsResponse {
  total: number;
  data: (WiringDiagram | ComponentLocation)[];
}

export interface Procedure {
  id: string;
  bucket: string;
  title: string;
  subtitle?: string;
  parentBucket: string;
}

export interface ProceduresResponse {
  data: Procedure[];
}

export interface SearchIntent {
  optimizedTerm: string;
  category?: string; // 'spec', 'procedure', 'part', 'dtc'
  type: 'article_search' | 'dtc_fetch' | 'procedure_fetch';
}

export interface ComparisonResult {
  modelName: string;
  vehicleId: string;
  foundArticle?: Article; // Top result
  searchError?: string;
}

export interface CommonIssue {
  title: string;
  description: string;
  symptoms: string[];
  severity: 'High' | 'Medium' | 'Low';
  fixComplexity: 'Easy' | 'Moderate' | 'Hard';
}

export interface Fluid {
  id: string;
  bucket: string;
  title: string;
  capacity: string;
  specification: string;
}

export interface Spec {
  id: string;
  bucket: string;
  title: string;
  value?: string;
  description?: string;
}

export interface Part {
  partNumber: string;
  description: string;
  manufacturer: string;
  listPrice: number;
  dealerPrice: number;
  category: string;
}

export interface LaborOperation {
  id: string;
  title: string;
  bucket: string;
}

export interface FluidsResponse {
  total: number;
  data: Fluid[];
}

export interface SpecsResponse {
  total: number;
  data: Spec[];
}

export interface PartsResponse {
  total: number; // API might just return array?
  data: Part[];
}

export interface LaborResponse {
  total: number;
  data: LaborOperation[];
}

export interface MaintenanceSchedule {
  id: string;
  description: string;
  interval?: number;
  frequency?: string;
  action: string;
}

export interface MaintenanceResponse {
  data: MaintenanceSchedule[];
}

// Vehicle-related response types
export interface ModelAndVehicleId {
  model: string;
  vehicleId: string;
}

export interface ModelAndVehicleIdListResponse {
  items: ModelAndVehicleId[];
}

export interface GetVehiclesRequest {
  vehicleIds: string[];
}

// Search Results Response
export interface SearchResultsResponse {
  articleDetails: Article[];
  filterTabs: FilterTab[];
  vehicleGeoBlockingDetails?: any;
}

export interface Bucket {
  name: string;
  nameOverride?: string;
  count: number;
  sort: number;
  buckets?: Bucket[]; // Legacy API calls them buckets sometimes
  children?: Bucket[]; // Normalized to children
}

// Normalized structure for View Model
export interface BucketArticles {
  bucketName: string;
  bucketFilterCategory: string;
  articles: Article[];
  sort: number;
  bucketNameOverride?: string;
  bucketFilterTabType?: FilterTabType;
  isParent?: boolean;
  children?: BucketArticles[];
}



// Part Line Item
export interface PartLineItem {
  partNumber: string;
  description: string;
  quantity: number;
}

export interface PartLineItemListResponse {
  items: PartLineItem[];
}

// Bookmark types
export interface ArticleBookmarkResponse {
  bookmarkId: number;
  articleId: string;
  vehicleId: string;
}

// UI Response Types
export interface UiUserSettingsResponse {
  settings: Record<string, any>;
}

export interface FeedbackConfiguration {
  [key: string]: any;
}

export interface FeedbackConfigurationResponse {
  configurations: FeedbackConfiguration[];
}

export interface Feedback {
  message?: string;
  type?: string;
  metadata?: Record<string, any>;
}

// Track Change Types
export interface StringListResponse {
  items: string[];
}

export interface VehicleDeltaReport {
  [key: string]: any;
}

export interface VehicleDeltaReportListResponse {
  items: VehicleDeltaReport[];
}

// Error Logging
export interface LogEntry {
  message?: string;
  level?: string;
  timestamp?: string;
  stackTrace?: string;
  metadata?: Record<string, any>;
}


export interface EmptyResponse {
  [key: string]: any;
}

export interface TutorialStep {
  title: string;
  content: string; // HTML content for this step
  warning?: string; // Optional warning text
  tool?: string;    // Optional tool required for this step
  mediaPlaceholder?: string; // ID of media to show (extracted from original)
}

export interface AuthStatusResponse {
  status: 'success' | 'error' | 'authenticating' | 'idle';
  progress: number;
  message: string;
}