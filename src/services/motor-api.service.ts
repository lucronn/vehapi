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
  public readonly baseUrl = 'https://autolib.web.app/api/motor-proxy';

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

  getCategories(contentSource: string, vehicleId: string): Observable<ApiResponse<CategoriesResponse>> {
    return this.http.get<ApiResponse<CategoriesResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/categories`);
  }

  searchArticles(contentSource: string, vehicleId: string, searchTerm?: string): Observable<ApiResponse<ArticlesData>> {
    // Generate a unique cache key
    const cacheKey = `${contentSource}:${vehicleId}:${searchTerm || 'ALL'}`;

    // Return cached data if available
    if (this.articleCache.has(cacheKey)) {
      return of(this.articleCache.get(cacheKey)!);
    }

    let url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/articles/v2`;
    if (searchTerm) {
      url += `?searchTerm=${encodeURIComponent(searchTerm)}`;
    }

    return this.http.get<ApiResponse<ArticlesData>>(url).pipe(
      // Cache the successful response
      map(response => {
        this.articleCache.set(cacheKey, response);
        return response;
      })
    );
  }

  // Specific Data Endpoints
  getDtcs(contentSource: string, vehicleId: string): Observable<ApiResponse<DtcsResponse>> {
    return this.http.get<ApiResponse<DtcsResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/dtcs`);
  }

  getTsbs(contentSource: string, vehicleId: string): Observable<ApiResponse<TsbsResponse>> {
    return this.http.get<ApiResponse<TsbsResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/tsbs`);
  }

  getWiringDiagrams(contentSource: string, vehicleId: string): Observable<ApiResponse<WiringDiagramsResponse>> {
    return this.http.get<ApiResponse<WiringDiagramsResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/wiring`);
  }

  getComponentLocations(contentSource: string, vehicleId: string): Observable<ApiResponse<ComponentLocationsResponse>> {
    return this.http.get<ApiResponse<ComponentLocationsResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/components`);
  }

  getAllDiagrams(contentSource: string, vehicleId: string): Observable<ApiResponse<DiagramsResponse>> {
    return this.http.get<ApiResponse<DiagramsResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/diagrams`);
  }

  getProcedures(contentSource: string, vehicleId: string): Observable<ApiResponse<ProceduresResponse>> {
    return this.http.get<ApiResponse<ProceduresResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/procedures`);
  }

  getFluids(contentSource: string, vehicleId: string): Observable<ApiResponse<FluidsResponse>> {
    return this.http.get<ApiResponse<FluidsResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/fluids`);
  }

  getSpecs(contentSource: string, vehicleId: string): Observable<ApiResponse<SpecsResponse>> {
    return this.http.get<ApiResponse<SpecsResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/specs`);
  }

  getParts(contentSource: string, vehicleId: string, searchTerm: string = ''): Observable<ApiResponse<PartsResponse>> {
    const params = searchTerm ? { searchTerm } : {};
    return this.http.get<ApiResponse<PartsResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/parts`, { params });
  }

  getLaborOperations(contentSource: string, vehicleId: string): Observable<ApiResponse<LaborResponse>> {
    return this.http.get<ApiResponse<LaborResponse>>(`${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/labor`);
  }

  getArticleContent(contentSource: string, vehicleId: string, articleId: string): Observable<ApiResponse<ArticleContentData>> {
    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/article/${articleId}`;
    return this.http.get<ApiResponse<ArticleContentData>>(url);
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
}