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
import { SearchResultsResponse } from '../models/search-results-response';

@Injectable({
  providedIn: 'root',
})
export class SearchApi extends BaseService {
  constructor(
    config: ApiConfiguration,
    http: HttpClient
  ) {
    super(config, http);
  }

  /**
   * Path part for operation getSearchResultsByVehicleId
   */
  static readonly GetSearchResultsByVehicleIdPath = '/api/source/{contentSource}/vehicle/{vehicleId}/articles/v2';

  /**
   * Metadata for articles that match the provided vehicle and search term.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getSearchResultsByVehicleId()` instead.
   *
   * This method doesn't expect any request body.
   */
  getSearchResultsByVehicleId$Response(params: {
    contentSource: ContentSource;
    vehicleId: string;
    searchTerm?: string;
    motorVehicleId?: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<SearchResultsResponse>> {

    const rb = new RequestBuilder(this.rootUrl, SearchApi.GetSearchResultsByVehicleIdPath, 'get');
    if (params) {
      rb.path('contentSource', params.contentSource, {});
      rb.path('vehicleId', params.vehicleId, {});
      rb.query('searchTerm', params.searchTerm, {});
      rb.query('motorVehicleId', params.motorVehicleId, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<SearchResultsResponse>;
      })
    );
  }

  /**
   * Metadata for articles that match the provided vehicle and search term.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getSearchResultsByVehicleId$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getSearchResultsByVehicleId(params: {
    contentSource: ContentSource;
    vehicleId: string;
    searchTerm?: string;
    motorVehicleId?: string;
    context?: HttpContext
  }
): Observable<SearchResultsResponse> {

    return this.getSearchResultsByVehicleId$Response(params).pipe(
      map((r: StrictHttpResponse<SearchResultsResponse>) => r.body as SearchResultsResponse)
    );
  }

}
