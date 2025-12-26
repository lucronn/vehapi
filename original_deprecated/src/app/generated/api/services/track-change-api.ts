/* tslint:disable */
/* eslint-disable */
import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse, HttpContext } from '@angular/common/http';
import { BaseService } from '../base-service';
import { ApiConfiguration } from '../api-configuration';
import { StrictHttpResponse } from '../strict-http-response';
import { RequestBuilder } from '../request-builder';
import { Observable } from 'rxjs';
import { map, filter } from 'rxjs/operators';

import { StringListResponse } from '../models/string-list-response';
import { VehicleDeltaReportListResponse } from '../models/vehicle-delta-report-list-response';

@Injectable({
  providedIn: 'root',
})
export class TrackChangeApi extends BaseService {
  constructor(
    config: ApiConfiguration,
    http: HttpClient
  ) {
    super(config, http);
  }

  /**
   * Path part for operation getProcessingQuarters
   */
  static readonly GetProcessingQuartersPath = '/api/source/track-change/processingquarters';

  /**
   * Get Processing Quarters.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getProcessingQuarters()` instead.
   *
   * This method doesn't expect any request body.
   */
  getProcessingQuarters$Response(params?: {
    context?: HttpContext
  }
): Observable<StrictHttpResponse<StringListResponse>> {

    const rb = new RequestBuilder(this.rootUrl, TrackChangeApi.GetProcessingQuartersPath, 'get');
    if (params) {
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<StringListResponse>;
      })
    );
  }

  /**
   * Get Processing Quarters.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getProcessingQuarters$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getProcessingQuarters(params?: {
    context?: HttpContext
  }
): Observable<StringListResponse> {

    return this.getProcessingQuarters$Response(params).pipe(
      map((r: StrictHttpResponse<StringListResponse>) => r.body as StringListResponse)
    );
  }

  /**
   * Path part for operation getVehicleDeltaReport
   */
  static readonly GetVehicleDeltaReportPath = '/api/source/track-change/deltareport';

  /**
   * Get Vehicle Delta Report.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getVehicleDeltaReport()` instead.
   *
   * This method doesn't expect any request body.
   */
  getVehicleDeltaReport$Response(params?: {
    quarter?: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<VehicleDeltaReportListResponse>> {

    const rb = new RequestBuilder(this.rootUrl, TrackChangeApi.GetVehicleDeltaReportPath, 'get');
    if (params) {
      rb.query('quarter', params.quarter, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<VehicleDeltaReportListResponse>;
      })
    );
  }

  /**
   * Get Vehicle Delta Report.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getVehicleDeltaReport$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getVehicleDeltaReport(params?: {
    quarter?: string;
    context?: HttpContext
  }
): Observable<VehicleDeltaReportListResponse> {

    return this.getVehicleDeltaReport$Response(params).pipe(
      map((r: StrictHttpResponse<VehicleDeltaReportListResponse>) => r.body as VehicleDeltaReportListResponse)
    );
  }

}
