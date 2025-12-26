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

import { ArticleBookmarkResponse } from '../models/article-bookmark-response';
import { ArticleResponse } from '../models/article-response';
import { ContentSource } from '../models/content-source';

@Injectable({
  providedIn: 'root',
})
export class BookmarkApi extends BaseService {
  constructor(
    config: ApiConfiguration,
    http: HttpClient
  ) {
    super(config, http);
  }

  /**
   * Path part for operation saveBookmark
   */
  static readonly SaveBookmarkPath = '/api/source/{contentSource}/vehicle/{vehicleId}/article/{articleId}/bookmark';

  /**
   * Save Bookmark.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `saveBookmark()` instead.
   *
   * This method doesn't expect any request body.
   */
  saveBookmark$Response(params: {
    contentSource: ContentSource;
    vehicleId: string;
    articleId: string;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<ArticleBookmarkResponse>> {

    const rb = new RequestBuilder(this.rootUrl, BookmarkApi.SaveBookmarkPath, 'post');
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
        return r as StrictHttpResponse<ArticleBookmarkResponse>;
      })
    );
  }

  /**
   * Save Bookmark.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `saveBookmark$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  saveBookmark(params: {
    contentSource: ContentSource;
    vehicleId: string;
    articleId: string;
    context?: HttpContext
  }
): Observable<ArticleBookmarkResponse> {

    return this.saveBookmark$Response(params).pipe(
      map((r: StrictHttpResponse<ArticleBookmarkResponse>) => r.body as ArticleBookmarkResponse)
    );
  }

  /**
   * Path part for operation getBookmark
   */
  static readonly GetBookmarkPath = '/api/bookmark/{bookmarkId}';

  /**
   * Get Bookmark.
   *
   *
   *
   * This method provides access to the full `HttpResponse`, allowing access to response headers.
   * To access only the response body, use `getBookmark()` instead.
   *
   * This method doesn't expect any request body.
   */
  getBookmark$Response(params: {
    bookmarkId: number;
    context?: HttpContext
  }
): Observable<StrictHttpResponse<ArticleResponse>> {

    const rb = new RequestBuilder(this.rootUrl, BookmarkApi.GetBookmarkPath, 'get');
    if (params) {
      rb.path('bookmarkId', params.bookmarkId, {});
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
   * Get Bookmark.
   *
   *
   *
   * This method provides access to only to the response body.
   * To access the full response (for headers, for example), `getBookmark$Response()` instead.
   *
   * This method doesn't expect any request body.
   */
  getBookmark(params: {
    bookmarkId: number;
    context?: HttpContext
  }
): Observable<ArticleResponse> {

    return this.getBookmark$Response(params).pipe(
      map((r: StrictHttpResponse<ArticleResponse>) => r.body as ArticleResponse)
    );
  }

}
