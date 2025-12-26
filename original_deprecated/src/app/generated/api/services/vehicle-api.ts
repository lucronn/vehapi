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
import { GetVehiclesRequest } from '../models/get-vehicles-request';
import { Int32ListResponse } from '../models/int-32-list-response';
import { MakeListResponse } from '../models/make-list-response';
import { ModelAndVehicleIdListResponse } from '../models/model-and-vehicle-id-list-response';
import { ModelsResponseResponse } from '../models/models-response-response';
import { StringResponse } from '../models/string-response';
import { VinVehicleResponseResponse } from '../models/vin-vehicle-response-response';

@Injectable({
  providedIn: 'root',
})
export class VehicleApi extends BaseService {
  constructor(
    config: ApiConfiguration,
    http: HttpClient
  ) {
    super(config, http);
  }

  /**
   * Path part for operation getYears
   */
  static readonly GetYearsPath = '/api/years';

  /**
   * Get Years.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getYears()` instead.
   *
   * This method doesn't expect any request body.
   */
  getYears$Response(params?: {
    context?: HttpContext
  }
): Observable<StrictHttpResponse<Int32ListResponse>> {

    const rb = new RequestBuilder(this.rootUrl, VehicleApi.GetYearsPath, 'get');
    if (params) {
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<Int32ListResponse>;
      })
    );
  }

  /**
   * Get Years.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getYears$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getYears(params?: {
    context?: HttpContext
  }
): Observable<Int32ListResponse> {

    return this.getYears$Response(params).pipe(
      map((r: StrictHttpResponse<Int32ListResponse>) => r.body as Int32ListResponse)
    );
  }

  /**
   * Path part for operation getMakes
   */
  static readonly GetMakesPath = '/api/year/{year}/makes';

  /**
   * Get Makes.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getMakes()` instead.
   *
   * This method doesn't expect any request body.
   */
  getMakes$Response(params: {
    year: number;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<MakeListResponse>> {

    const rb = new RequestBuilder(this.rootUrl, VehicleApi.GetMakesPath, 'get');
    if (params) {
      rb.path('year', params.year, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<MakeListResponse>;
      })
    );
  }

  /**
   * Get Makes.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getMakes$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getMakes(params: {
    year: number;
    context?: HttpContext
  }
): Observable<MakeListResponse> {

    return this.getMakes$Response(params).pipe(
      map((r: StrictHttpResponse<MakeListResponse>) => r.body as MakeListResponse)
    );
  }

  /**
   * Path part for operation getModels
   */
  static readonly GetModelsPath = '/api/year/{year}/make/{make}/models';

  /**
   * All vehicles matching the provided year and make.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getModels()` instead.
   *
   * This method doesn't expect any request body.
   */
  getModels$Response(params: {
    year: number;
    make: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<ModelsResponseResponse>> {

    const rb = new RequestBuilder(this.rootUrl, VehicleApi.GetModelsPath, 'get');
    if (params) {
      rb.path('year', params.year, {});
      rb.path('make', params.make, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<ModelsResponseResponse>;
      })
    );
  }

  /**
   * All vehicles matching the provided year and make.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getModels$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getModels(params: {
    year: number;
    make: string;
    context?: HttpContext
  }
): Observable<ModelsResponseResponse> {

    return this.getModels$Response(params).pipe(
      map((r: StrictHttpResponse<ModelsResponseResponse>) => r.body as ModelsResponseResponse)
    );
  }

  /**
   * Path part for operation getVehicleByVin
   */
  static readonly GetVehicleByVinPath = '/api/vin/{vin}/vehicle';

  /**
   * Vehicle matching the provided VIN.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getVehicleByVin()` instead.
   *
   * This method doesn't expect any request body.
   */
  getVehicleByVin$Response(params: {
    vin: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<VinVehicleResponseResponse>> {

    const rb = new RequestBuilder(this.rootUrl, VehicleApi.GetVehicleByVinPath, 'get');
    if (params) {
      rb.path('vin', params.vin, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<VinVehicleResponseResponse>;
      })
    );
  }

  /**
   * Vehicle matching the provided VIN.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getVehicleByVin$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getVehicleByVin(params: {
    vin: string;
    context?: HttpContext
  }
): Observable<VinVehicleResponseResponse> {

    return this.getVehicleByVin$Response(params).pipe(
      map((r: StrictHttpResponse<VinVehicleResponseResponse>) => r.body as VinVehicleResponseResponse)
    );
  }

  /**
   * Path part for operation getMotorModels
   */
  static readonly GetMotorModelsPath = '/api/motor/year/{year}/make/{make}/models';

  /**
   * All motor vehicles matching the provided year and make.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getMotorModels()` instead.
   *
   * This method doesn't expect any request body.
   */
  getMotorModels$Response(params: {
    year: number;
    make: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<ModelAndVehicleIdListResponse>> {

    const rb = new RequestBuilder(this.rootUrl, VehicleApi.GetMotorModelsPath, 'get');
    if (params) {
      rb.path('year', params.year, {});
      rb.path('make', params.make, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<ModelAndVehicleIdListResponse>;
      })
    );
  }

  /**
   * All motor vehicles matching the provided year and make.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getMotorModels$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getMotorModels(params: {
    year: number;
    make: string;
    context?: HttpContext
  }
): Observable<ModelAndVehicleIdListResponse> {

    return this.getMotorModels$Response(params).pipe(
      map((r: StrictHttpResponse<ModelAndVehicleIdListResponse>) => r.body as ModelAndVehicleIdListResponse)
    );
  }

  /**
   * Path part for operation getVehiclesDeprecated
   */
  static readonly GetVehiclesDeprecatedPath = '/api/source/{contentSource}/vehicles';

  /**
   * Model information for a list of vehicle IDs.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getVehiclesDeprecated()` instead.
   *
   * This method doesn't expect any request body.
   *
   * @deprecated
   */
  getVehiclesDeprecated$Response(params: {
    contentSource: ContentSource;
    vehicleIds?: Array<string>;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<ModelAndVehicleIdListResponse>> {

    const rb = new RequestBuilder(this.rootUrl, VehicleApi.GetVehiclesDeprecatedPath, 'get');
    if (params) {
      rb.path('contentSource', params.contentSource, {});
      rb.query('vehicleIds', params.vehicleIds, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<ModelAndVehicleIdListResponse>;
      })
    );
  }

  /**
   * Model information for a list of vehicle IDs.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getVehiclesDeprecated$Response()` instead.
   *
   * This method doesn't expect any request body.
   *
   * @deprecated
   */
  getVehiclesDeprecated(params: {
    contentSource: ContentSource;
    vehicleIds?: Array<string>;
    context?: HttpContext
  }
): Observable<ModelAndVehicleIdListResponse> {

    return this.getVehiclesDeprecated$Response(params).pipe(
      map((r: StrictHttpResponse<ModelAndVehicleIdListResponse>) => r.body as ModelAndVehicleIdListResponse)
    );
  }

  /**
   * Path part for operation getVehicles
   */
  static readonly GetVehiclesPath = '/api/source/{contentSource}/vehicles';

  /**
   * Model information for a list of vehicle IDs.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getVehicles()` instead.
   *
   * This method sends `application/*+json` and handles request body of type `application/*+json`.
   */
  getVehicles$Response(params: {
    contentSource: ContentSource;
    context?: HttpContext
    body?: GetVehiclesRequest
  }
): Observable<StrictHttpResponse<ModelAndVehicleIdListResponse>> {

    const rb = new RequestBuilder(this.rootUrl, VehicleApi.GetVehiclesPath, 'post');
    if (params) {
      rb.path('contentSource', params.contentSource, {});
      rb.body(params.body, 'application/*+json');
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<ModelAndVehicleIdListResponse>;
      })
    );
  }

  /**
   * Model information for a list of vehicle IDs.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getVehicles$Response()` instead.
   *
   * This method sends `application/*+json` and handles request body of type `application/*+json`.
   */
  getVehicles(params: {
    contentSource: ContentSource;
    context?: HttpContext
    body?: GetVehiclesRequest
  }
): Observable<ModelAndVehicleIdListResponse> {

    return this.getVehicles$Response(params).pipe(
      map((r: StrictHttpResponse<ModelAndVehicleIdListResponse>) => r.body as ModelAndVehicleIdListResponse)
    );
  }

  /**
   * Path part for operation getMotorVehicleDetails
   */
  static readonly GetMotorVehicleDetailsPath = '/api/source/{contentSource}/{vehicleId}/motorvehicles';

  /**
   * Motor vehicle details for different OEs vehicle IDs.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getMotorVehicleDetails()` instead.
   *
   * This method doesn't expect any request body.
   */
  getMotorVehicleDetails$Response(params: {
    contentSource: ContentSource;
    vehicleId: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<ModelAndVehicleIdListResponse>> {

    const rb = new RequestBuilder(this.rootUrl, VehicleApi.GetMotorVehicleDetailsPath, 'get');
    if (params) {
      rb.path('contentSource', params.contentSource, {});
      rb.path('vehicleId', params.vehicleId, {});
    }

    return this.http.request(rb.build({
      responseType: 'json',
      accept: 'application/json',
      context: params?.context
    })).pipe(
      filter((r: any) => r instanceof HttpResponse),
      map((r: HttpResponse<any>) => {
        return r as StrictHttpResponse<ModelAndVehicleIdListResponse>;
      })
    );
  }

  /**
   * Motor vehicle details for different OEs vehicle IDs.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getMotorVehicleDetails$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getMotorVehicleDetails(params: {
    contentSource: ContentSource;
    vehicleId: string;
    context?: HttpContext
  }
): Observable<ModelAndVehicleIdListResponse> {

    return this.getMotorVehicleDetails$Response(params).pipe(
      map((r: StrictHttpResponse<ModelAndVehicleIdListResponse>) => r.body as ModelAndVehicleIdListResponse)
    );
  }

  /**
   * Path part for operation getVehicleName
   */
  static readonly GetVehicleNamePath = '/api/source/{contentSource}/{vehicleId}/name';

  /**
   * Vehicle name by vehicle IDs.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getVehicleName()` instead.
   *
   * This method doesn't expect any request body.
   */
  getVehicleName$Response(params: {
    contentSource: ContentSource;
    vehicleId: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<StringResponse>> {

    const rb = new RequestBuilder(this.rootUrl, VehicleApi.GetVehicleNamePath, 'get');
    if (params) {
      rb.path('contentSource', params.contentSource, {});
      rb.path('vehicleId', params.vehicleId, {});
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
   * Vehicle name by vehicle IDs.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getVehicleName$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getVehicleName(params: {
    contentSource: ContentSource;
    vehicleId: string;
    context?: HttpContext
  }
): Observable<StringResponse> {

    return this.getVehicleName$Response(params).pipe(
      map((r: StrictHttpResponse<StringResponse>) => r.body as StringResponse)
    );
  }

}
