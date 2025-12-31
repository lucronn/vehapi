import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, of } from 'rxjs';
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
  ContentSource
} from '../models/motor.models';

@Injectable({ providedIn: 'root' })
export class MotorApiService {
  private http = inject(HttpClient);
  public readonly baseUrl = 'https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy';

  // Cache for article searches to prevent redundant API calls
  private articleCache = new Map<string, ApiResponse<ArticlesData>>();

  decodeVin(vin: string): Observable<ApiResponse<VinDecodeData>> {
    // Fixed endpoint to match OpenAPI spec: /api/vin/{vin}/vehicle
    return this.http.get<ApiResponse<VinDecodeData>>(`${this.baseUrl}/api/vin/${vin}/vehicle`);
  }

  getYears(): Observable<ApiResponse<number[]>> {
    return this.http.get<ApiResponse<number[]>>(`${this.baseUrl}/api/years`);
  }

  getMakes(year: number): Observable<ApiResponse<Make[]>> {
    return this.http.get<ApiResponse<Make[]>>(`${this.baseUrl}/api/year/${year}/makes`);
  }

  getModels(year: number, make: string): Observable<ApiResponse<ModelsData>> {
    return this.http.get<ApiResponse<ModelsData>>(`${this.baseUrl}/api/year/${year}/make/${make}/models`);
  }

  getMotorVehicles(contentSource: string, vehicleId: string): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(`${this.baseUrl}/api/source/${contentSource}/${vehicleId}/motorvehicles`);
  }

  getVehicleName(contentSource: string, vehicleId: string): Observable<ApiResponse<string>> {
    return this.http.get<ApiResponse<string>>(`${this.baseUrl}/api/source/${contentSource}/${vehicleId}/name`);
  }

  searchArticles(contentSource: string, vehicleId: string, searchTerm: string = ''): Observable<ApiResponse<ArticlesData>> {
    // Generate a unique cache key
    const cacheKey = `${contentSource}:${vehicleId}:${searchTerm.trim() || 'ALL'}`;

    // Return cached data if available
    if (this.articleCache.has(cacheKey)) {
      return of(this.articleCache.get(cacheKey)!);
    }

    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/articles/v2`;
    // Reference implementation always sends searchTerm, even if empty
    const params: any = { searchTerm: searchTerm };

    return this.http.get<ApiResponse<ArticlesData>>(url, { params }).pipe(
      // Cache the successful response
      map(response => {
        if (response.header.statusCode === 200) {
          this.articleCache.set(cacheKey, response);
        }
        return response;
      })
    );
  }

  // Specific Data Endpoints

  getFluids(contentSource: string, vehicleId: string): Observable<ApiResponse<FluidsResponse>> {
    return this.http.get<ApiResponse<FluidsResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/fluids`);
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
    return this.http.get<ApiResponse<ArticleContentData>>(url);
  }

  getArticleXml(contentSource: string, articleId: string): Observable<string> {
    // Returns raw XML text, not wrapped in ApiResponse
    const url = `${this.baseUrl}/api/source/${contentSource}/xml/${articleId}`;
    return this.http.get(url, { responseType: 'text' });
  }

  getArticleTitle(contentSource: string, vehicleId: string, articleId: string): Observable<ApiResponse<string>> {
    // OpenAPI returns StringResponse wrapper, but we extract the value for backward compatibility
    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/article/${articleId}/title`;
    return this.http.get<ApiResponse<StringResponse>>(url).pipe(
      map(response => ({
        ...response,
        body: response.body.value
      }))
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
   */
  processHtmlContent(html: string): string {
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

    // Process src attributes (images, iframes, videos, etc.)
    // Matches: src="..." or src='...' (handles both quotes)
    let processed = html.replace(/src\s*=\s*["']([^"']+)["']/gi, (match, url) => {
      const processedUrl = processUrl(url, 'src');
      // Preserve original quote style
      const quote = match.includes("'") ? "'" : '"';
      return `src=${quote}${processedUrl}${quote}`;
    });

    // Process href attributes (links)
    processed = processed.replace(/href\s*=\s*["']([^"']+)["']/gi, (match, url) => {
      // Skip anchors and javascript
      if (url.startsWith('#') || url.startsWith('javascript:')) {
        return match;
      }
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