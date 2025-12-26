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

import { ArticleResponse } from '../models/article-response';
import { ContentSource } from '../models/content-source';
import { IndicatorsWithMaintenanceSchedulesResponse } from '../models/indicators-with-maintenance-schedules-response';
import { IntervalType } from '../models/interval-type';
import { LaborResponse } from '../models/labor-response';
import { MaintenanceScheduleSeverity } from '../models/maintenance-schedule-severity';
import { MaintenanceSchedulesByFrequencyResponse } from '../models/maintenance-schedules-by-frequency-response';
import { MaintenanceSchedulesByIntervalResponse } from '../models/maintenance-schedules-by-interval-response';
import { StringResponse } from '../models/string-response';

@Injectable({
  providedIn: 'root',
})
export class AssetApi extends BaseService {
  constructor(
    config: ApiConfiguration,
    http: HttpClient
  ) {
    super(config, http);
  }

  /**
   * Path part for operation getArticleById
   */
  static readonly GetArticleByIdPath = '/api/source/{contentSource}/vehicle/{vehicleId}/article/{articleId}';

  /**
   * Content and relevant metadata for a specific article in the context of a vehicle.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getArticleById()` instead.
   *
   * This method doesn't expect any request body.
   */
  getArticleById$Response(params: {
    contentSource: ContentSource;
    vehicleId: string;
    articleId: string;
    motorVehicleId?: string;
    prettyPrint?: boolean;
    bucketName?: string;
    articleSubtype?: string;
    searchTerm?: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<ArticleResponse>> {

    const rb = new RequestBuilder(this.rootUrl, AssetApi.GetArticleByIdPath, 'get');
    if (params) {
      rb.path('contentSource', params.contentSource, {});
      rb.path('vehicleId', params.vehicleId, {});
      rb.path('articleId', params.articleId, {});
      rb.query('motorVehicleId', params.motorVehicleId, {});
      rb.query('prettyPrint', params.prettyPrint, {});
      rb.query('bucketName', params.bucketName, {});
      rb.query('articleSubtype', params.articleSubtype, {});
      rb.query('searchTerm', params.searchTerm, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<ArticleResponse>;
      })
    );
  }

  /**
   * Content and relevant metadata for a specific article in the context of a vehicle.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getArticleById$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getArticleById(params: {
    contentSource: ContentSource;
    vehicleId: string;
    articleId: string;
    motorVehicleId?: string;
    prettyPrint?: boolean;
    bucketName?: string;
    articleSubtype?: string;
    searchTerm?: string;
    context?: HttpContext
  }
): Observable<ArticleResponse> {

    return this.getArticleById$Response(params).pipe(
      map((r: StrictHttpResponse<ArticleResponse>) => r.body as ArticleResponse)
    );
  }

  /**
   * Path part for operation getLaborDetails
   */
  static readonly GetLaborDetailsPath = '/api/source/{contentSource}/vehicle/{vehicleId}/labor/{articleId}';

  /**
   * Content and relevant metadata for a specific labor operation in the context of a vehicle from MCDB.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getLaborDetails()` instead.
   *
   * This method doesn't expect any request body.
   */
  getLaborDetails$Response(params: {
    contentSource: ContentSource;
    vehicleId: string;
    articleId: string;
    motorVehicleId?: string;
    prettyPrint?: boolean;
    searchTerm?: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<LaborResponse>> {

    const rb = new RequestBuilder(this.rootUrl, AssetApi.GetLaborDetailsPath, 'get');
    if (params) {
      rb.path('contentSource', params.contentSource, {});
      rb.path('vehicleId', params.vehicleId, {});
      rb.path('articleId', params.articleId, {});
      rb.query('motorVehicleId', params.motorVehicleId, {});
      rb.query('prettyPrint', params.prettyPrint, {});
      rb.query('searchTerm', params.searchTerm, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<LaborResponse>;
      })
    );
  }

  /**
   * Content and relevant metadata for a specific labor operation in the context of a vehicle from MCDB.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getLaborDetails$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getLaborDetails(params: {
    contentSource: ContentSource;
    vehicleId: string;
    articleId: string;
    motorVehicleId?: string;
    prettyPrint?: boolean;
    searchTerm?: string;
    context?: HttpContext
  }
): Observable<LaborResponse> {

    return this.getLaborDetails$Response(params).pipe(
      map((r: StrictHttpResponse<LaborResponse>) => r.body as LaborResponse)
    );
  }

  /**
   * Path part for operation getXmlById
   */
  static readonly GetXmlByIdPath = '/api/source/{contentSource}/xml/{articleId}';

  /**
   * The raw XML content of a article. Included for debugging purposes.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getXmlById()` instead.
   *
   * This method doesn't expect any request body.
   */
  getXmlById$Response(params: {
    contentSource: ContentSource;
    articleId: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<string>> {

    const rb = new RequestBuilder(this.rootUrl, AssetApi.GetXmlByIdPath, 'get');
    if (params) {
      rb.path('contentSource', params.contentSource, {});
      rb.path('articleId', params.articleId, {});
    }

    return this.http.request(rb.build({
      responseType: 'text',
      accept: 'text/plain',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<string>;
      })
    );
  }

  /**
   * The raw XML content of a article. Included for debugging purposes.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getXmlById$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getXmlById(params: {
    contentSource: ContentSource;
    articleId: string;
    context?: HttpContext
  }
): Observable<string> {

    return this.getXmlById$Response(params).pipe(
      map((r: StrictHttpResponse<string>) => r.body as string)
    );
  }

  /**
   * Path part for operation getArticleTitle
   */
  static readonly GetArticleTitlePath = '/api/source/{contentSource}/vehicle/{vehicleId}/article/{articleId}/title';

  /**
   * The title of the referenced article. For GM publication objects the article ID must include the publication_object_syskey to uniquely identify the title, which is distinct from the object_syskey that is used to retrieve the article body.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getArticleTitle()` instead.
   *
   * This method doesn't expect any request body.
   */
  getArticleTitle$Response(params: {
    contentSource: ContentSource;
    vehicleId: string;
    articleId: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<StringResponse>> {

    const rb = new RequestBuilder(this.rootUrl, AssetApi.GetArticleTitlePath, 'get');
    if (params) {
      rb.path('contentSource', params.contentSource, {});
      rb.path('vehicleId', params.vehicleId, {});
      rb.path('articleId', params.articleId, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<StringResponse>;
      })
    );
  }

  /**
   * The title of the referenced article. For GM publication objects the article ID must include the publication_object_syskey to uniquely identify the title, which is distinct from the object_syskey that is used to retrieve the article body.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getArticleTitle$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getArticleTitle(params: {
    contentSource: ContentSource;
    vehicleId: string;
    articleId: string;
    context?: HttpContext
  }
): Observable<StringResponse> {

    return this.getArticleTitle$Response(params).pipe(
      map((r: StrictHttpResponse<StringResponse>) => r.body as StringResponse)
    );
  }

  /**
   * Path part for operation getGraphicBackwardsCompatible
   */
  static readonly GetGraphicBackwardsCompatiblePath = '/api/manufacturer/{manufacturerId}/graphic/{id}';

  /**
   * Prior route for retrieving images. Do not remove, this route is referenced in saved bookmarks.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getGraphicBackwardsCompatible()` instead.
   *
   * This method doesn't expect any request body.
   *
   * @deprecated
   */
  getGraphicBackwardsCompatible$Response(params: {
    manufacturerId: string;
    id: string;
    'w'?: number;
    'h'?: number;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<void>> {

    const rb = new RequestBuilder(this.rootUrl, AssetApi.GetGraphicBackwardsCompatiblePath, 'get');
    if (params) {
      rb.path('manufacturerId', params.manufacturerId, {});
      rb.path('id', params.id, {});
      rb.query('w', params['w'], {});
      rb.query('h', params['h'], {});
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
   * Prior route for retrieving images. Do not remove, this route is referenced in saved bookmarks.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getGraphicBackwardsCompatible$Response()` instead.
   *
   * This method doesn't expect any request body.
   *
   * @deprecated
   */
  getGraphicBackwardsCompatible(params: {
    manufacturerId: string;
    id: string;
    'w'?: number;
    'h'?: number;
    context?: HttpContext
  }
): Observable<void> {

    return this.getGraphicBackwardsCompatible$Response(params).pipe(
      map((r: StrictHttpResponse<void>) => r.body as void)
    );
  }

  /**
   * Path part for operation getGraphic
   */
  static readonly GetGraphicPath = '/api/source/{contentSource}/graphic/{id}';

  /**
   * Returns the image for the provided ID. Returns a 404 with a static svg declaring that the image is not available if the image cannot be found.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getGraphic()` instead.
   *
   * This method doesn't expect any request body.
   */
  getGraphic$Response(params: {
    contentSource: ContentSource;
    id: string;
    'w'?: number;
    'h'?: number;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<void>> {

    const rb = new RequestBuilder(this.rootUrl, AssetApi.GetGraphicPath, 'get');
    if (params) {
      rb.path('contentSource', params.contentSource, {});
      rb.path('id', params.id, {});
      rb.query('w', params['w'], {});
      rb.query('h', params['h'], {});
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
   * Returns the image for the provided ID. Returns a 404 with a static svg declaring that the image is not available if the image cannot be found.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getGraphic$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getGraphic(params: {
    contentSource: ContentSource;
    id: string;
    'w'?: number;
    'h'?: number;
    context?: HttpContext
  }
): Observable<void> {

    return this.getGraphic$Response(params).pipe(
      map((r: StrictHttpResponse<void>) => r.body as void)
    );
  }

  /**
   * Path part for operation getAssetByHandleId
   */
  static readonly GetAssetByHandleIdPath = '/api/asset/{handleId}';

  /**
   * Returns an asset for the provided ID.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getAssetByHandleId()` instead.
   *
   * This method doesn't expect any request body.
   */
  getAssetByHandleId$Response(params: {
    handleId: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<void>> {

    const rb = new RequestBuilder(this.rootUrl, AssetApi.GetAssetByHandleIdPath, 'get');
    if (params) {
      rb.path('handleId', params.handleId, {});
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
   * Returns an asset for the provided ID.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getAssetByHandleId$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getAssetByHandleId(params: {
    handleId: string;
    context?: HttpContext
  }
): Observable<void> {

    return this.getAssetByHandleId$Response(params).pipe(
      map((r: StrictHttpResponse<void>) => r.body as void)
    );
  }

  /**
   * Path part for operation getMaintenanceSchedulesByFrequency
   */
  static readonly GetMaintenanceSchedulesByFrequencyPath = '/api/source/{contentSource}/vehicle/{vehicleId}/maintenanceSchedules/frequency';

  /**
   * Maintenance schedules for given VehicleId and Frequency.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getMaintenanceSchedulesByFrequency()` instead.
   *
   * This method doesn't expect any request body.
   */
  getMaintenanceSchedulesByFrequency$Response(params: {
    contentSource: ContentSource;
    vehicleId: string;
    frequencyTypeCode?: string;
    severity?: MaintenanceScheduleSeverity;
    searchTerm?: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<MaintenanceSchedulesByFrequencyResponse>> {

    const rb = new RequestBuilder(this.rootUrl, AssetApi.GetMaintenanceSchedulesByFrequencyPath, 'get');
    if (params) {
      rb.path('contentSource', params.contentSource, {});
      rb.path('vehicleId', params.vehicleId, {});
      rb.query('frequencyTypeCode', params.frequencyTypeCode, {});
      rb.query('severity', params.severity, {});
      rb.query('searchTerm', params.searchTerm, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<MaintenanceSchedulesByFrequencyResponse>;
      })
    );
  }

  /**
   * Maintenance schedules for given VehicleId and Frequency.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getMaintenanceSchedulesByFrequency$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getMaintenanceSchedulesByFrequency(params: {
    contentSource: ContentSource;
    vehicleId: string;
    frequencyTypeCode?: string;
    severity?: MaintenanceScheduleSeverity;
    searchTerm?: string;
    context?: HttpContext
  }
): Observable<MaintenanceSchedulesByFrequencyResponse> {

    return this.getMaintenanceSchedulesByFrequency$Response(params).pipe(
      map((r: StrictHttpResponse<MaintenanceSchedulesByFrequencyResponse>) => r.body as MaintenanceSchedulesByFrequencyResponse)
    );
  }

  /**
   * Path part for operation getMaintenanceSchedulesByInterval
   */
  static readonly GetMaintenanceSchedulesByIntervalPath = '/api/source/{contentSource}/vehicle/{vehicleId}/maintenanceSchedules/intervals';

  /**
   * Maintenance schedules for given VehicleId, IntervalType and Interval.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getMaintenanceSchedulesByInterval()` instead.
   *
   * This method doesn't expect any request body.
   */
  getMaintenanceSchedulesByInterval$Response(params: {
    contentSource: ContentSource;
    vehicleId: string;
    intervalType?: IntervalType;
    interval?: number;
    severity?: MaintenanceScheduleSeverity;
    searchTerm?: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<MaintenanceSchedulesByIntervalResponse>> {

    const rb = new RequestBuilder(this.rootUrl, AssetApi.GetMaintenanceSchedulesByIntervalPath, 'get');
    if (params) {
      rb.path('contentSource', params.contentSource, {});
      rb.path('vehicleId', params.vehicleId, {});
      rb.query('intervalType', params.intervalType, {});
      rb.query('interval', params.interval, {});
      rb.query('severity', params.severity, {});
      rb.query('searchTerm', params.searchTerm, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<MaintenanceSchedulesByIntervalResponse>;
      })
    );
  }

  /**
   * Maintenance schedules for given VehicleId, IntervalType and Interval.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getMaintenanceSchedulesByInterval$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getMaintenanceSchedulesByInterval(params: {
    contentSource: ContentSource;
    vehicleId: string;
    intervalType?: IntervalType;
    interval?: number;
    severity?: MaintenanceScheduleSeverity;
    searchTerm?: string;
    context?: HttpContext
  }
): Observable<MaintenanceSchedulesByIntervalResponse> {

    return this.getMaintenanceSchedulesByInterval$Response(params).pipe(
      map((r: StrictHttpResponse<MaintenanceSchedulesByIntervalResponse>) => r.body as MaintenanceSchedulesByIntervalResponse)
    );
  }

  /**
   * Path part for operation getIndicatorsWithMaintenanceSchedules
   */
  static readonly GetIndicatorsWithMaintenanceSchedulesPath = '/api/source/{contentSource}/vehicle/{vehicleId}/maintenanceSchedules/indicators';

  /**
   * Gets a summary of indicators at which maintenance schedules occur for given VehicleId.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getIndicatorsWithMaintenanceSchedules()` instead.
   *
   * This method doesn't expect any request body.
   */
  getIndicatorsWithMaintenanceSchedules$Response(params: {
    contentSource: ContentSource;
    vehicleId: string;
    severity?: MaintenanceScheduleSeverity;
    searchTerm?: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<IndicatorsWithMaintenanceSchedulesResponse>> {

    const rb = new RequestBuilder(this.rootUrl, AssetApi.GetIndicatorsWithMaintenanceSchedulesPath, 'get');
    if (params) {
      rb.path('contentSource', params.contentSource, {});
      rb.path('vehicleId', params.vehicleId, {});
      rb.query('severity', params.severity, {});
      rb.query('searchTerm', params.searchTerm, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<IndicatorsWithMaintenanceSchedulesResponse>;
      })
    );
  }

  /**
   * Gets a summary of indicators at which maintenance schedules occur for given VehicleId.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getIndicatorsWithMaintenanceSchedules$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getIndicatorsWithMaintenanceSchedules(params: {
    contentSource: ContentSource;
    vehicleId: string;
    severity?: MaintenanceScheduleSeverity;
    searchTerm?: string;
    context?: HttpContext
  }
): Observable<IndicatorsWithMaintenanceSchedulesResponse> {

    return this.getIndicatorsWithMaintenanceSchedules$Response(params).pipe(
      map((r: StrictHttpResponse<IndicatorsWithMaintenanceSchedulesResponse>) => r.body as IndicatorsWithMaintenanceSchedulesResponse)
    );
  }

}
