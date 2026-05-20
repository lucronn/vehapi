import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, of, tap, catchError, timeout, switchMap } from 'rxjs';
import { normalizeYearList } from '../utils/year-list';
import { OrientationOption } from '../components/orientation-selector-modal/orientation-selector-modal.component';
import {
  ApiResponse,
  ArticlesData,
  Make,
  ModelsData,
  VinDecodeData,
  ArticleContentData,
  LaborResponseOpenApi,
  FluidsResponse,
  PartsResponse,
  StringResponse,
  MaintenanceSchedulesByFrequencyResponse,
  MaintenanceSchedulesByIntervalResponse,
  SearchResultsResponse,
  PartLineItemListResponse,
  IntervalType,
  MaintenanceScheduleSeverity,
  AuthStatusResponse
} from '../models/motor.models';
import { parsePrice } from '../utils/price-parser';
import { getMotorProxyBaseUrl } from '../utils/motor-api.constants';
import { environment } from '../environments/environment';

/** L1 citation bundle (POST /api/vehicle/:id/l2/search). */
export interface L2SearchCitation {
  content_item_id: string;
  motor_article_id: string;
  canonical_silo_code: string | null;
  content_source: string | null;
  chunk_id: string;
  chunk_index: number;
}

/** L2 RAG chunk row from vector search */
export interface L2SearchChunk {
  text: string;
  content_item_id: string;
  score: number;
  citation: L2SearchCitation;
}

export interface L2SearchResponse {
  chunks: L2SearchChunk[];
  /** Set when search succeeds but returns no rows, or on errors (see vehapiproxi handleL2VehicleSearch). */
  code?: string;
  hint?: string;
}

@Injectable({ providedIn: 'root' })
export class MotorApiService {
  private http = inject(HttpClient);
  // public readonly baseUrl = 'https://motorapiauthproxy-yonqvhjh7a-uc.a.run.app';
  public readonly baseUrl = getMotorProxyBaseUrl();

  // Cache for article searches to prevent redundant API calls
  private articleCache = new Map<string, ApiResponse<ArticlesData>>();

  /**
   * When `motorVehicleId` is present, route like `/articles/v2` (MOTOR shard + composite id).
   * Avoids upstream 5xx on parts / maintenance when OEM base id is used without the composite Motor id.
   */
  private motorVehicleRoute(
    contentSource: string,
    vehicleId: string,
    motorVehicleId?: string
  ): { source: string; id: string } {
    if (motorVehicleId) {
      return { source: 'MOTOR', id: motorVehicleId };
    }
    return { source: contentSource, id: vehicleId };
  }

  /**
   * Verbose logging helper for API requests
   */
  private logRequest(method: string, url: string, params?: any, body?: any): void {
    if (environment.production) return;
    const timestamp = new Date().toISOString();
    console.group(`[API REQUEST] ${method} ${timestamp}`);
    console.log('📍 Frontend → Proxy');
    console.log(`   URL: ${url}`);
    console.log(`   Method: ${method}`);
    if (params) {
      console.log(`   Params:`, params);
    }
    if (body) {
      console.log(`   Body:`, body);
    }
    console.log(`   API base (vehapiproxi only): ${this.baseUrl}`);
    console.groupEnd();
  }

  /**
   * Verbose logging helper for API responses
   */
  private logResponse(url: string, status: number, statusText: string, headers: any, bodySize?: number, duration?: number): void {
    if (environment.production) return;
    const timestamp = new Date().toISOString();
    console.group(`[API RESPONSE] ${timestamp}`);
    console.log('📍 Proxy → Frontend');
    console.log(`   URL: ${url}`);
    console.log(`   Status: ${status} ${statusText}`);
    console.log(`   Headers:`, headers);
    if (bodySize !== undefined) {
      console.log(`   Response Size: ${bodySize} bytes`);
    }
    if (duration !== undefined) {
      console.log(`   Duration: ${duration}ms`);
    }
    console.groupEnd();
  }

  /**
   * Verbose logging helper for API errors
   */
  private logApiError(url: string, error: any, duration?: number): void {
    // Suppress AbortError from Angular switchMap / HTTP client cancellation
    const isAbortError =
      error?.name === 'AbortError' ||
      (error?.name === 'HttpErrorResponse' && error?.error?.name === 'AbortError');
    if (isAbortError) {
      if (!environment.production) {
        console.log(`[API REQUEST CANCELLED] Frontend intentionally cancelled HTTP request to ${url} ( likely due to fast route navigation )`);
      }
      return;
    }

    if (environment.production) return;
    const timestamp = new Date().toISOString();
    console.group(`[API ERROR] ${timestamp}`);
    console.error('❌ Request Failed');
    console.log(`   URL: ${url}`);
    console.log(`   Error:`, error);
    if (error.status) {
      console.log(`   Status: ${error.status} ${error.statusText}`);
    }
    if (error.message) {
      console.log(`   Message: ${error.message}`);
    }
    if (error.error) {
      console.log(`   Error Body:`, error.error);
    }
    if (duration !== undefined) {
      console.log(`   Duration: ${duration}ms`);
    }
    console.log(`   Flow: Frontend → vehapiproxi (upstream not called from browser)`);
    console.groupEnd();
  }

  /**
   * Wrapper for HTTP GET requests with verbose logging
   */
  private getWithLogging<T>(url: string, params?: HttpParams | { [param: string]: string | number | boolean | readonly (string | number | boolean)[] }): Observable<T> {
    const startTime = performance.now();
    this.logRequest('GET', url, params);

    return this.http.get<T>(url, { params, observe: 'response', withCredentials: true }).pipe(
      tap(response => {
        const duration = Math.round(performance.now() - startTime);
        const bodySize = response.body ? JSON.stringify(response.body).length : 0;
        this.logResponse(
          url,
          response.status,
          response.statusText,
          Object.fromEntries(response.headers.keys().map(key => [key, response.headers.get(key)])),
          bodySize,
          duration
        );
      }),
      map(response => {
        const body = response.body as any;
        // Enrich body with cache headers if present
        if (body && body.header) {
          const dataSource = response.headers.get('x-data-source');
          const isCached = response.headers.get('x-cache-hit') === 'true';
          if (dataSource) body.header.dataSource = dataSource;
          if (isCached) body.header.isCached = isCached;
        }
        return body as T;
      }),
      catchError(error => {
        const duration = Math.round(performance.now() - startTime);
        this.logApiError(url, error, duration);
        throw error;
      })
    );
  }

  decodeVin(vin: string): Observable<ApiResponse<VinDecodeData>> {
    // Fixed endpoint to match OpenAPI spec: /api/vin/{vin}/vehicle
    const url = `${this.baseUrl}/api/vin/${vin}/vehicle`;
    return this.getWithLogging<ApiResponse<VinDecodeData>>(url);
  }

  /** DB-first; falls back to live Motor on any error (network, 404, etc.). */
  private dbFirst<T>(dbUrl: string, liveUrl: string): Observable<ApiResponse<T>> {
    return this.getWithLogging<ApiResponse<T>>(dbUrl).pipe(
      catchError(() => this.getWithLogging<ApiResponse<T>>(liveUrl))
    );
  }

  getYears(): Observable<ApiResponse<number[]>> {
    const dbUrl = `${this.baseUrl}/api/db/years`;
    const liveUrl = `${this.baseUrl}/api/years`;
    return this.getWithLogging<ApiResponse<number[]>>(dbUrl).pipe(
      switchMap((res) => {
        const body = normalizeYearList(res?.body);
        if (body.length > 0) {
          return of({ ...res, body });
        }
        return this.getWithLogging<ApiResponse<number[]>>(liveUrl).pipe(
          map((live) => ({ ...live, body: normalizeYearList(live?.body) }))
        );
      }),
      catchError(() =>
        this.getWithLogging<ApiResponse<number[]>>(liveUrl).pipe(
          map((live) => ({ ...live, body: normalizeYearList(live?.body) }))
        )
      )
    );
  }

  getMakes(year: number): Observable<ApiResponse<Make[]>> {
    return this.dbFirst<Make[]>(
      `${this.baseUrl}/api/db/year/${year}/makes`,
      `${this.baseUrl}/api/year/${year}/makes`
    );
  }

  getModels(year: number, make: string | number): Observable<ApiResponse<ModelsData>> {
    return this.dbFirst<ModelsData>(
      `${this.baseUrl}/api/db/year/${year}/make/${make}/models`,
      `${this.baseUrl}/api/year/${year}/make/${make}/models`
    );
  }

  getMotorVehicles(contentSource: string, vehicleId: string): Observable<ApiResponse<any[]>> {
    const url = `${this.baseUrl}/api/source/${contentSource}/${vehicleId}/motorvehicles`;
    return this.getWithLogging<ApiResponse<any[]>>(url);
  }

  getVehicleName(contentSource: string, vehicleId: string): Observable<ApiResponse<string>> {
    const url = `${this.baseUrl}/api/source/${contentSource}/${vehicleId}/name`;
    return this.getWithLogging<ApiResponse<string>>(url).pipe(
      map(res => {
        // Proxy sometimes returns empty strings, 500s or incomplete objects.
        // Ensure we never return "undefined undefined" parsing by providing an explicit string map.
        if (!res || !res.body) {
          return { ...res, body: 'Unknown Vehicle' } as ApiResponse<string>;
        }
        // In an edge case where the name comes back literally as undefined undefined
        if (typeof res.body === 'string' && (res.body.includes('undefined undefined') || res.body.trim() === '')) {
          return { ...res, body: 'Unknown Vehicle' } as ApiResponse<string>;
        }
        return res;
      })
    );
  }

  /**
   * @param options.catalogSync — bypass proxy Supabase article cache; use when ingesting full catalog into DB
   *   (`torqueCatalogSync=1`). Required so partial rows in `articles` do not block the full Motor payload.
   */
  searchArticles(
    contentSource: string,
    vehicleId: string,
    searchTerm: string = '',
    motorVehicleId?: string,
    options?: { catalogSync?: boolean }
  ): Observable<ApiResponse<ArticlesData>> {
    const catalogSync = options?.catalogSync === true;
    const route = this.motorVehicleRoute(contentSource, vehicleId, motorVehicleId);
    // Generate a unique cache key (must include shard + id used for the request)
    const cacheKey = `${route.source}:${route.id}:${searchTerm.trim() || 'ALL'}${catalogSync ? ':SYNC' : ''}`;

    // Return cached data if available (never use stale client cache for catalog ingest)
    if (!catalogSync && this.articleCache.has(cacheKey)) {
      if (!environment.production) {
        console.log(`[API CACHE HIT] searchArticles: ${cacheKey}`);
      }
      return of(this.articleCache.get(cacheKey)!);
    }

    const liveUrl = `${this.baseUrl}/api/source/${route.source}/vehicle/${route.id}/articles/v2`;
    const params: Record<string, string> = {};
    if (searchTerm) params.searchTerm = searchTerm;
    if (catalogSync) params.torqueCatalogSync = '1';

    const startTime = performance.now();
    this.logRequest('GET', liveUrl, params);

    // DB-first when no search term and not in catalog-sync mode: instant if
    // the vehicle's catalog is already ingested, falls back to live otherwise.
    const useDb = !searchTerm && !catalogSync;
    const dbUrl = `${this.baseUrl}/api/db/articles`;
    const primary$ = useDb
      ? this.getWithLogging<ApiResponse<ArticlesData>>(dbUrl, { vehicleId: route.id }).pipe(
          catchError(() => this.getWithLogging<ApiResponse<ArticlesData>>(liveUrl, params))
        )
      : this.getWithLogging<ApiResponse<ArticlesData>>(liveUrl, params);

    return primary$.pipe(
      map(data => {
        if (data.header.statusCode === 200 && !catalogSync) {
          this.articleCache.set(cacheKey, data);
          if (!environment.production) {
            console.log(`[API CACHE SET] searchArticles: ${cacheKey}`);
          }
        }
        return data;
      })
    );
  }

  // Specific Data Endpoints

  getArticleOrientations(
    contentSource: string,
    vehicleId: string,
    articleId: string
  ): Observable<ApiResponse<{ orientations: OrientationOption[], total: number }>> {
    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/article/${articleId}/orientations`;
    this.logRequest('GET', url);
    return this.getWithLogging<ApiResponse<{ orientations: OrientationOption[], total: number }>>(url);
  }

  /**
   * Fluids: M1 proxy by default. When backend has Motor Information API keys, pass `baseVehicleId` + `engineId`
   * (from `/api/motor-information/ymme/*`) to use `api.motor.com` RecommendedFluids — see `vehapiproxi/MOTOR_INFORMATION_API.md`.
   */
  getFluids(
    contentSource: string,
    vehicleId: string,
    motorInformation?: { baseVehicleId?: string; engineId?: string }
  ): Observable<ApiResponse<FluidsResponse>> {
    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/fluids`;
    const q: Record<string, string> = {};
    if (motorInformation?.baseVehicleId) q['baseVehicleId'] = motorInformation.baseVehicleId;
    if (motorInformation?.engineId) q['engineId'] = motorInformation.engineId;
    return this.getWithLogging<ApiResponse<FluidsResponse>>(
      url,
      Object.keys(q).length ? q : undefined
    );
  }

  /**
   * Motor Information YMME — `api.motor.com` BaseVehicleID (Bearer JWT via auth interceptor).
   */
  getMotorInformationBaseVehicle(
    year: number,
    make: string,
    model: string
  ): Observable<{ baseVehicleId: number; year: number; make: string; model: string }> {
    const url = `${this.baseUrl}/api/motor-information/ymme/base-vehicle`;
    return this.getWithLogging<{ baseVehicleId: number; year: number; make: string; model: string }>(url, {
      year: String(year),
      make,
      model
    });
  }

  // Backward compatible method - kept for existing code
  getParts(
    contentSource: string,
    vehicleId: string,
    searchTerm: string = '',
    motorVehicleId?: string
  ): Observable<ApiResponse<PartsResponse>> {
    // Use the new method and map response
    return this.getPartsForVehicle(contentSource, vehicleId, motorVehicleId, searchTerm).pipe(
      map(response => {
        // Fix: API returns body as array directly, not { items: [] }
        // Also map partDescription -> description and price -> listPrice
        const bodyAny = response.body as any;
        const rawItems = Array.isArray(bodyAny) ? bodyAny : (bodyAny?.items || []);

        return {
          ...response,
          body: {
            total: rawItems.length,
            data: rawItems.map((item: any) => ({
              partNumber: item.partNumber,
              description: item.partDescription || item.description || '',
              manufacturer: item.manufacturer || '',
              listPrice: parsePrice(item.price),
              dealerPrice: 0,
              category: ''
            }))
          } as PartsResponse
        };
      })
    );
  }

  // Backward compatible method
  getMaintenanceByFrequency(
    contentSource: string,
    vehicleId: string
  ): Observable<ApiResponse<any>>;
  // Full OpenAPI method
  getMaintenanceByFrequency(
    contentSource: string,
    vehicleId: string,
    frequencyTypeCode?: string,
    severity?: MaintenanceScheduleSeverity,
    searchTerm?: string,
    motorVehicleId?: string
  ): Observable<ApiResponse<MaintenanceSchedulesByFrequencyResponse>>;
  // Implementation
  getMaintenanceByFrequency(
    contentSource: string,
    vehicleId: string,
    frequencyTypeCode?: string,
    severity?: MaintenanceScheduleSeverity,
    searchTerm?: string,
    motorVehicleId?: string
  ): Observable<ApiResponse<MaintenanceSchedulesByFrequencyResponse | any>> {
    const route = this.motorVehicleRoute(contentSource, vehicleId, motorVehicleId);
    let params: any = {};
    if (frequencyTypeCode) params.frequencyTypeCode = frequencyTypeCode;
    if (severity) params.severity = severity;
    params.searchTerm = searchTerm ?? '';

    const url = `${this.baseUrl}/api/source/${route.source}/vehicle/${route.id}/maintenanceSchedules/frequency`;
    return this.getWithLogging<ApiResponse<MaintenanceSchedulesByFrequencyResponse>>(url, params);
  }

  // Backward compatible overload for existing code
  getMaintenanceByIntervals(
    contentSource: string,
    vehicleId: string,
    intervalType: 'Miles' | 'Kilometers' | 'Months' | 'miles' | 'months',
    interval?: number,
    severity?: MaintenanceScheduleSeverity,
    searchTerm?: string,
    motorVehicleId?: string
  ): Observable<ApiResponse<any>>;
  // Full OpenAPI method
  getMaintenanceByIntervals(
    contentSource: string,
    vehicleId: string,
    intervalType?: IntervalType,
    interval?: number,
    severity?: MaintenanceScheduleSeverity,
    searchTerm?: string,
    motorVehicleId?: string
  ): Observable<ApiResponse<MaintenanceSchedulesByIntervalResponse>>;
  // Implementation
  getMaintenanceByIntervals(
    contentSource: string,
    vehicleId: string,
    intervalType?: IntervalType | 'miles' | 'months',
    interval?: number,
    severity?: MaintenanceScheduleSeverity,
    searchTerm?: string,
    motorVehicleId?: string
  ): Observable<ApiResponse<MaintenanceSchedulesByIntervalResponse | any>> {
    const route = this.motorVehicleRoute(contentSource, vehicleId, motorVehicleId);
    let params: any = {};
    // Normalize intervalType to match OpenAPI enum
    const normalizedIntervalType = intervalType === 'miles' ? 'Miles' :
      intervalType === 'months' ? 'Months' :
        intervalType as IntervalType;
    if (normalizedIntervalType) params.intervalType = normalizedIntervalType;
    if (interval !== undefined) params.interval = interval.toString();
    if (severity) params.severity = severity;
    params.searchTerm = searchTerm ?? '';

    const url = `${this.baseUrl}/api/source/${route.source}/vehicle/${route.id}/maintenanceSchedules/intervals`;
    return this.getWithLogging<ApiResponse<MaintenanceSchedulesByIntervalResponse>>(url, params);
  }

  getArticleContent(contentSource: string, vehicleId: string, articleId: string, motorVehicleId?: string): Observable<ApiResponse<ArticleContentData>> {
    // Motor shards by contentSource (e.g. GeneralMotors vs MOTOR). Only remap to MOTOR when the
    // caller is already on the MOTOR shard (legacy composite engine id flows). For OEM sources,
    // keep contentSource and pass motorVehicleId as a query param per upstream API.
    const csNorm = (contentSource || 'MOTOR').toUpperCase();
    let effectiveSource = contentSource;
    let effectiveId = vehicleId;
    let params: { motorVehicleId?: string } | undefined;
    if (motorVehicleId) {
      if (csNorm === 'MOTOR') {
        effectiveSource = 'MOTOR';
        effectiveId = motorVehicleId;
      } else {
        effectiveSource = contentSource;
        effectiveId = vehicleId;
        params = { motorVehicleId };
      }
    }
    const url = `${this.baseUrl}/api/source/${effectiveSource}/vehicle/${effectiveId}/article/${articleId}`;
    return this.getWithLogging<ApiResponse<ArticleContentData>>(url, params).pipe(
      map(res => {
        // Normalize content fields to 'html' for components
        if (res && res.body && !res.body.html) {
          const body = res.body as any;

          // Check for standard HTML fields first
          if (body.content) {
            res.body.html = body.content;
          } else if (body.html_content) {
            res.body.html = body.html_content;
          } else if (body.pdf) {
            // Handle PDF content - store as data URI for inline viewing
            const pdfContent = body.pdf;
            if (typeof pdfContent === 'string') {
              const cleanBase64 = pdfContent.replace(/\s/g, '');
              const isBase64Pdf = cleanBase64.startsWith('JVBERi') ||
                cleanBase64.startsWith('data:application/pdf;base64,');

              if (isBase64Pdf) {
                const dataUri = cleanBase64.startsWith('data:')
                  ? cleanBase64
                  : `data:application/pdf;base64,${cleanBase64}`;
                res.body.pdfDataUri = dataUri;
                res.body.html = ''; // No HTML content - viewer handles it
              } else if (pdfContent.startsWith('<')) {
                res.body.html = pdfContent;
              } else {
                res.body.html = pdfContent;
              }
            }
          }

          // Final fallback
          if (!res.body.html) {
            res.body.html = '';
          }
        }
        return res;
      })
    );
  }




  getArticleMetadata(contentSource: string, vehicleId: string, articleId: string): Observable<{ bucket: string; parent_bucket: string; moduleType: string | null }> {
    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/article/${articleId}/metadata`;
    return this.getWithLogging<{ bucket: string; parent_bucket: string; moduleType: string | null }>(url);
  }

  getArticleTitle(contentSource: string, vehicleId: string, articleId: string): Observable<ApiResponse<string>> {
    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/article/${articleId}/title`;
    return this.getWithLogging<ApiResponse<StringResponse>>(url).pipe(
      map(body => {
        return {
          ...body,
          body: body.body.value
        } as ApiResponse<string>;
      })
    );
  }

  /**
   * Get labor details by ID with full parameters
   * @param contentSource Content source identifier
   * @param vehicleId Vehicle ID
   * @param articleId Article ID
   * @param motorVehicleId Optional Motor vehicle ID
   * @param prettyPrint Optional pretty print flag
   * @param searchTerm Optional search term
   * @returns Observable of LaborResponseOpenApi
   */
  getLaborDetails(
    contentSource: string,
    vehicleId: string,
    articleId: string,
    motorVehicleId?: string,
    prettyPrint?: boolean,
    searchTerm?: string
  ): Observable<ApiResponse<LaborResponseOpenApi>> {
    let params: any = {};
    if (motorVehicleId) params.motorVehicleId = motorVehicleId;
    if (prettyPrint !== undefined) params.prettyPrint = prettyPrint.toString();
    if (searchTerm) params.searchTerm = searchTerm;

    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/labor/${articleId}`;
    return this.getWithLogging<ApiResponse<LaborResponseOpenApi>>(url, params);
  }

  // ==========================================
  // SEARCH ENDPOINTS
  // ==========================================

  /**
   * Get search results by vehicle ID (v2 endpoint)
   * @param contentSource Content source identifier
   * @param vehicleId Vehicle ID
   * @param searchTerm Optional search term
   * @param motorVehicleId Optional Motor vehicle ID
   * @returns Observable of SearchResultsResponse
   */
  getSearchResultsByVehicleId(
    contentSource: string,
    vehicleId: string,
    searchTerm?: string,
    motorVehicleId?: string
  ): Observable<ApiResponse<SearchResultsResponse>> {
    let params = new HttpParams();
    if (searchTerm) params = params.set('searchTerm', searchTerm);

    const route = this.motorVehicleRoute(contentSource, vehicleId, motorVehicleId);
    const url = `${this.baseUrl}/api/source/${route.source}/vehicle/${route.id}/articles/v2`;
    return this.getWithLogging<ApiResponse<SearchResultsResponse>>(url, params);
  }

  // ==========================================
  // PARTS ENDPOINTS
  // ==========================================

  /**
   * Get parts for vehicle (updated to match OpenAPI spec)
   * @param contentSource Content source identifier
   * @param vehicleId Vehicle ID
   * @param motorVehicleId Optional Motor vehicle ID
   * @param searchTerm Optional search term
   * @returns Observable of PartLineItemListResponse
   */
  getPartsForVehicle(
    contentSource: string,
    vehicleId: string,
    motorVehicleId?: string,
    searchTerm?: string
  ): Observable<ApiResponse<PartLineItemListResponse>> {
    const route = this.motorVehicleRoute(contentSource, vehicleId, motorVehicleId);
    let params = new HttpParams().set('searchTerm', searchTerm ?? '');
    // OEM base id + motorVehicleId query (when not already using MOTOR path above)
    if (motorVehicleId && route.source !== 'MOTOR') {
      params = params.set('motorVehicleId', motorVehicleId);
    }

    return this.http.get<ApiResponse<PartLineItemListResponse>>(
      `${this.baseUrl}/api/source/${route.source}/vehicle/${route.id}/parts`,
      { params, withCredentials: true }
    );
  }

  // ==========================================
  // AUTH ENDPOINTS
  // ==========================================

  /**
   * Get authentication status
   * Used for polling when auth is in progress
   * @returns Observable of AuthStatusResponse
   */
  getAuthStatus(): Observable<AuthStatusResponse> {
    // Note: This endpoint might return 401/403 if not authenticated, which is expected during auth
    // We bypass the global error handling/logging for this specific call to avoid noise
    return this.http.get<AuthStatusResponse>(`${this.baseUrl}/auth/status`, { withCredentials: true }).pipe(
      timeout(5000),
      catchError(error => {
        const isAbortLike =
          error?.name === 'AbortError' ||
          error?.status === 0 ||
          `${error?.message || ''}`.includes('aborted');
        if (!environment.production && !isAbortLike) {
          console.error('[Auth Polling] Failed:', error);
        }
        // If we can't reach the status endpoint, assume error
        return of({ status: 'error' as const, progress: 0, message: error.message || 'Connection failed' });
      })
    );
  }

  /**
   * L2 vector search (requires Supabase RPC + embeddings; backend enforces unlocks).
   */
  l2Search(vehicleExternalId: string, query: string, matchCount = 8): Observable<L2SearchResponse> {
    const enc = encodeURIComponent(vehicleExternalId);
    const url = `${this.baseUrl}/api/vehicle/${enc}/l2/search`;
    this.logRequest('POST', url, undefined, { matchCount });
    return this.http.post<L2SearchResponse>(url, { query, matchCount }, { withCredentials: true });
  }
}
