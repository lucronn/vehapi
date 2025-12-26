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

import { EmptyResponse } from '../models/empty-response';
import { LogEntry } from '../models/log-entry';

@Injectable({
  providedIn: 'root',
})
export class ErrorLoggingApi extends BaseService {
  constructor(
    config: ApiConfiguration,
    http: HttpClient
  ) {
    super(config, http);
  }

  /**
   * Path part for operation logError
   */
  static readonly LogErrorPath = '/api/logError';

  /**
   * Provides the ability to log client side errors without injecting the externallogging url or requiring separate authentication information.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `logError()` instead.
   *
   * This method sends `application/*+json` and handles request body of type `application/*+json`.
   */
  logError$Response(params?: {
    context?: HttpContext
    body?: LogEntry
  }
): Observable<StrictHttpResponse<EmptyResponse>> {

    const rb = new RequestBuilder(this.rootUrl, ErrorLoggingApi.LogErrorPath, 'post');
    if (params) {
      rb.body(params.body, 'application/*+json');
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<EmptyResponse>;
      })
    );
  }

  /**
   * Provides the ability to log client side errors without injecting the externallogging url or requiring separate authentication information.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `logError$Response()` instead.
   *
   * This method sends `application/*+json` and handles request body of type `application/*+json`.
   */
  logError(params?: {
    context?: HttpContext
    body?: LogEntry
  }
): Observable<EmptyResponse> {

    return this.logError$Response(params).pipe(
      map((r: StrictHttpResponse<EmptyResponse>) => r.body as EmptyResponse)
    );
  }

}
