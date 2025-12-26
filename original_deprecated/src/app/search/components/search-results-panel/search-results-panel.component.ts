import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, Observable, Subject } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';
import { LayoutFacade } from '~/core/state/layout.facade';
import { UserSettingsService } from '~/core/user-settings/user-settings.service';
import { ArticleDetails, FilterTabType } from '~/generated/api/models';
import { FilterTab } from '~/search/filter-tab-names';
import { SearchResultsFacade } from '~/search/state/search-results.facade';
import { BucketArticles } from '~/search/state/search-results.query';
import { filterNullish } from '~/utilities';
import { VehicleSelectionFacade } from '~/vehicle-selection/state/state/vehicle-selection.facade';

export type PossibleItemTypes = BucketHeaderItem | BucketShowAllItem | ArticleDetailsItem | ArticleDetailsList;

export interface BucketHeaderItem {
  kind: 'BucketHeader';
  bucket: string;
  isChild?: boolean;
}
export interface BucketShowAllItem {
  kind: 'BucketShowAll';
  bucket: string;
  count: number;
  isChild?: boolean;
}

export interface ArticleDetailsItem {
  kind: 'ArticleDetails';
  details: ArticleDetails;
  isChild?: boolean;
}

export interface ArticleDetailsList {
  kind: 'ArticleDetailsList';
  list: Array<ArticleDetails>;
  isChild?: boolean;
}

@Component({
  selector: 'mtr-search-results-panel',
  templateUrl: './search-results-panel.component.html',
  styleUrls: ['./search-results-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchResultsPanelComponent implements OnInit, OnDestroy {
  constructor(
    public layoutFacade: LayoutFacade,
    public searchResultsFacade: SearchResultsFacade,
    public vehicleSelectionFacade: VehicleSelectionFacade,
    public userSettingsService: UserSettingsService
  ) {}

  isCollapsedByBucket$ = new BehaviorSubject<{ [key: string]: boolean }>({});
  isShowingAllByBucket$ = new BehaviorSubject<{ [key: string]: boolean }>({});
  destroy = new Subject<void>();

  itemsToDisplay$: Observable<Array<PossibleItemTypes>> = combineLatest([
    this.searchResultsFacade.selectedFilter$.pipe(filterNullish()),
    this.searchResultsFacade.filterTabsAndTheirFullBuckets$,
    this.isCollapsedByBucket$,
    this.isShowingAllByBucket$,
  ]).pipe(
    map(([filter, tabs, isCollapsedByBucket, isShowingAllByBucket]) => {
      const tab = tabs.find((t) => t.filterTab === filter);
      const buckets = tab?.buckets || [];

      const createArticles = (articles: Array<ArticleDetails>, bucketName: string, isChild: boolean) => {
        const items: Array<PossibleItemTypes> = [];
        const showAllArticles = tab?.filterTabType !== FilterTabType.All || isShowingAllByBucket[bucketName];
        const articleSubset = showAllArticles ? articles : articles.slice(0, 15);

        if (this.hasThumbnails(articleSubset)) {
          items.push({ kind: 'ArticleDetailsList', list: articleSubset, isChild });
        } else {
          articleSubset.forEach((article) => {
            items.push({ kind: 'ArticleDetails', details: article, isChild });
          });
        }

        if (tab?.filterTabType === FilterTabType.All && articles.length > 15 && !isShowingAllByBucket[bucketName]) {
          items.push({ kind: 'BucketShowAll', bucket: bucketName, count: articles.length, isChild });
        }

        return items;
      };

      const addBucketItems = (bucket: BucketArticles, isChild: boolean = false) => {
        const bucketName = bucket.bucketNameOverride || bucket.bucketName;
        const items: Array<PossibleItemTypes> = [];
        items.push({ kind: 'BucketHeader', bucket: bucketName, isChild });

        if (!isCollapsedByBucket[bucketName]) {
          items.push(...createArticles(bucket.articles, bucketName, isChild));
        }

        return items;
      };

      return buckets.reduce<Array<PossibleItemTypes>>((prev, curr) => {
        if (curr.isParent) {
          prev.push(...addBucketItems(curr));
          const bucketName = curr.bucketNameOverride || curr.bucketName;
          if (!isCollapsedByBucket[bucketName]) {
            curr.children?.forEach((childBucket) => {
              prev.push(...addBucketItems(childBucket, true));
            });
          }
        } else {
          prev.push(...addBucketItems(curr));
        }
        return prev;
      }, []);
    })
  );

  filterTabAll = FilterTab.All;

  hasItemsToDisplay$ = this.itemsToDisplay$.pipe(map((items) => items.length > 0));
  hasSearchResultsInAllTab$ = this.searchResultsFacade.allCount$.pipe(map((count) => count > 0));

  ngOnInit(): void {
    combineLatest([
      this.searchResultsFacade.selectedFilter$.pipe(filterNullish()),
      this.searchResultsFacade.filterTabsAndTheirFullBuckets$,
      this.userSettingsService.lhNavigationDefaultMode$,
    ])
      .pipe(takeUntil(this.destroy))
      .subscribe(([filter, tabs, lhNavigationDefaultMode]) => {
        if (lhNavigationDefaultMode?.trim() === 'Collapsed') {
          const tab = tabs.find((t) => t.filterTab === filter);
          const buckets = tab?.buckets || [];
          const collapsedByBuckets: { [key: string]: boolean } = {};

          const collapseBucket = (bucket: BucketArticles) => {
            const bucketName = bucket.bucketNameOverride || bucket.bucketName;
            collapsedByBuckets[bucketName] = true;
            bucket.children?.forEach(collapseBucket);
          };

          this.isCollapsedByBucket$.next(
            buckets.reduce((acc, bucket) => {
              collapseBucket(bucket);
              return acc;
            }, collapsedByBuckets)
          );
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy.next();
    this.destroy.complete();
  }

  toggleBucketState(bucketName: string) {
    const current = this.isCollapsedByBucket$.value;
    this.isCollapsedByBucket$.next({ ...current, [bucketName]: !current[bucketName] });
  }

  showAll(bucketName: string) {
    const current = this.isShowingAllByBucket$.value;
    this.isShowingAllByBucket$.next({ ...current, [bucketName]: true });
  }

  hasThumbnails(item: Array<ArticleDetails>): boolean {
    // Buckets with thumbnails should include a thumbnail for every article so we only need to check the first one
    return Boolean(item[0]?.thumbnailHref);
  }

  trackBy(index: number, name: PossibleItemTypes): number {
    // Don't recreate DOM elements if only their content changed
    return 0;
  }
}
