export interface ApiResponse<T> {
  header: {
    status: string;
    statusCode: number;
    date?: string;
    messages?: any[];
  };
  body: T;
}

export interface VinDecodeData {
  vehicleId: string;
  contentSource: string;
  motorVehicleId: string;
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
  count: number;
  type: string;
  buckets?: FilterTab[]; // Support nested buckets
}

export interface ArticlesData {
  articleDetails: Article[];
  filterTabs: FilterTab[];
}

export interface ArticleContentData {
  html: string;
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