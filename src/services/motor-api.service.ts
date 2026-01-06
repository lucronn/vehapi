import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpRequest, HttpEvent } from '@angular/common/http';
import { Observable, map, of, tap, catchError, timeout } from 'rxjs';
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

@Injectable({ providedIn: 'root' })
export class MotorApiService {
  private http = inject(HttpClient);
  public readonly baseUrl = 'https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy';

  // Cache for article searches to prevent redundant API calls
  private articleCache = new Map<string, ApiResponse<ArticlesData>>();

  /**
   * Verbose logging helper for API requests
   */
  private logRequest(method: string, url: string, params?: any, body?: any): void {
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
    console.log(`   Proxy: ${this.baseUrl}`);
    console.log(`   Target: sites.motor.com/m1`);
    console.groupEnd();
  }

  /**
   * Verbose logging helper for API responses
   */
  private logResponse(url: string, status: number, statusText: string, headers: any, bodySize?: number, duration?: number): void {
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
    console.log(`   Flow: Frontend → Proxy → sites.motor.com/m1`);
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
      map(response => response.body as T),
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

  getModels(year: number, make: string): Observable<ApiResponse<ModelsData>> {
    const url = `${this.baseUrl}/api/year/${year}/make/${make}/models`;
    return this.getWithLogging<ApiResponse<ModelsData>>(url);
  }

  getMotorVehicles(contentSource: string, vehicleId: string): Observable<ApiResponse<any[]>> {
    const url = `${this.baseUrl}/api/source/${contentSource}/${vehicleId}/motorvehicles`;
    return this.getWithLogging<ApiResponse<any[]>>(url);
  }

  getVehicleName(contentSource: string, vehicleId: string): Observable<ApiResponse<string>> {
    const url = `${this.baseUrl}/api/source/${contentSource}/${vehicleId}/name`;
    return this.getWithLogging<ApiResponse<string>>(url);
  }

  searchArticles(contentSource: string, vehicleId: string, searchTerm: string = ''): Observable<ApiResponse<ArticlesData>> {
    // Generate a unique cache key
    const cacheKey = `${contentSource}:${vehicleId}:${searchTerm.trim() || 'ALL'}`;

    // Return cached data if available
    if (this.articleCache.has(cacheKey)) {
      console.log(`[API CACHE HIT] searchArticles: ${cacheKey}`);
      return of(this.articleCache.get(cacheKey)!);
    }

    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/articles/v2`;
    // Reference implementation always sends searchTerm, even if empty
    const params: any = { searchTerm: searchTerm };

    const startTime = performance.now();
    this.logRequest('GET', url, params);

    return this.http.get<ApiResponse<ArticlesData>>(url, { params, observe: 'response' }).pipe(
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
        const data = response.body!;
        // Cache the successful response
        if (data.header.statusCode === 200) {
          this.articleCache.set(cacheKey, data);
          console.log(`[API CACHE SET] searchArticles: ${cacheKey}`);
        }
        return data;
      }),
      catchError(error => {
        const duration = Math.round(performance.now() - startTime);
        this.logApiError(url, error, duration);
        throw error;
      })
    );
  }

  // Specific Data Endpoints

  getFluids(contentSource: string, vehicleId: string): Observable<ApiResponse<FluidsResponse>> {
    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/fluids`;
    return this.getWithLogging<ApiResponse<FluidsResponse>>(url);
  }

  // Backward compatible method - kept for existing code
  getParts(contentSource: string, vehicleId: string, searchTerm: string = ''): Observable<ApiResponse<PartsResponse>> {
    const params = searchTerm ? { searchTerm } : {};
    // Use the new method and map response
    return this.getPartsForVehicle(contentSource, vehicleId, undefined, searchTerm).pipe(
      map(response => ({
        ...response,
        body: {
          total: response.body.items?.length || 0,
          data: response.body.items?.map(item => ({
            partNumber: item.partNumber,
            description: item.description,
            manufacturer: '', // Not in PartLineItem
            listPrice: 0, // Not in PartLineItem
            dealerPrice: 0, // Not in PartLineItem
            category: '' // Not in PartLineItem
          })) || []
        } as PartsResponse
      }))
    );
  }

  getArticleLabor(contentSource: string, vehicleId: string, articleId: string, motorVehicleId?: string): Observable<ApiResponse<LaborResponse>> {
    const params: any = {};
    if (motorVehicleId) params.motorVehicleId = motorVehicleId;
    return this.http.get<ApiResponse<LaborResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/labor/${articleId}`, { params });
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
    let params = new HttpParams();
    if (frequencyTypeCode) params = params.set('frequencyTypeCode', frequencyTypeCode);
    if (severity) params = params.set('severity', severity);
    if (searchTerm) params = params.set('searchTerm', searchTerm);

    return this.http.get<ApiResponse<MaintenanceSchedulesByFrequencyResponse>>(
      `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/maintenanceSchedules/frequency`,
      { params }
    );
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
    let params = new HttpParams();
    // Normalize intervalType to match OpenAPI enum
    const normalizedIntervalType = intervalType === 'miles' ? 'Miles' :
      intervalType === 'months' ? 'Months' :
        intervalType as IntervalType;
    if (normalizedIntervalType) params = params.set('intervalType', normalizedIntervalType);
    if (interval !== undefined) params = params.set('interval', interval.toString());
    if (severity) params = params.set('severity', severity);
    if (searchTerm) params = params.set('searchTerm', searchTerm);

    return this.http.get<ApiResponse<MaintenanceSchedulesByIntervalResponse>>(
      `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/maintenanceSchedules/intervals`,
      { params }
    );
  }

  getIndicatorsWithMaintenanceSchedules(
    contentSource: string,
    vehicleId: string,
    severity?: MaintenanceScheduleSeverity,
    searchTerm?: string
  ): Observable<ApiResponse<IndicatorsWithMaintenanceSchedulesResponse>> {
    let params = new HttpParams();
    if (severity) params = params.set('severity', severity);
    if (searchTerm) params = params.set('searchTerm', searchTerm);

    return this.http.get<ApiResponse<IndicatorsWithMaintenanceSchedulesResponse>>(
      `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/maintenanceSchedules/indicators`,
      { params }
    );
  }

  getArticleContent(contentSource: string, vehicleId: string, articleId: string): Observable<ApiResponse<ArticleContentData>> {
    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/article/${articleId}`;
    return this.getWithLogging<ApiResponse<ArticleContentData>>(url);
  }

  getArticleXml(contentSource: string, articleId: string): Observable<string> {
    // Returns raw XML text, not wrapped in ApiResponse
    const url = `${this.baseUrl}/api/source/${contentSource}/xml/${articleId}`;
    return this.http.get(url, { responseType: 'text' });
  }

  getArticleTitle(contentSource: string, vehicleId: string, articleId: string): Observable<ApiResponse<string>> {
    // OpenAPI returns StringResponse wrapper, but we extract the value for backward compatibility
    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/article/${articleId}/title`;
    const startTime = performance.now();
    this.logRequest('GET', url);

    return this.http.get<ApiResponse<StringResponse>>(url, { observe: 'response' }).pipe(
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
        const body = response.body!;
        return {
          ...body,
          body: body.body.value
        } as ApiResponse<string>;
      }),
      catchError(error => {
        const duration = Math.round(performance.now() - startTime);
        this.logApiError(url, error, duration);
        throw error;
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

  /**
   * Process HTML content to fix relative URLs for images and links
   * Comprehensive URL processing for all image and asset paths
   * Also processes custom elements like mtr-doc-link
   */
  processHtmlContent(html: string, contentSource?: string, vehicleId?: string): string {
    if (!html) return '';

    // Helper function to normalize and process URLs
    const processUrl = (url: string, attrName: string = 'src'): string => {
      // Skip if already a full URL (http/https)
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }

      // Skip if already processed (contains baseUrl)
      if (url.includes(this.baseUrl)) {
        return url;
      }

      // Skip data URLs, anchors, and javascript
      if (url.startsWith('data:') || url.startsWith('#') || url.startsWith('javascript:')) {
        return url;
      }

      // Handle API paths - these should go through the proxy
      if (url.startsWith('/api/') || url.startsWith('api/')) {
        const cleanPath = url.startsWith('/') ? url : `/${url}`;
        return `${this.baseUrl}${cleanPath}`;
      }

      // Handle other absolute paths starting with /
      if (url.startsWith('/')) {
        return `${this.baseUrl}${url}`;
      }

      // Handle relative paths (like ../graphic/... or ./image.jpg)
      // Convert to absolute path through proxy
      if (url.startsWith('../') || url.startsWith('./')) {
        // Normalize relative paths - for now, treat as absolute from proxy root
        const cleanPath = url.replace(/^\.\.?\//, '');
        return `${this.baseUrl}/${cleanPath}`;
      }

      // Default: treat as relative path from proxy root
      return `${this.baseUrl}/${url}`;
    };

    // Process custom mtr-doc-link elements - convert to clickable links
    // Format: <mtr-doc-link id="2161655">Link Text</mtr-doc-link>
    // Convert to: <a href="#/vehicle/{contentSource}/{vehicleId}/article/{id}">Link Text</a>
    // Note: Using hash-based routing, so links start with #/
    if (contentSource && vehicleId) {
      html = html.replace(/<mtr-doc-link\s+id=["']([^"']+)["']>([^<]*)<\/mtr-doc-link>/gi, (match, id, text) => {
        const linkText = text.trim() || 'View Article';
        // Use relative hash route (Angular uses hash location strategy)
        return `<a href="#/vehicle/${contentSource}/${vehicleId}/article/${id}" class="text-cyan-400 hover:text-cyan-300 underline">${linkText}</a>`;
      });
    } else {
      // If no context, just remove the custom tag and keep the text
      html = html.replace(/<mtr-doc-link[^>]*>([^<]*)<\/mtr-doc-link>/gi, '$1');
    }

    // Process src attributes (images, iframes, videos, etc.)
    // Matches: src="..." or src='...' (handles both quotes, including spaces around =)
    let processed = html.replace(/src\s*=\s*["']([^"']+)["']/gi, (match, url) => {
      // Trim whitespace from URL
      url = url.trim();
      // Skip if empty
      if (!url) return match;

      const processedUrl = processUrl(url, 'src');
      // Preserve original quote style
      const quote = match.includes("'") ? "'" : '"';
      return `src=${quote}${processedUrl}${quote}`;
    });

    // Also handle img tags that might not follow standard format
    // Handle: <img ... data-src="..." /> (lazy loading patterns)
    processed = processed.replace(/data-src\s*=\s*["']([^"']+)["']/gi, (match, url) => {
      url = url.trim();
      if (!url) return match;
      const processedUrl = processUrl(url, 'data-src');
      const quote = match.includes("'") ? "'" : '"';
      return `data-src=${quote}${processedUrl}${quote}`;
    });

    // Process href attributes (links)
    processed = processed.replace(/href\s*=\s*["']([^"']+)["']/gi, (match, url) => {
      url = url.trim();
      // Skip anchors, hash routes, javascript, mailto, tel
      if (url.startsWith('#') ||
        url.startsWith('javascript:') ||
        url.startsWith('mailto:') ||
        url.startsWith('tel:')) {
        return match;
      }

      // Skip if already a full URL (http/https) - these are external links
      if (url.startsWith('http://') || url.startsWith('https://')) {
        // But if it's pointing to our own baseUrl with a hash route, convert it
        if (url.includes(this.baseUrl) && url.includes('#/')) {
          const hashPart = url.substring(url.indexOf('#/'));
          const quote = match.includes("'") ? "'" : '"';
          return `href=${quote}${hashPart}${quote}`;
        }
        return match;
      }

      // Process internal relative URLs
      const processedUrl = processUrl(url, 'href');
      const quote = match.includes("'") ? "'" : '"';
      return `href=${quote}${processedUrl}${quote}`;
    });

    // Process background-image URLs in style attributes
    processed = processed.replace(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
      const processedUrl = processUrl(url, 'background');
      // Remove quotes from url() if they were there
      const originalHadQuotes = /url\(["']/.test(match);
      return originalHadQuotes
        ? `background-image: url("${processedUrl}")`
        : `background-image: url(${processedUrl})`;
    });

    // Process srcset attributes (responsive images)
    processed = processed.replace(/srcset\s*=\s*["']([^"']+)["']/gi, (match, srcset) => {
      // srcset can have multiple URLs: "image1.jpg 1x, image2.jpg 2x"
      const processedSrcset = srcset.split(',').map(part => {
        const trimmed = part.trim();
        // Extract URL (before space or descriptor like "1x", "2x", "100w")
        const urlMatch = trimmed.match(/^([^\s]+)/);
        if (urlMatch) {
          const url = urlMatch[1];
          const descriptor = trimmed.substring(url.length).trim();
          const processedUrl = processUrl(url, 'srcset');
          return descriptor ? `${processedUrl} ${descriptor}` : processedUrl;
        }
        return trimmed;
      }).join(', ');

      const quote = match.includes("'") ? "'" : '"';
      return `srcset=${quote}${processedSrcset}${quote}`;
    });

    return processed;
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
      { params, responseType: 'blob' }
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
      { params, responseType: 'blob' }
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
      { responseType: 'blob' }
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
    let params = new HttpParams();
    if (motorVehicleId) params = params.set('motorVehicleId', motorVehicleId);
    if (prettyPrint !== undefined) params = params.set('prettyPrint', prettyPrint.toString());
    if (bucketName) params = params.set('bucketName', bucketName);
    if (articleSubtype) params = params.set('articleSubtype', articleSubtype);
    if (searchTerm) params = params.set('searchTerm', searchTerm);

    return this.http.get<ApiResponse<ArticleResponse>>(
      `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/article/${articleId}`,
      { params }
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
    let params = new HttpParams();
    if (motorVehicleId) params = params.set('motorVehicleId', motorVehicleId);
    if (prettyPrint !== undefined) params = params.set('prettyPrint', prettyPrint.toString());
    if (searchTerm) params = params.set('searchTerm', searchTerm);

    return this.http.get<ApiResponse<LaborResponseOpenApi>>(
      `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/labor/${articleId}`,
      { params }
    );
  }

  // ==========================================
  // VEHICLE ENDPOINTS
  // ==========================================

  /**
   * Get motor models for a given year and make
   * @param year Year
   * @param make Make name
   * @returns Observable of ModelAndVehicleIdListResponse
   */
  getMotorModels(year: number, make: string): Observable<ApiResponse<ModelAndVehicleIdListResponse>> {
    return this.http.get<ApiResponse<ModelAndVehicleIdListResponse>>(
      `${this.baseUrl}/api/motor/year/${year}/make/${make}/models`
    );
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
      request
    );
  }

  /**
   * Get vehicles by vehicle IDs (GET - deprecated)
   * @param contentSource Content source identifier
   * @param vehicleIds Array of vehicle IDs
   * @returns Observable of ModelAndVehicleIdListResponse
   */
  getVehiclesDeprecated(contentSource: ContentSource, vehicleIds: string[]): Observable<ApiResponse<ModelAndVehicleIdListResponse>> {
    let params = new HttpParams();
    vehicleIds.forEach(id => params = params.append('vehicleIds', id));

    return this.http.get<ApiResponse<ModelAndVehicleIdListResponse>>(
      `${this.baseUrl}/api/source/${contentSource}/vehicles`,
      { params }
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
    if (motorVehicleId) params = params.set('motorVehicleId', motorVehicleId);

    return this.http.get<ApiResponse<SearchResultsResponse>>(
      `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/articles/v2`,
      { params }
    );
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
      { params }
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
      null
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
        console.error('[Auth Polling] Failed:', error);
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
      `${this.baseUrl}/api/bookmark/${bookmarkId}`
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
      { responseType: 'blob' }
    );
  }

  /**
   * Get Bootstrap CSS
   * @returns Observable of CSS text
   */
  getBootstrapCss(): Observable<string> {
    return this.http.get(
      `${this.baseUrl}/api/ui/css/bootstrap`,
      { responseType: 'text' }
    );
  }

  /**
   * Get banner HTML
   * @returns Observable of HTML text
   */
  getBannerHtml(): Observable<string> {
    return this.http.get(
      `${this.baseUrl}/api/ui/banner.html`,
      { responseType: 'text' }
    );
  }

  /**
   * Get user settings
   * @returns Observable of UiUserSettingsResponse
   */
  getUserSettings(): Observable<ApiResponse<UiUserSettingsResponse>> {
    return this.http.get<ApiResponse<UiUserSettingsResponse>>(
      `${this.baseUrl}/api/ui/usersettings`
    );
  }

  /**
   * Get feedback configurations
   * @returns Observable of FeedbackConfigurationResponse
   */
  getFeedbackConfigurations(): Observable<ApiResponse<FeedbackConfigurationResponse>> {
    return this.http.get<ApiResponse<FeedbackConfigurationResponse>>(
      `${this.baseUrl}/api/ui/feedbackconfigurations`
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
      feedback
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
      `${this.baseUrl}/api/source/track-change/processingquarters`
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
      { params }
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
      logEntry
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
}