import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, of } from 'rxjs';
import {
  ApiResponse,
  ArticlesData,
  Make,
  ModelsData,
  VinDecodeData,
  ArticleContentData,
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
  LaborResponse
} from '../models/motor.models';

@Injectable({ providedIn: 'root' })
export class MotorApiService {
  private http = inject(HttpClient);
  public readonly baseUrl = 'https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy';

  // Cache for article searches to prevent redundant API calls
  private articleCache = new Map<string, ApiResponse<ArticlesData>>();

  decodeVin(vin: string): Observable<ApiResponse<VinDecodeData>> {
    return this.http.get<ApiResponse<VinDecodeData>>(`${this.baseUrl}/api/vin/${vin}`);
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

  getParts(contentSource: string, vehicleId: string, searchTerm: string = ''): Observable<ApiResponse<PartsResponse>> {
    const params = searchTerm ? { searchTerm } : {};
    return this.http.get<ApiResponse<PartsResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/parts`, { params });
  }

  getArticleLabor(contentSource: string, vehicleId: string, articleId: string, motorVehicleId?: string): Observable<ApiResponse<LaborResponse>> {
    const params: any = {};
    if (motorVehicleId) params.motorVehicleId = motorVehicleId;
    return this.http.get<ApiResponse<LaborResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/labor/${articleId}`, { params });
  }

  getMaintenanceByFrequency(contentSource: string, vehicleId: string): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/maintenanceSchedules/frequency`);
  }

  getMaintenanceByIntervals(contentSource: string, vehicleId: string, intervalType: 'miles' | 'months', interval: number): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/maintenanceSchedules/intervals`, {
      params: { intervalType, interval }
    });
  }

  getArticleContent(contentSource: string, vehicleId: string, articleId: string): Observable<ApiResponse<ArticleContentData>> {
    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/article/${articleId}`;
    return this.http.get<ApiResponse<ArticleContentData>>(url);
  }

  getArticleXml(contentSource: string, vehicleId: string, articleId: string): Observable<ApiResponse<string>> {
    const url = `${this.baseUrl}/api/source/${contentSource}/xml/${articleId}`;
    return this.http.get<ApiResponse<string>>(url);
  }

  getArticleTitle(contentSource: string, vehicleId: string, articleId: string): Observable<ApiResponse<string>> {
    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/article/${articleId}/title`;
    return this.http.get<ApiResponse<string>>(url);
  }

  getGraphicUrl(graphicPath: string): string {
    if (!graphicPath) return '';
    if (graphicPath.startsWith('http')) return graphicPath;
    const path = graphicPath.startsWith('/') ? graphicPath.substring(1) : graphicPath;
    return `${this.baseUrl}/${path}`;
  }

  /**
   * Process HTML content to fix relative URLs for images and links
   */
  processHtmlContent(html: string): string {
    if (!html) return '';

    // Replace relative src attributes (images, scripts)
    // Matches src="/..." or src='...'
    let processed = html.replace(/src=["'](\/[^"']+)["']/g, (match, url) => {
      return `src="${this.baseUrl}${url}"`;
    });

    // Replace relative href attributes (links, css)
    // Matches href="/..." or href='...'
    processed = processed.replace(/href=["'](\/[^"']+)["']/g, (match, url) => {
      return `href="${this.baseUrl}${url}"`;
    });

    return processed;
  }
}