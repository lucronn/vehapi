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

import { Feedback } from '../models/feedback';
import { FeedbackConfigurationResponse } from '../models/feedback-configuration-response';
import { UiUserSettingsResponse } from '../models/ui-user-settings-response';

@Injectable({
  providedIn: 'root',
})
export class UiApi extends BaseService {
  constructor(
    config: ApiConfiguration,
    http: HttpClient
  ) {
    super(config, http);
  }

  /**
   * Path part for operation getFavicon
   */
  static readonly GetFaviconPath = '/api/ui/favicon';

  /**
   * Get Favicon.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getFavicon()` instead.
   *
   * This method doesn't expect any request body.
   */
  getFavicon$Response(params?: {
    context?: HttpContext
  }
): Observable<StrictHttpResponse<void>> {

    const rb = new RequestBuilder(this.rootUrl, UiApi.GetFaviconPath, 'get');
    if (params) {
    }

    return this.http.request(rb.build({
      responseType: 'text',
      accept: '*/*',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return (r as HttpResponse<any>).clone({ body: undefined }) as StrictHttpResponse<void>;
      })
    );
  }

  /**
   * Get Favicon.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getFavicon$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getFavicon(params?: {
    context?: HttpContext
  }
): Observable<void> {

    return this.getFavicon$Response(params).pipe(
      map((r: StrictHttpResponse<void>) => r.body as void)
    );
  }

  /**
   * Path part for operation getBootstrapCss
   */
  static readonly GetBootstrapCssPath = '/api/ui/css/bootstrap';

  /**
   * Get Bootstrap Css.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getBootstrapCss()` instead.
   *
   * This method doesn't expect any request body.
   */
  getBootstrapCss$Response(params?: {
    context?: HttpContext
  }
): Observable<StrictHttpResponse<void>> {

    const rb = new RequestBuilder(this.rootUrl, UiApi.GetBootstrapCssPath, 'get');
    if (params) {
    }

    return this.http.request(rb.build({
      responseType: 'text',
      accept: '*/*',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return (r as HttpResponse<any>).clone({ body: undefined }) as StrictHttpResponse<void>;
      })
    );
  }

  /**
   * Get Bootstrap Css.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getBootstrapCss$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getBootstrapCss(params?: {
    context?: HttpContext
  }
): Observable<void> {

    return this.getBootstrapCss$Response(params).pipe(
      map((r: StrictHttpResponse<void>) => r.body as void)
    );
  }

  /**
   * Path part for operation getBannerHtml
   */
  static readonly GetBannerHtmlPath = '/api/ui/banner.html';

  /**
   * Get Banner Html.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getBannerHtml()` instead.
   *
   * This method doesn't expect any request body.
   */
  getBannerHtml$Response(params?: {
    context?: HttpContext
  }
): Observable<StrictHttpResponse<void>> {

    const rb = new RequestBuilder(this.rootUrl, UiApi.GetBannerHtmlPath, 'get');
    if (params) {
    }

    return this.http.request(rb.build({
      responseType: 'text',
      accept: '*/*',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return (r as HttpResponse<any>).clone({ body: undefined }) as StrictHttpResponse<void>;
      })
    );
  }

  /**
   * Get Banner Html.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getBannerHtml$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getBannerHtml(params?: {
    context?: HttpContext
  }
): Observable<void> {

    return this.getBannerHtml$Response(params).pipe(
      map((r: StrictHttpResponse<void>) => r.body as void)
    );
  }

  /**
   * Path part for operation getUserSettings
   */
  static readonly GetUserSettingsPath = '/api/ui/usersettings';

  /**
   * Get User Settings.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getUserSettings()` instead.
   *
   * This method doesn't expect any request body.
   */
  getUserSettings$Response(params?: {
    context?: HttpContext
  }
): Observable<StrictHttpResponse<UiUserSettingsResponse>> {

    const rb = new RequestBuilder(this.rootUrl, UiApi.GetUserSettingsPath, 'get');
    if (params) {
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<UiUserSettingsResponse>;
      })
    );
  }

  /**
   * Get User Settings.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getUserSettings$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getUserSettings(params?: {
    context?: HttpContext
  }
): Observable<UiUserSettingsResponse> {

    return this.getUserSettings$Response(params).pipe(
      map((r: StrictHttpResponse<UiUserSettingsResponse>) => r.body as UiUserSettingsResponse)
    );
  }

  /**
   * Path part for operation getFeedbackConfigurations
   */
  static readonly GetFeedbackConfigurationsPath = '/api/ui/feedbackconfigurations';

  /**
   * Get Feedback Configurations.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getFeedbackConfigurations()` instead.
   *
   * This method doesn't expect any request body.
   */
  getFeedbackConfigurations$Response(params?: {
    context?: HttpContext
  }
): Observable<StrictHttpResponse<FeedbackConfigurationResponse>> {

    const rb = new RequestBuilder(this.rootUrl, UiApi.GetFeedbackConfigurationsPath, 'get');
    if (params) {
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<FeedbackConfigurationResponse>;
      })
    );
  }

  /**
   * Get Feedback Configurations.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getFeedbackConfigurations$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getFeedbackConfigurations(params?: {
    context?: HttpContext
  }
): Observable<FeedbackConfigurationResponse> {

    return this.getFeedbackConfigurations$Response(params).pipe(
      map((r: StrictHttpResponse<FeedbackConfigurationResponse>) => r.body as FeedbackConfigurationResponse)
    );
  }

  /**
   * Path part for operation saveFeedback
   */
  static readonly SaveFeedbackPath = '/api/ui/savefeedback';

  /**
   * Save Feedback.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `saveFeedback()` instead.
   *
   * This method sends `application/*+json` and handles request body of type `application/*+json`.
   */
  saveFeedback$Response(params?: {
    context?: HttpContext
    body?: Feedback
  }
): Observable<StrictHttpResponse<void>> {

    const rb = new RequestBuilder(this.rootUrl, UiApi.SaveFeedbackPath, 'post');
    if (params) {
      rb.body(params.body, 'application/*+json');
    }

    return this.http.request(rb.build({
      responseType: 'text',
      accept: '*/*',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return (r as HttpResponse<any>).clone({ body: undefined }) as StrictHttpResponse<void>;
      })
    );
  }

  /**
   * Save Feedback.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `saveFeedback$Response()` instead.
   *
   * This method sends `application/*+json` and handles request body of type `application/*+json`.
   */
  saveFeedback(params?: {
    context?: HttpContext
    body?: Feedback
  }
): Observable<void> {

    return this.saveFeedback$Response(params).pipe(
      map((r: StrictHttpResponse<void>) => r.body as void)
    );
  }

}
