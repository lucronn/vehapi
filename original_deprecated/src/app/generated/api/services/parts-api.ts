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

import { ContentSource } from '../models/content-source';
import { PartLineItemListResponse } from '../models/part-line-item-list-response';

@Injectable({
  providedIn: 'root',
})
export class PartsApi extends BaseService {
  constructor(
    config: ApiConfiguration,
    http: HttpClient
  ) {
    super(config, http);
  }

  /**
   * Path part for operation getPartsForVehicle
   */
  static readonly GetPartsForVehiclePath = '/api/source/{contentSource}/vehicle/{vehicleId}/parts';

  /**
   * Get Parts For Vehicle.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getPartsForVehicle()` instead.
   *
   * This method doesn't expect any request body.
   */
  getPartsForVehicle$Response(params: {
    contentSource: ContentSource;
    vehicleId: string;
    motorVehicleId?: string;
    searchTerm?: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<PartLineItemListResponse>> {

    const rb = new RequestBuilder(this.rootUrl, PartsApi.GetPartsForVehiclePath, 'get');
    if (params) {
      rb.path('contentSource', params.contentSource, {});
      rb.path('vehicleId', params.vehicleId, {});
      rb.query('motorVehicleId', params.motorVehicleId, {});
      rb.query('searchTerm', params.searchTerm, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<PartLineItemListResponse>;
      })
    );
  }

  /**
   * Get Parts For Vehicle.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getPartsForVehicle$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getPartsForVehicle(params: {
    contentSource: ContentSource;
    vehicleId: string;
    motorVehicleId?: string;
    searchTerm?: string;
    context?: HttpContext
  }
): Observable<PartLineItemListResponse> {

    return this.getPartsForVehicle$Response(params).pipe(
      map((r: StrictHttpResponse<PartLineItemListResponse>) => r.body as PartLineItemListResponse)
    );
  }

}
