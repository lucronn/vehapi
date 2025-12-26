import { HttpParams } from '@angular/common/http';
import { ErrorHandler, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { setLoading } from '@datorama/akita';
import { RouterQuery } from '@datorama/akita-ng-router-store';
import { combineLatest, Observable, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap, take, tap } from 'rxjs/operators';
import { ContentSource, PartLineItem } from '~/generated/api/models';
import { AssetApi, BookmarkApi, PartsApi, VehicleApi } from '~/generated/api/services';
import { SearchResultsFacade } from '~/search/state/search-results.facade';
import { SearchResultsQuery } from '~/search/state/search-results.query';
import { QueryStringParameters } from '~/url-parameters';
import { LicenseMessage } from '~/vehicle-license-message';
import { VehicleSelectionFacade } from '~/vehicle-selection/state/state/vehicle-selection.facade';
import { LaborQuery, LeafAssetsQuery, RootAssetsQuery, VehiclePartsQuery } from './assets.query';
import { AssetsState, LaborStore, LeafAssetsStore, RootAssetsStore, VehiclePartsStore } from './assets.store';

@Injectable({ providedIn: 'root' })
export class AssetsFacade {
  constructor(
    private rootAssetsStore: RootAssetsStore,
    private rootAssetsQuery: RootAssetsQuery,
    private leafAssetsStore: LeafAssetsStore,
    private leafAssetsQuery: LeafAssetsQuery,
    private assetsApi: AssetApi,
    private bookmarkApi: BookmarkApi,
    private vehicleSelectionFacade: VehicleSelectionFacade,
    private routerQuery: RouterQuery,
    private router: Router,
    private errorHandler: ErrorHandler,
    public searchResultsFacade: SearchResultsFacade,
    private partsSearchApi: PartsApi,
    private laborStore: LaborStore,
    private laborQuery: LaborQuery,
    private vehiclePartsStore: VehiclePartsStore,
    private vehiclePartsQuery: VehiclePartsQuery,
    private searchResultsQuery: SearchResultsQuery
  ) {
    this.requestArticleOnIdChange({ isRoot: true });
    this.requestArticleOnIdChange({ isRoot: false });
    this.requestLaborArticlesOnIdChange();

    this.vehiclePartsApiTrigger$.subscribe();
  }

  motorVehicleId$ = this.routerQuery.selectQueryParams<string | undefined>(QueryStringParameters.motorVehicleId).pipe(
    map((id) => id),
    distinctUntilChanged()
  );
  selectedPartItems?: Array<PartLineItem>;

  labor$ = this.laborQuery.select().pipe(map((labor) => (labor.mainOperation ? labor : undefined)));

  vehicleParts$ = this.vehiclePartsQuery.selectAll();

  toyotaLicenseMessage = LicenseMessage.ToyotaLicenseMessage;

  vehiclePartsApiTrigger$ = combineLatest([
    this.vehicleSelectionFacade.contentSource$,
    this.vehicleSelectionFacade.activeVehicleId$,
    this.motorVehicleId$,
  ]).pipe(
    tap(() => {
      this.vehiclePartsStore.reset();
    }),
    debounceTime(0),
    switchMap(([contentSource, vehicleId, motorVehicleId]) => {
      if (contentSource === undefined || !vehicleId || (contentSource !== ContentSource.Motor && !motorVehicleId)) return of([]);
      return this.partsSearchApi
        .getPartsForVehicle({ contentSource, vehicleId, motorVehicleId })
        .pipe(map((response) => this.vehiclePartsStore.set(response.body ?? [])));
    })
  );

  articleIds$: Observable<Array<string>> = this.routerQuery
    .selectQueryParams<string | undefined>(QueryStringParameters.articleIdTrail)
    .pipe(map((csvIds) => (csvIds ? csvIds.split(',') : [])));

  activeArticleId$: Observable<string | undefined> = this.articleIds$.pipe(
    map((ids) => ids[ids.length - 1]),
    distinctUntilChanged()
  );
  bookmarkId$: Observable<string | undefined> = this.routerQuery.selectQueryParams(QueryStringParameters.bookmarkId);

  hasContentId$: Observable<boolean> = this.activeArticleId$.pipe(map((articleId) => articleId !== undefined));
  hasBreadcrumb$: Observable<boolean> = this.articleIds$.pipe(map((ids) => ids.length > 1));

  base64Pdf$: Observable<string | undefined> = this.rootAssetsQuery.select((state) => state.base64Pdf);

  rootId$: Observable<string | undefined> = this.articleIds$.pipe(
    map((ids) => ids[0]),
    distinctUntilChanged()
  );
  rootLoading$ = this.rootAssetsQuery.selectLoading();
  rootHtml$ = this.rootAssetsQuery.select((state) => state.html);
  rootHtmlIsFullPage$ = this.rootHtml$.pipe(map((html) => this.isFullHtmlPage(html)));
  rootError$ = this.rootAssetsQuery.selectError();
  laborError$ = this.laborQuery.selectError();

  leafId$: Observable<string | undefined> = this.articleIds$.pipe(
    map((ids) => (ids.length <= 1 ? undefined : ids[ids.length - 1])),
    distinctUntilChanged()
  );
  leafLoading$ = this.leafAssetsQuery.selectLoading();
  leafHtml$ = this.leafAssetsQuery.select((state) => state.html);
  leafbase64Pdf$ = this.leafAssetsQuery.select((state) => state.base64Pdf);
  leafHtmlIsFullPage$ = this.leafHtml$.pipe(map((html) => this.isFullHtmlPage(html)));
  leafError$ = this.leafAssetsQuery.selectError();

  isBookmarkOutdated$ = this.rootAssetsQuery.select((state) => state.isOutdated);

  activeDocumentId$ = combineLatest([
    this.rootAssetsQuery.select((state) => state.documentId),
    this.leafAssetsQuery.select((state) => state.documentId),
  ]).pipe(map(([rootDocumentId, leafDocumentId]) => leafDocumentId ?? rootDocumentId));

  activeCreatedDate$ = combineLatest([
    this.rootAssetsQuery.select((state) => state.createdDate),
    this.leafAssetsQuery.select((state) => state.createdDate),
  ]).pipe(map(([rootCreatedDate, leafCreatedDate]) => leafCreatedDate ?? rootCreatedDate));

  activePublishedDate$ = combineLatest([
    this.rootAssetsQuery.select((state) => state.publishedDate),
    this.leafAssetsQuery.select((state) => state.publishedDate),
    this.activeArticleId$,
    this.leafId$,
  ]).pipe(
    map(([rootPublishedDate, leafPublishedDate, activeArticleId, leafId]) => (activeArticleId === leafId ? leafPublishedDate : rootPublishedDate))
  );

  activeContentSilos$ = combineLatest([
    this.rootAssetsQuery.select((state) => state.contentSilos),
    this.leafAssetsQuery.select((state) => state.contentSilos),
  ]).pipe(map(([rootContentSilos, leafContentSilos]) => leafContentSilos ?? rootContentSilos));

  activeSourceSilos$ = combineLatest([
    this.rootAssetsQuery.select((state) => state.sourceSilos),
    this.leafAssetsQuery.select((state) => state.sourceSilos),
  ]).pipe(map(([rootSourceSilos, leafSourceSilos]) => leafSourceSilos ?? rootSourceSilos));

  isMaintenanceScheduleTab$ = this.articleIds$.pipe(
    map((articleIds) => {
      return articleIds[0] === '-998' || articleIds[0] === '-997';
    })
  );

  isLaborTab$ = this.articleIds$.pipe(
    map((articleIds) => {
      return articleIds.length > 0 && (articleIds[0] === '-999' || articleIds[0].startsWith('L:'));
    })
  );

  showLicenseMessageForToyota$ = combineLatest([
    this.isLaborTab$,
    this.isMaintenanceScheduleTab$,
    this.vehicleSelectionFacade.contentSource$,
    this.vehicleSelectionFacade.activeVehicleId$,
  ]).pipe(
    debounceTime(300),
    switchMap(([isLaborTab, isPMSST, contentSource, vehicleSelected]) => {
      if (!vehicleSelected) {
        return of(false);
      }
      if (contentSource === ContentSource.Toyota) {
        return of(!isLaborTab && !isPMSST);
      }
      if (contentSource === ContentSource.Motor) {
        const makesUnderToyota = ['Toyota', 'Scion', 'Lexus'];
        return this.vehicleSelectionFacade.getVehicleYMM(contentSource, vehicleSelected).pipe(
          map((nameResponse) => !isLaborTab && !isPMSST && makesUnderToyota.some((x) => nameResponse?.includes(x))),
          catchError(() => of(false))
        );
      }
      return of(false);
    })
  );

  customSearchFn(term: string, item: PartLineItem) {
    term = term.toLowerCase();
    return (
      item.partDescription!.toLowerCase().indexOf(term) > -1 || item.partNumber!.replace(/\s|\-/g, '').toLowerCase() === term.replace(/\s|\-/g, '')
    );
  }

  onPartSelected() {
    const newParts = this.selectedPartItems?.map((part) => ({ ...part, isAdded: true }));
    if (newParts) {
      this.laborStore.update((state) => {
        return { ...state, mainOperation: { ...state.mainOperation, parts: [...state.mainOperation.parts, ...newParts] } };
      });
      this.selectedPartItems = [];
    }
  }

  onPartDelete(index: number) {
    const laborStoreData = this.laborStore.getValue();
    const laborParts = [...laborStoreData.mainOperation.parts];
    if (index >= 0) {
      laborParts.splice(index, 1);
      this.laborStore.update((state) => {
        return { ...state, mainOperation: { ...state.mainOperation, parts: [...laborParts] } };
      });
    }
  }

  requestLaborArticlesOnIdChange() {
    const articleId$ = this.rootId$;

    combineLatest([
      this.vehicleSelectionFacade.contentSource$,
      this.vehicleSelectionFacade.activeVehicleId$,
      articleId$,
      this.bookmarkId$,
      this.motorVehicleId$,
      this.searchResultsFacade.searchTerm$,
    ])
      .pipe(
        debounceTime(0), // Only execute once if multiple values change at the same time
        tap(() => {
          this.laborStore.reset();
        }),
        switchMap(([contentSource, vehicleId, articleId, bookmarkId, motorVehicleId, searchTerm]) => {
          // An articleId should always be set when there is a bookmarkId
          if (contentSource === undefined || !vehicleId || !articleId || articleId.indexOf('L:') !== 0) return of(undefined);
          return this.assetsApi.getLaborDetails({ contentSource, vehicleId, articleId, motorVehicleId, searchTerm }).pipe(
            setLoading(this.laborStore),
            tap(() => this.laborStore.setError(undefined)),
            catchError((e) => {
              this.laborStore.setError(e);
              this.errorHandler.handleError(e);
              return of(undefined);
            })
          );
        }),
        catchError(() => of(undefined))
      )
      .subscribe((laborResponse) => {
        const laborData = laborResponse?.body;
        if (laborData) {
          this.laborStore.update(laborData);
          this.rootAssetsStore.update({ documentId: laborData.mainOperation.id?.toString() });
        }
      });
  }

  getActiveHtml() {
    return this.leafAssetsQuery.getValue().html || this.rootAssetsQuery.getValue().html;
  }

  getArticleIds(): Array<string> {
    let articleIds = Array.of<string>();
    this.articleIds$.pipe(take(1)).subscribe((ids) => (articleIds = ids));
    return articleIds;
  }

  getRootId(): string | undefined {
    let rootId: string | undefined;
    this.rootId$.pipe(take(1)).subscribe((ids) => (rootId = ids));
    return rootId;
  }

  requestArticleOnIdChange(params: { isRoot: boolean }) {
    const articleId$ = params.isRoot ? this.rootId$ : this.leafId$;
    const storeToUpdate: LeafAssetsStore | RootAssetsStore = params.isRoot ? this.rootAssetsStore : this.leafAssetsStore;

    combineLatest([
      this.vehicleSelectionFacade.contentSource$,
      this.vehicleSelectionFacade.activeVehicleId$,
      articleId$,
      this.bookmarkId$,
      this.motorVehicleId$,
      this.searchResultsFacade.searchTerm$
    ])
      .pipe(
        debounceTime(0), // Only execute once if multiple values change at the same time
        tap(() => {
          storeToUpdate.reset();
        }),
        switchMap(([contentSource, vehicleId, articleId, bookmarkId, motorVehicleId, searchTerm]) => {
            if (
              contentSource === undefined ||
              !vehicleId ||
              !articleId ||
              articleId === '-997' ||
              articleId === '-998' ||
              articleId === '-999' ||
              articleId.indexOf('L:') === 0
            ) {
              // Return an empty Observable explicitly when the condition is invalid
              return of(undefined);
            }
            return this.searchResultsQuery.getArticleDetailById(articleId).pipe(
              take(1),
              switchMap((articleDetails) => {
                const bucketName = articleDetails?.parentBucket ? articleDetails.parentBucket : articleDetails?.bucket;
                return this.requestArticle({
                  contentSource,
                  vehicleId,
                  articleId,
                  bookmarkId,
                  isRoot: params.isRoot,
                  motorVehicleId,
                  bucketName,
                  articleSubtype: articleDetails?.parentBucket === 'Procedures' ? articleDetails.bucket : undefined,
                  searchTerm
                });
              }),
              catchError((e) => {
                storeToUpdate.setError(e);
                this.errorHandler.handleError(e);
                return of(undefined);
              }),
            );
          }
        )
      )
      .subscribe((assetState) => {
        if (assetState) {
          storeToUpdate.update(assetState);
        }
      });
  }

  requestArticle(params: {
    contentSource: ContentSource;
    vehicleId: string;
    articleId: string;
    bookmarkId?: string;
    isRoot: boolean;
    motorVehicleId?: string;
    bucketName?: string | null;
    articleSubtype?: string | null;
    searchTerm?: string | null;
  }): Observable<AssetsState> {
    const getRequest$ =
      params.bookmarkId !== undefined && params.isRoot
        ? this.bookmarkApi.getBookmark({ bookmarkId: +params.bookmarkId })
        : this.assetsApi.getArticleById({
            contentSource: params.contentSource,
            vehicleId: params.vehicleId,
            articleId: params.articleId,
            motorVehicleId: params.motorVehicleId,
            bucketName: params.bucketName ?? '',
            articleSubtype: params.articleSubtype ?? '',
            searchTerm: params.searchTerm ?? '',
          });

    return getRequest$.pipe<AssetsState>(
      map(({ body: result }) => {
        const idsToCurrentArticle = params.isRoot ? this.getArticleIds().slice(0, 1) : this.getArticleIds();
        const currentQueryParams = this.routerQuery.getQueryParams() as { [_: string]: any };
        const html = result?.html
          ?.replace(/<mtr-doc-link id=['"](.*?)['"]>([\s\S]*?)<\/mtr-doc-link>/g, ($0, id: string, innerHtml: string) => {
            const navigationAttributes = this.calculateNavigationAttributesForId(id, idsToCurrentArticle, currentQueryParams);
            return `<a ${navigationAttributes}>${innerHtml}</a>`;
          })
          .replace(/<mtr-image-link id='(.*?)'([^>]*)>([^<]*)<\/mtr-image-link>/g, ($0, id: string, extraAttributes: string, text: string) => {
            return `<span class='image-hover'>${text}<img src='api/source/${params.contentSource}/graphic/${id}'${extraAttributes} loading='lazy'></span>`;
          })
          .replace(/<mtr-image id='(.*?)'([^>]*)><\/mtr-image>/g, ($0, id: string, extraAttributes: string) => {
            return `<img src='api/source/${params.contentSource}/graphic/${id}'${extraAttributes}>`;
          })
          .replace(/<mtr-area id=['"](.*?)['"]([^>]*)>([^<]*)<\/mtr-area>/g, ($0, id: string, extraAttributes: string, innerHtml: string) => {
            const navigationAttributes = this.calculateNavigationAttributesForId(id, idsToCurrentArticle, currentQueryParams);
            return `<area ${navigationAttributes}${extraAttributes}>${innerHtml}</area>`;
          });

        return {
          html,
          base64Pdf: result?.pdf,
          documentId: result?.documentId,
          publishedDate: result?.publishedDate,
          createdDate: result?.releaseDate,
          isOutdated: result?.isOutdated,
          contentSilos: result?.contentSilos,
          sourceSilos: result?.sourceSilos,
        };
      })
    );
  }

  calculateNavigationAttributesForId(id: string, idsToCurrentArticle: Array<string>, currentQueryParams: { [_: string]: any }) {
    // Don't reload an article if the link is to itself
    const nextArticleIds = idsToCurrentArticle[idsToCurrentArticle.length - 1] === id ? idsToCurrentArticle : [...idsToCurrentArticle, id];

    const newQueryParameters = { [QueryStringParameters.articleIdTrail]: nextArticleIds.join(',') };
    const mergedQueryParameters = new HttpParams({
      fromObject: { ...currentQueryParams, ...newQueryParameters },
    });
    // Add a best effort href to support standard browser behavior such as middle clicking and showing the destination url on hover. In the standard case of left click the HrefRoutingDirective will solely use the merge-query-params data using angular native routing.
    return `href="${location.pathname}?${mergedQueryParameters.toString()}" merge-query-params='${JSON.stringify(newQueryParameters)}'`;
  }

  /** Closes the modal if it is enabled. */
  showRootArticle() {
    let rootId: string | undefined;
    this.rootId$.pipe(take(1)).subscribe((id) => (rootId = id));
    if (rootId !== undefined) {
      this.router.navigate([], { queryParams: { [QueryStringParameters.articleIdTrail]: rootId }, queryParamsHandling: 'merge' });
    }
  }

  private isFullHtmlPage(html: string | undefined): boolean {
    return Boolean(html?.match(/^(\s|\r|\n)*(<!(DOCTYPE|doctype)[^>]*>(\s|\r|\n)*)?<(HTML|html)/));
  }
}
