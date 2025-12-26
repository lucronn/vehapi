import { Injectable } from '@angular/core';
import { QueryEntity } from '@datorama/akita';
import { combineLatest, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { UserSettingsService } from '~/core/user-settings/user-settings.service';
import { ArticleDetails, FilterTabType } from '~/generated/api/models';
import { FilterTab } from '../filter-tab-names';
import { FilterTabsQuery } from './filter-tabs.query';
import { SearchResultsState, SearchResultsStore } from './search-results.store';

export type BucketArticles = {
  bucketName: string;
  bucketFilterCategory: string;
  articles: Array<ArticleDetails>;
  sort: number;
  bucketNameOverride?: string | null;
  bucketFilterTabType?: FilterTabType | null;
  isParent?: boolean | null;
  children?: Array<BucketArticles>;
};

export type BucketFilterCategory = Exclude<FilterTab, FilterTab.All>;

@Injectable({ providedIn: 'root' })
export class SearchResultsQuery extends QueryEntity<SearchResultsState> {
  constructor(private filterTabsQuery: FilterTabsQuery, protected store: SearchResultsStore, private userSettings: UserSettingsService) {
    super(store);
  }

  bucketsFilledWithArticles$: Observable<Array<BucketArticles>> = combineLatest([
    this.selectAll(),
    this.filterTabsQuery.filterTabs$,
    this.userSettings.showProcedureSilo$,
  ]).pipe(
    map(([articleDetails, filterTabs, showProcedureSilo]) => {
      let bucketList = new Array<BucketArticles>();
      
      if (!showProcedureSilo) {
        articleDetails = articleDetails?.map((item) => {
          if (item.parentBucket === 'Procedures') {
            return {
              ...item,
              bucket: 'Procedures',
              parentBucket: undefined,
            };
          }
          return item;
        });
        filterTabs = filterTabs.map((tab) => ({
          ...tab,
          buckets: tab.buckets?.map((bucket) => ({
            ...bucket,
            children: bucket.name === 'Procedures' ? [] : bucket.children,
          })),
        }));
      }

      filterTabs
        .filter((item) => item.filterTabType !== FilterTabType.All)
        ?.forEach((tab) => {
          tab.buckets?.forEach((bucket) => {
            const childrenBucketList = new Array<BucketArticles>();
            bucket.children?.forEach((childBucket) => {
              childrenBucketList.push({
                bucketName: childBucket.name ?? '',
                bucketFilterCategory: tab.name ?? '',
                articles: articleDetails?.filter((item) => item.bucket === childBucket.name) ?? [],
                sort: bucket.sort ?? 0,
                bucketNameOverride: childBucket.nameOverride,
                bucketFilterTabType: tab.filterTabType,
              });
            });
            const nonParentedArticles = articleDetails?.filter((item) => !item.parentBucket);
            bucketList.push({
              bucketName: bucket.name ?? '',
              bucketFilterCategory: tab.name ?? '',
              articles: nonParentedArticles?.filter((item) => item.bucket === bucket.name) ?? [],
              sort: bucket.sort ?? 0,
              bucketNameOverride: bucket.nameOverride,
              bucketFilterTabType: tab.filterTabType,
              isParent: bucket.children && bucket.children.length > 0,
              children: childrenBucketList,
            });
          });
        });
      bucketList = bucketList.filter(
        (bucketArticles) =>
          bucketArticles.articles.length > 0 ||
          (bucketArticles.isParent === true && bucketArticles.children?.some((item) => item.articles.length > 0))
      );
      bucketList.sort((a, b) => {
        return a.sort - b.sort;
      });
      return bucketList;
    })
  );

  filterTabsAndTheirFullBuckets$: Observable<
    Array<{
      filterTab: string;
      articlesCount?: number | null;
      buckets: Array<BucketArticles>;
      articleTrailId?: string;
      isCountUnknown?: boolean;
      filterTabType?: string;
    }>
  > = combineLatest([this.bucketsFilledWithArticles$, this.filterTabsQuery.filterTabs$]).pipe(
    map(([fullBuckets, filterTabs]) => {
      const fullBucketByFilterTab: { [key: string]: Array<BucketArticles> } = {};

      const allTab = filterTabs.find((tab) => tab.filterTabType === FilterTabType.All);

      filterTabs?.forEach((tab) => {
        fullBucketByFilterTab[tab.name ?? ''] = [];
      });

      for (const fullBucket of fullBuckets) {
        fullBucketByFilterTab[fullBucket.bucketFilterCategory]?.push(fullBucket);
        fullBucketByFilterTab[allTab?.name!]?.push(fullBucket);
      }

      const bucketCategoryArticleCount: { [key: string]: number } = {};

      for (const [category, buckets] of Object.entries(fullBucketByFilterTab)) {
        bucketCategoryArticleCount[category] = buckets.reduce((count, bucket) => {
          const childArticleCount = bucket.children?.reduce((childCount, childBucket) => childCount + childBucket.articles.length, 0) ?? 0;
          return count + bucket.articles.filter((x) => x.id !== '-999' && x.id !== '-998').length + childArticleCount;
        }, 0);
      }

      return Object.entries(fullBucketByFilterTab).map(([key, value]) => ({
        filterTab: key,
        articlesCount: bucketCategoryArticleCount[key],
        buckets: value,
        articleTrailId: filterTabs.filter((i) => i.name === key)[0].articleTrailId!,
        isCountUnknown: filterTabs.find((x) => x.name === key)?.isCountUnknown,
        filterTabType: filterTabs.find((x) => x.name === key)?.filterTabType!,
      }));
    })
  );

  filterTabCounts$: Observable<{ [key: string]: string }> = this.filterTabsAndTheirFullBuckets$.pipe(
    map((filterTabs) => {
      return filterTabs.reduce<{ [key: string]: string }>((countByName, filterTab) => {
        countByName[filterTab.filterTab] = filterTab.isCountUnknown ? '?' : filterTab.articlesCount!?.toString();
        return countByName;
      }, {});
    })
  );

  getArticleDetailById(articleId: string): Observable<ArticleDetails | undefined> {
    return this.selectEntity(articleId);
  }
}
