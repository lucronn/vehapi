import { ErrorHandler, Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { setLoading } from '@datorama/akita';
import { RouterQuery } from '@datorama/akita-ng-router-store';
import { combineLatest, EMPTY, Observable, of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, filter, map, switchMap, tap } from 'rxjs/operators';
import { ArticleDetails, VehicleGeoBlockingDetails } from '~/generated/api/models';
import { SearchApi } from '~/generated/api/services';
import { PathParameters, QueryStringParameters } from '~/url-parameters';
import { filterNullish } from '~/utilities';
import { VehicleSelectionFacade } from '~/vehicle-selection/state/state/vehicle-selection.facade';
import { FilterTabsQuery } from './filter-tabs.query';
import { FilterTabsStore } from './filter-tabs.store';
import { SearchResultsQuery } from './search-results.query';
import { SearchResultsStore } from './search-results.store';

@Injectable({ providedIn: 'root' })
export class SearchResultsFacade implements OnDestroy {
  constructor(
    private vehicleSelectionFacade: VehicleSelectionFacade,
    private searchApi: SearchApi,
    private searchResultsQuery: SearchResultsQuery,
    private searchResultsStore: SearchResultsStore,
    private filterTabsQuery: FilterTabsQuery,
    private filterTabsStore: FilterTabsStore,
    private router: Router,
    private routerQuery: RouterQuery,
    private errorHandler: ErrorHandler
  ) {
    this.searchSubscription = combineLatest([
      this.vehicleSelectionFacade.contentSource$.pipe(filterNullish()),
      this.vehicleSelectionFacade.activeVehicleId$.pipe(filterNullish()),
      this.searchTerm$,
      this.motorVehicleId$,
    ])
      .pipe(
        debounceTime(0),
        distinctUntilChanged((a, b) => a.every((value, index) => value === b[index])), // Only execute once when contentSource and vehicleId emit new values at the same time
        tap(() => this.filterTabsStore.reset()),
        tap(() => this.searchResultsStore.reset()),
        switchMap(([contentSource, vehicleId, searchTerm, motorVehicleId]) => {
          return this.searchApi.getSearchResultsByVehicleId({ contentSource, vehicleId, searchTerm, motorVehicleId }).pipe(
            setLoading(this.searchResultsStore),
            setLoading(this.filterTabsStore),
            catchError((e) => {
              this.errorHandler.handleError(e);
              return EMPTY;
            })
          );
        })
      )
      .subscribe(({ body: entities }) => {
        this.filterTabsStore.set(entities?.filterTabs ?? []);
        this.searchResultsStore.set(entities?.articleDetails ?? []);
        this.geoBlocking$.next(entities?.vehicleGeoBlockingDetails);
      });

    // Once the search result returns set the active article and filter tab
    combineLatest([this.loading$, this.routerQuery.selectQueryParams<string | undefined>(QueryStringParameters.articleIdTrail)])
      .pipe(filter(([loading, _]) => !loading))
      .subscribe(([_, idsCsv]) => {
        this.searchResultsStore.setActive(idsCsv?.split(',')[0] ?? null);
      });
    combineLatest([this.loading$, this.selectedFilter$])
      .pipe(filter(([loading, _]) => !loading))
      .subscribe(([_, filterTabName]) => {
        filterTabsStore.setActive(filterTabName ?? null);
        const tabs = this.filterTabsQuery.getAll();
        const tab = tabs.find((t) => t.name === filterTabName);
        if (filterTabName !== undefined && !tab && tabs.length > 0) {
          this.router.navigate(['docs', tabs[0].name], { queryParamsHandling: 'preserve', replaceUrl: true });
        }
      });

    // If we're on a filter tab with a default articleId and nothing is selected, select the default
    // This comes into play after selecting a MOTOR model on Maintenance Schedules
    combineLatest([this.activeId$, this.filterTabsQuery.selectActive()])
      .pipe(debounceTime(0))
      .subscribe(([articleId, activeFilterTab]) => {
        if (!articleId && activeFilterTab?.articleTrailId) {
          this.router.navigate([], {
            queryParams: {
              [QueryStringParameters.articleIdTrail]: activeFilterTab.articleTrailId,
            },
            queryParamsHandling: 'merge',
            replaceUrl: true,
          });
        }
      });
  }
  geoBlocking$ = new Subject<VehicleGeoBlockingDetails>();

  searchSubscription: Subscription;

  activeId$ = this.searchResultsQuery.selectActiveId();
  active$ = this.searchResultsQuery.selectActive();
  all$ = this.searchResultsQuery.selectAll();
  allCount$ = this.searchResultsQuery.selectCount();
  loading$ = this.searchResultsQuery.selectLoading();

  bucketsFilledWithArticles$ = this.searchResultsQuery.bucketsFilledWithArticles$;
  filterTabsAndTheirFullBuckets$ = this.searchResultsQuery.filterTabsAndTheirFullBuckets$;
  filterTabCounts$ = this.searchResultsQuery.filterTabCounts$;

  filterTabs$ = this.filterTabsQuery.filterTabs$;

  selectedFilter$ = this.routerQuery.selectParams<string | undefined>(PathParameters.filterTab);

  searchTerm$ = this.routerQuery.selectQueryParams<string | undefined>(QueryStringParameters.searchTerm).pipe(
    map((searchTerm) => searchTerm ?? ''),
    distinctUntilChanged()
  );

  motorVehicleId$ = this.routerQuery.selectQueryParams<string | undefined>(QueryStringParameters.motorVehicleId);

  displayRestrictedContentAlert$: Observable<VehicleGeoBlockingDetails> = this.geoBlocking$.pipe((data) => {
    return data;
  });

  getAll() {
    return this.searchResultsQuery.getAll();
  }

  activateArticle(doc: ArticleDetails): void {
    this.router.navigate([], {
      queryParams: {
        [QueryStringParameters.articleIdTrail]: doc.id,
        [QueryStringParameters.bookmarkId]: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  search(searchTerm?: string): void {
    this.router.navigate([], {
      queryParams: {
        [QueryStringParameters.searchTerm]: searchTerm,
        [QueryStringParameters.articleIdTrail]: null,
        [QueryStringParameters.bookmarkId]: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  ngOnDestroy(): void {
    this.searchSubscription.unsubscribe();
  }
}
