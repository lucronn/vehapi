import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiResponse, ArticlesData, Make, ModelsData, VinDecodeData } from '../models/motor.models';

@Injectable({ providedIn: 'root' })
export class MotorApiService {
  private http = inject(HttpClient);
  private baseUrl = 'https://autolib.web.app/api/motor-proxy';

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
  
  getVehicleName(contentSource: string, vehicleId: string): Observable<ApiResponse<string>> {
      return this.http.get<ApiResponse<string>>(`${this.baseUrl}/api/source/${contentSource}/${vehicleId}/name`);
  }

  searchArticles(contentSource: string, vehicleId: string, searchTerm?: string): Observable<ApiResponse<ArticlesData>> {
    let url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/articles/v2`;
    if (searchTerm) {
      url += `?searchTerm=${encodeURIComponent(searchTerm)}`;
    }
    return this.http.get<ApiResponse<ArticlesData>>(url);
  }

  getArticleContent(contentSource: string, vehicleId: string, articleId: string): Observable<string> {
    const url = `${this.baseUrl}/api/source/${contentSource}/vehicle/${vehicleId}/article/${articleId}`;
    return this.http.get(url, { responseType: 'text' });
  }

  getGraphicUrl(graphicPath: string): string {
    return `${this.baseUrl}/${graphicPath}`;
  }
}
