import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpRequest, HttpEvent } from '@angular/common/http';
import { Observable, map, of, tap, catchError, timeout } from 'rxjs';
import { OrientationOption } from '../components/orientation-selector-modal/orientation-selector-modal.component';
import {
  ApiResponse,
  ArticlesData,
  Make,
  ModelsData,
  VinDecodeData,
  ArticleContentData,
  ArticleResponse,
  LaborResponseOpenApi,
  DtcsResponse,
  TsbsResponse,
  WiringDiagramsResponse,
  ComponentLocationsResponse,
  DiagramsResponse,
  ProceduresResponse,
  CategoriesResponse,
  FluidsResponse,
  SpecsResponse,
  PartsResponse,
  LaborResponse,
  StringResponse,
  MaintenanceSchedulesByFrequencyResponse,
  MaintenanceSchedulesByIntervalResponse,
  IndicatorsWithMaintenanceSchedulesResponse,
  ModelAndVehicleIdListResponse,
  GetVehiclesRequest,
  SearchResultsResponse,
  PartLineItemListResponse,
  ArticleBookmarkResponse,
  UiUserSettingsResponse,
  FeedbackConfigurationResponse,
  Feedback,
  StringListResponse,
  VehicleDeltaReportListResponse,
  LogEntry,
  EmptyResponse,
  IntervalType,
  MaintenanceScheduleSeverity,
  ContentSource,
  AuthStatusResponse
} from '../models/motor.models';
import { parsePrice } from '../utils/price-parser';
import { MOTOR_API_BASE_URL } from '../utils/motor-api.constants';
import { MotorHtmlProcessorService } from './motor-html-processor.service';
import { environment } from '../environments/environment';

/** L2 RAG chunk row from POST /api/l2/search */
export interface L2SearchChunk {
  chunkId: string;
  contentItemId: string;
  motorArticleId: string;
  canonicalSiloCode: string | null;
  contentSource: string | null;
  chunkIndex: number;
  text: string;
  score: number;
}

export interface L2SearchResponse {
  chunks: L2SearchChunk[];
}

@Injectable({ providedIn: 'root' })
export class MotorApiService {
  private http = inject(HttpClient);
  private motorHtml = inject(MotorHtmlProcessorService);
  // public readonly baseUrl = 'https://motorapiauthproxy-yonqvhjh7a-uc.a.run.app';
  public readonly baseUrl = MOTOR_API_BASE_URL;

  // Cache for article searches to prevent redundant API calls
  private articleCache = new Map<string, ApiResponse<ArticlesData>>();

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

  getYears(): Observable<ApiResponse<number[]>> {
    const url = `${this.baseUrl}/api/years`;
    return this.getWithLogging<ApiResponse<number[]>>(url);
  }

  getMakes(year: number): Observable<ApiResponse<Make[]>> {
    const url = `${this.baseUrl}/api/year/${year}/makes`;
    return this.getWithLogging<ApiResponse<Make[]>>(url);
  }

  getModels(year: number, make: string | number): Observable<ApiResponse<ModelsData>> {
    const url = `${this.baseUrl}/api/year/${year}/make/${make}/models`;
    return this.getWithLogging<ApiResponse<ModelsData>>(url);
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

  searchArticles(contentSource: string, vehicleId: string, searchTerm: string = ''): Observable<ApiResponse<ArticlesData>> {
    // Generate a unique cache key
    const cacheKey = `${contentSource}:${vehicleId}:${searchTerm.trim() || 'ALL'}`;

    // Return cached data if available
    if (this.articleCache.has(cacheKey)) {
      if (!environment.production) {
        console.log(`[API CACHE HIT] searchArticles: ${cacheKey}`);
      }
      return of(this.articleCache.get(cacheKey)!);
    }

    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/articles/v2`;
    const params: any = {};
    if (searchTerm) params.searchTerm = searchTerm;

    const startTime = performance.now();
    this.logRequest('GET', url, params);

    return this.getWithLogging<ApiResponse<ArticlesData>>(url, params).pipe(
      map(data => {
        // Cache the successful response
        if (data.header.statusCode === 200) {
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

  getFluids(contentSource: string, vehicleId: string): Observable<ApiResponse<FluidsResponse>> {
    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/fluids`;
    return this.getWithLogging<ApiResponse<FluidsResponse>>(url);
  }

  // Backward compatible method - kept for existing code
  getParts(contentSource: string, vehicleId: string, searchTerm: string = ''): Observable<ApiResponse<PartsResponse>> {
    const params = searchTerm ? { searchTerm } : {};
    // Use the new method and map response
    return this.getPartsForVehicle(contentSource, vehicleId, undefined, searchTerm).pipe(
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

  getArticleLabor(contentSource: string, vehicleId: string, articleId: string, motorVehicleId?: string): Observable<ApiResponse<LaborResponse>> {
    const params: any = {};
    if (motorVehicleId) params.motorVehicleId = motorVehicleId;
    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/labor/${articleId}`;
    return this.getWithLogging<ApiResponse<LaborResponse>>(url, params);
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
    searchTerm?: string
  ): Observable<ApiResponse<MaintenanceSchedulesByFrequencyResponse>>;
  // Implementation
  getMaintenanceByFrequency(
    contentSource: string,
    vehicleId: string,
    frequencyTypeCode?: string,
    severity?: MaintenanceScheduleSeverity,
    searchTerm?: string
  ): Observable<ApiResponse<MaintenanceSchedulesByFrequencyResponse | any>> {
    let params: any = {};
    if (frequencyTypeCode) params.frequencyTypeCode = frequencyTypeCode;
    if (severity) params.severity = severity;
    if (searchTerm) params.searchTerm = searchTerm;

    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/maintenanceSchedules/frequency`;
    return this.getWithLogging<ApiResponse<MaintenanceSchedulesByFrequencyResponse>>(url, params);
  }

  // Backward compatible overload for existing code
  getMaintenanceByIntervals(
    contentSource: string,
    vehicleId: string,
    intervalType: 'Miles' | 'Kilometers' | 'Months' | 'miles' | 'months',
    interval?: number,
    severity?: MaintenanceScheduleSeverity,
    searchTerm?: string
  ): Observable<ApiResponse<any>>;
  // Full OpenAPI method
  getMaintenanceByIntervals(
    contentSource: string,
    vehicleId: string,
    intervalType?: IntervalType,
    interval?: number,
    severity?: MaintenanceScheduleSeverity,
    searchTerm?: string
  ): Observable<ApiResponse<MaintenanceSchedulesByIntervalResponse>>;
  // Implementation
  getMaintenanceByIntervals(
    contentSource: string,
    vehicleId: string,
    intervalType?: IntervalType | 'miles' | 'months',
    interval?: number,
    severity?: MaintenanceScheduleSeverity,
    searchTerm?: string
  ): Observable<ApiResponse<MaintenanceSchedulesByIntervalResponse | any>> {
    let params: any = {};
    // Normalize intervalType to match OpenAPI enum
    const normalizedIntervalType = intervalType === 'miles' ? 'Miles' :
      intervalType === 'months' ? 'Months' :
        intervalType as IntervalType;
    if (normalizedIntervalType) params.intervalType = normalizedIntervalType;
    if (interval !== undefined) params.interval = interval.toString();
    if (severity) params.severity = severity;
    if (searchTerm) params.searchTerm = searchTerm;

    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/maintenanceSchedules/intervals`;
    return this.getWithLogging<ApiResponse<MaintenanceSchedulesByIntervalResponse>>(url, params);
  }

  getIndicatorsWithMaintenanceSchedules(
    contentSource: string,
    vehicleId: string,
    severity?: MaintenanceScheduleSeverity,
    searchTerm?: string
  ): Observable<ApiResponse<IndicatorsWithMaintenanceSchedulesResponse>> {
    let params: any = {};
    if (severity) params.severity = severity;
    if (searchTerm) params.searchTerm = searchTerm;

    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/maintenanceSchedules/indicators`;
    return this.getWithLogging<ApiResponse<IndicatorsWithMaintenanceSchedulesResponse>>(url, params);
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




  getArticleXml(contentSource: string, articleId: string): Observable<string> {
    const url = `${this.baseUrl}/api/source/${contentSource}/xml/${articleId}`;
    return this.http.get(url, { responseType: 'text', withCredentials: true });
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

  getGraphicUrl(graphicPath: string): string {
    if (!graphicPath) return '';
    // If already a full URL, return as is
    if (graphicPath.startsWith('http://') || graphicPath.startsWith('https://')) {
      return graphicPath;
    }
    // If it starts with /api/, use it directly
    if (graphicPath.startsWith('/api/') || graphicPath.startsWith('api/')) {
      const cleanPath = graphicPath.startsWith('/') ? graphicPath : `/${graphicPath}`;
      return `${this.baseUrl}${cleanPath}`;
    }
    // If it's an absolute path starting with /
    if (graphicPath.startsWith('/')) {
      return `${this.baseUrl}${graphicPath}`;
    }
    // Otherwise, treat as relative and prepend baseUrl with /
    return `${this.baseUrl}/${graphicPath}`;
  }

  processHtmlContent(html: string, contentSource?: string, vehicleId?: string): string {
    return this.motorHtml.processHtmlContent(html, contentSource, vehicleId);
  }

  // ==========================================
  // ASSET ENDPOINTS
  // ==========================================

  /**
   * Get graphic/image by ID and content source
   * @param contentSource Content source identifier
   * @param id Graphic/image ID
   * @param width Optional width parameter
   * @param height Optional height parameter
   * @returns Observable of image blob
   */
  getGraphic(contentSource: string, id: string, width?: number, height?: number): Observable<Blob> {
    let params = new HttpParams();
    if (width) params = params.set('w', width.toString());
    if (height) params = params.set('h', height.toString());

    return this.http.get(
      `${this.baseUrl}/api/source/${contentSource}/graphic/${id}`,
      { params, responseType: 'blob', withCredentials: true }
    );
  }

  /**
   * Get graphic (backwards compatible route)
   * @param manufacturerId Manufacturer ID
   * @param id Graphic ID
   * @param width Optional width parameter
   * @param height Optional height parameter
   * @returns Observable of image blob
   */
  getGraphicBackwardsCompatible(manufacturerId: string, id: string, width?: number, height?: number): Observable<Blob> {
    let params = new HttpParams();
    if (width) params = params.set('w', width.toString());
    if (height) params = params.set('h', height.toString());

    return this.http.get(
      `${this.baseUrl}/api/manufacturer/${manufacturerId}/graphic/${id}`,
      { params, responseType: 'blob', withCredentials: true }
    );
  }

  /**
   * Get asset by handle ID
   * @param handleId Asset handle ID
   * @returns Observable of asset blob
   */
  getAssetByHandleId(handleId: string): Observable<Blob> {
    return this.http.get(
      `${this.baseUrl}/api/asset/${handleId}`,
      { responseType: 'blob', withCredentials: true }
    );
  }

  /**
   * Get article by ID with full parameters
   * @param contentSource Content source identifier
   * @param vehicleId Vehicle ID
   * @param articleId Article ID
   * @param motorVehicleId Optional Motor vehicle ID
   * @param prettyPrint Optional pretty print flag
   * @param bucketName Optional bucket name
   * @param articleSubtype Optional article subtype
   * @param searchTerm Optional search term
   * @returns Observable of ArticleResponse
   */
  getArticleById(
    contentSource: string,
    vehicleId: string,
    articleId: string,
    motorVehicleId?: string,
    prettyPrint?: boolean,
    bucketName?: string,
    articleSubtype?: string,
    searchTerm?: string
  ): Observable<ApiResponse<ArticleResponse>> {
    let params: any = {};
    if (motorVehicleId) params.motorVehicleId = motorVehicleId;
    if (prettyPrint !== undefined) params.prettyPrint = prettyPrint.toString();
    if (bucketName) params.bucketName = bucketName;
    if (articleSubtype) params.articleSubtype = articleSubtype;
    if (searchTerm) params.searchTerm = searchTerm;

    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/article/${articleId}`;
    return this.getWithLogging<ApiResponse<ArticleResponse>>(url, params);
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
  // VEHICLE ENDPOINTS
  // ==========================================

  /**
   * Get motor models for a given year and make
   * @param year Year
   * @param make Make name or make ID (numeric)
   * @returns Observable of ModelAndVehicleIdListResponse
   */
  getMotorModels(year: number, make: string | number): Observable<ApiResponse<ModelAndVehicleIdListResponse>> {
    const url = `${this.baseUrl}/api/motor/year/${year}/make/${make}/models`;
    return this.getWithLogging<ApiResponse<ModelAndVehicleIdListResponse>>(url);
  }

  /**
   * Get vehicles by vehicle IDs (POST)
   * @param contentSource Content source identifier
   * @param vehicleIds Array of vehicle IDs
   * @returns Observable of ModelAndVehicleIdListResponse
   */
  getVehicles(contentSource: ContentSource, vehicleIds: string[]): Observable<ApiResponse<ModelAndVehicleIdListResponse>> {
    const request: GetVehiclesRequest = { vehicleIds };
    return this.http.post<ApiResponse<ModelAndVehicleIdListResponse>>(
      `${this.baseUrl}/api/source/${contentSource}/vehicles`,
      request,
      { withCredentials: true  }
    );
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

    // If we have a motorVehicleId, we should ideally use it with MOTOR source for broader compatibility
    const effectiveSource = motorVehicleId ? 'MOTOR' : contentSource;
    const effectiveId = motorVehicleId || vehicleId;

    const url = `${this.baseUrl}/api/source/${effectiveSource}/vehicle/${effectiveId}/articles/v2`;
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
    let params = new HttpParams();
    if (motorVehicleId) params = params.set('motorVehicleId', motorVehicleId);
    if (searchTerm) params = params.set('searchTerm', searchTerm);

    return this.http.get<ApiResponse<PartLineItemListResponse>>(
      `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/parts`,
      { params, withCredentials: true }
    );
  }

  // ==========================================
  // BOOKMARK ENDPOINTS
  // ==========================================

  /**
   * Save a bookmark for an article
   * @param contentSource Content source identifier
   * @param vehicleId Vehicle ID
   * @param articleId Article ID
   * @returns Observable of ArticleBookmarkResponse
   */
  saveBookmark(contentSource: string, vehicleId: string, articleId: string): Observable<ApiResponse<ArticleBookmarkResponse>> {
    return this.http.post<ApiResponse<ArticleBookmarkResponse>>(
      `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/article/${articleId}/bookmark`,
      null,
      { withCredentials: true }
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
        if (!environment.production) {
          console.error('[Auth Polling] Failed:', error);
        }
        // If we can't reach the status endpoint, assume error
        return of({ status: 'error' as const, progress: 0, message: error.message || 'Connection failed' });
      })
    );
  }

  /**
   * Get a bookmark by ID
   * @param bookmarkId Bookmark ID
   * @returns Observable of ArticleResponse
   */
  getBookmark(bookmarkId: number): Observable<ApiResponse<ArticleResponse>> {
    return this.http.get<ApiResponse<ArticleResponse>>(
      `${this.baseUrl}/api/bookmark/${bookmarkId}`,
      { withCredentials: true }
    );
  }

  // ==========================================
  // UI ENDPOINTS
  // ==========================================

  /**
   * Get favicon
   * @returns Observable of favicon blob
   */
  getFavicon(): Observable<Blob> {
    return this.http.get(
      `${this.baseUrl}/api/ui/favicon`,
      { responseType: 'blob', withCredentials: true }
    );
  }

  /**
   * Get Bootstrap CSS
   * @returns Observable of CSS text
   */
  getBootstrapCss(): Observable<string> {
    return this.http.get(
      `${this.baseUrl}/api/ui/css/bootstrap`,
      { responseType: 'text', withCredentials: true }
    );
  }

  /**
   * Get banner HTML
   * @returns Observable of HTML text
   */
  getBannerHtml(): Observable<string> {
    return this.http.get(
      `${this.baseUrl}/api/ui/banner.html`,
      { responseType: 'text', withCredentials: true }
    );
  }

  /**
   * Get user settings
   * @returns Observable of UiUserSettingsResponse
   */
  getUserSettings(): Observable<ApiResponse<UiUserSettingsResponse>> {
    return this.http.get<ApiResponse<UiUserSettingsResponse>>(
      `${this.baseUrl}/api/ui/usersettings`,
      { withCredentials: true }
    );
  }

  /**
   * Get feedback configurations
   * @returns Observable of FeedbackConfigurationResponse
   */
  getFeedbackConfigurations(): Observable<ApiResponse<FeedbackConfigurationResponse>> {
    return this.http.get<ApiResponse<FeedbackConfigurationResponse>>(
      `${this.baseUrl}/api/ui/feedbackconfigurations`,
      { withCredentials: true }
    );
  }

  /**
   * Save feedback
   * @param feedback Feedback object
   * @returns Observable of empty response
   */
  saveFeedback(feedback: Feedback): Observable<ApiResponse<EmptyResponse>> {
    return this.http.post<ApiResponse<EmptyResponse>>(
      `${this.baseUrl}/api/ui/savefeedback`,
      feedback,
      { withCredentials: true }
    );
  }

  // ==========================================
  // TRACK CHANGE ENDPOINTS
  // ==========================================

  /**
   * Get processing quarters
   * @returns Observable of StringListResponse
   */
  getProcessingQuarters(): Observable<ApiResponse<StringListResponse>> {
    return this.http.get<ApiResponse<StringListResponse>>(
      `${this.baseUrl}/api/source/track-change/processingquarters`,
      { withCredentials: true }
    );
  }

  /**
   * Get vehicle delta report
   * @param quarter Optional processing quarter
   * @returns Observable of VehicleDeltaReportListResponse
   */
  getVehicleDeltaReport(quarter?: string): Observable<ApiResponse<VehicleDeltaReportListResponse>> {
    let params = new HttpParams();
    if (quarter) params = params.set('quarter', quarter);

    return this.http.get<ApiResponse<VehicleDeltaReportListResponse>>(
      `${this.baseUrl}/api/source/track-change/deltareport`,
      { params, withCredentials: true }
    );
  }

  // ==========================================
  // ERROR LOGGING ENDPOINTS
  // ==========================================

  /**
   * Log error
   * @param logEntry Log entry object
   * @returns Observable of empty response
   */
  logError(logEntry: LogEntry): Observable<ApiResponse<EmptyResponse>> {
    return this.http.post<ApiResponse<EmptyResponse>>(
      `${this.baseUrl}/api/logError`,
      logEntry,
      { withCredentials: true }
    );
  }

  // ==========================================
  // AUTHENTICATION ENDPOINTS
  // ==========================================

  /**
   * Logout
   * @returns Observable of any (may redirect)
   */
  logout(): Observable<any> {
    return this.http.get(`${this.baseUrl}/logout`, { observe: 'response' });
  }

  /**
   * L2 vector search (requires Supabase RPC + embeddings; backend enforces unlocks).
   */
  l2Search(vehicleExternalId: string, query: string, matchCount = 8): Observable<L2SearchResponse> {
    const url = `${this.baseUrl}/api/l2/search`;
    this.logRequest('POST', url, undefined, { vehicleExternalId, matchCount });
    return this.http.post<L2SearchResponse>(
      url,
      { vehicleExternalId, query, matchCount },
      { withCredentials: true }
    );
  }
}
