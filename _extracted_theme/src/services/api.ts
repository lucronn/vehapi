const BASE_URL = 'https://vehapiproxi.vercel.app';

// --- Interfaces ---
export interface ApiResponse<T> {
  header: { status: string; statusCode: number };
  body: T;
}

export interface Make {
  makeId: number;
  makeName: string;
}

export interface Engine {
  id: string;
  name: string;
}

export interface Model {
  model: string;
  id: string;
  engines?: Engine[];
}

export interface ModelsResponse {
  contentSource: string;
  models: Model[];
}

export interface VinDecodeResult {
  vin: string;
  vehicleId: string;
  contentSource: string;
  year: number;
  make: string;
  model: string;
}

export interface Article {
  id: string;
  title: string;
  code?: string;
  bulletinNumber?: string;
  releaseDate?: string;
  thumbnailHref?: string;
  parentBucket?: string;
  bucket?: string;
}

export interface Bucket {
  name: string;
  articles?: Article[];
  children?: Bucket[];
  count?: number;
}

export interface FilterTab {
  name: string;
  count?: number;
  buckets?: Bucket[];
}

export interface ArticlesResponse {
  articleDetails: Article[];
  filterTabs: FilterTab[];
}

export interface Fluid {
  id: string;
  title: string;
  capacity?: string;
  specification?: string;
}

export interface FluidsResponse {
  total: number;
  data: Fluid[];
}

export interface MaintenanceSchedule {
  id?: string;
  name?: string;
  description?: string;
  items?: any[];
  intervals?: any[];
  [key: string]: any;
}

export interface ArticleContent {
  html: string;
  content?: string;
  id: string;
  title: string;
}

// --- Cache ---
const articleCache: Record<string, ArticlesResponse> = {};

// --- Fetch Wrapper ---
async function apiFetch<T>(path: string): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`API Error ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  // Some endpoints wrap in header/body, some don't
  if (data && data.header && data.body !== undefined) {
    return data.body as T;
  }
  return data as T;
}

// --- API Functions ---
export async function getYears(): Promise<number[]> {
  return apiFetch<number[]>('/api/years');
}

export async function getMakes(year: number): Promise<Make[]> {
  return apiFetch<Make[]>(`/api/year/${year}/makes`);
}

export async function getModels(year: number, makeId: number): Promise<ModelsResponse> {
  return apiFetch<ModelsResponse>(`/api/year/${year}/make/${makeName}/models`);
}

export async function decodeVin(vin: string): Promise<VinDecodeResult> {
  return apiFetch<VinDecodeResult>(`/api/vin/${vin}/vehicle`);
}

export async function getVehicleName(src: string, vid: string): Promise<string> {
  const data = await apiFetch<any>(`/api/source/${src}/${vid}/name`);
  if (typeof data === 'string') return data;
  if (data?.name) return data.name;
  if (data?.vehicleName) return data.vehicleName;
  return String(data);
}

export async function searchArticles(src: string, vid: string): Promise<ArticlesResponse> {
  const cacheKey = `${src}:${vid}`;
  if (articleCache[cacheKey]) return articleCache[cacheKey];
  const data = await apiFetch<ArticlesResponse>(`/api/source/${src}/vehicle/${vid}/articles/v2`);
  articleCache[cacheKey] = data;
  return data;
}

export async function getArticleContent(src: string, vid: string, aid: string): Promise<ArticleContent> {
  return apiFetch<ArticleContent>(`/api/source/${src}/vehicle/${vid}/article/${aid}`);
}

export async function getFluids(src: string, vid: string): Promise<FluidsResponse> {
  return apiFetch<FluidsResponse>(`/api/source/${src}/vehicle/${vid}/fluids`);
}

export async function getMaintenanceByFrequency(src: string, vid: string): Promise<any> {
  return apiFetch<any>(`/api/source/${src}/vehicle/${vid}/maintenanceSchedules/frequency`);
}

export async function getMaintenanceByIntervals(src: string, vid: string, type: string): Promise<any> {
  return apiFetch<any>(`/api/source/${src}/vehicle/${vid}/maintenanceSchedules/intervals?intervalType=${type}`);
}

export function getGraphicUrl(src: string, id: string): string {
  return `${BASE_URL}/api/source/${src}/graphic/${id}`;
}

export function getBaseUrl(): string {
  return BASE_URL;
}

// --- Article Filtering Helpers ---
export function getArticlesFromTab(articlesData: ArticlesResponse | null, tabName: string): Article[] {
  if (!articlesData?.filterTabs) return [];
  const tab = articlesData.filterTabs.find(
    t => t.name?.toLowerCase().includes(tabName.toLowerCase())
  );
  if (!tab?.buckets) return [];
  const articles: Article[] = [];
  const collectArticles = (buckets: Bucket[]) => {
    for (const bucket of buckets) {
      if (bucket.articles) articles.push(...bucket.articles);
      if (bucket.children) collectArticles(bucket.children);
    }
  };
  collectArticles(tab.buckets);
  return articles;
}

export function getArticlesGroupedByBucket(articlesData: ArticlesResponse | null, tabName: string): Record<string, Article[]> {
  if (!articlesData?.filterTabs) return {};
  const tab = articlesData.filterTabs.find(
    t => t.name?.toLowerCase().includes(tabName.toLowerCase())
  );
  if (!tab?.buckets) return {};
  const groups: Record<string, Article[]> = {};
  const collectFromBucket = (bucket: Bucket, parentName?: string) => {
    const groupName = parentName || bucket.name || 'Other';
    if (bucket.articles?.length) {
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(...bucket.articles);
    }
    if (bucket.children) {
      for (const child of bucket.children) {
        collectFromBucket(child, bucket.name || parentName);
      }
    }
  };
  for (const bucket of tab.buckets) {
    collectFromBucket(bucket);
  }
  return groups;
}

// Process HTML content from articles
export function processArticleHtml(html: string, src: string): string {
  if (!html) return '';
  let processed = html;
  // Fix relative API URLs
  processed = processed.replace(/src="\/api\//g, `src="${BASE_URL}/api/`);
  processed = processed.replace(/href="\/api\//g, `href="${BASE_URL}/api/`);
  // Fix relative graphic paths
  processed = processed.replace(/src="\.\.\/graphic\//g, `src="${BASE_URL}/api/source/${src}/graphic/`);
  // Convert mtr-image tags
  processed = processed.replace(/<mtr-image\s+id="([^"]+)"[^>]*>/g, 
    `<img src="${BASE_URL}/api/source/${src}/graphic/$1" class="max-w-full rounded-xl border border-white/10" />`
  );
  processed = processed.replace(/<\/mtr-image>/g, '');
  // Convert mtr-doc-link tags
  processed = processed.replace(/<mtr-doc-link\s+id="([^"]+)"[^>]*>(.*?)<\/mtr-doc-link>/g,
    `<a href="#article:$1" class="text-cyan-400 hover:underline cursor-pointer" data-article-id="$1">$2</a>`
  );
  return processed;
}

export function clearArticleCache() {
  Object.keys(articleCache).forEach(key => delete articleCache[key]);
}
