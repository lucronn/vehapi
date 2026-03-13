import { Injectable, computed, inject, signal } from '@angular/core';
import { Article, FilterTab, FilterTabType, BucketArticles, Bucket } from '../models/motor.models';
import { MotorApiService } from './motor-api.service';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class SearchResultsState {
    private motorApi = inject(MotorApiService);

    // State
    readonly articleDetails = signal<Article[]>([]);
    readonly filterTabs = signal<FilterTab[]>([]);
    readonly normalizedMenu = signal<any | null>(null);
    readonly isLoading = signal<boolean>(false);
    readonly error = signal<string | null>(null);

    // User Settings (Placeholder for now, assuming defaulting to true/false as appropriate)
    readonly showProcedureSilo = signal<boolean>(true);

    /**
     * Core Bucketing Logic
     * Mirrors legacy SearchResultsQuery.bucketsFilledWithArticles$
     */
    readonly bucketsFilledWithArticles = computed(() => {
        let articles = this.articleDetails();
        let tabs = this.filterTabs();
        const showProceduresInSilo = this.showProcedureSilo();

        if (!showProceduresInSilo) {
            // Flatten procedure silo logic
            articles = articles.map((item) => {
                if (item.parentBucket === 'Procedures') {
                    return {
                        ...item,
                        bucket: 'Procedures',
                        parentBucket: undefined,
                    };
                }
                return item;
            });
            tabs = tabs.map((tab) => ({
                ...tab,
                buckets: tab.buckets?.map((bucket) => ({
                    ...bucket,
                    // Clear BOTH fields so flattening works regardless of API shape
                    children: bucket.name === 'Procedures' ? [] : (bucket.children ?? bucket.buckets ?? []),
                    buckets: bucket.name === 'Procedures' ? [] : undefined,
                })),
            }));
        }

        let bucketList: BucketArticles[] = [];

        // Optimization: Group articles by bucket for O(1) lookup
        const articlesByBucket = new Map<string, Article[]>();
        for (const article of articles) {
            const bucketName = article.bucket;
            // Handle null/undefined but allow empty string
            if (bucketName === null || bucketName === undefined) continue;

            let list = articlesByBucket.get(bucketName);
            if (!list) {
                list = [];
                articlesByBucket.set(bucketName, list);
            }
            list.push(article);
        }

        tabs
            .filter((item) => item.filterTabType !== 'All')
            .forEach((tab) => {
                tab.buckets?.forEach((bucket) => {
                    const childrenBucketList: BucketArticles[] = [];

                    // Normalize: legacy API uses 'buckets', new shape uses 'children'
                    const childBuckets = bucket.children ?? bucket.buckets ?? [];

                    childBuckets.forEach((childBucket) => {
                        // Use slice() to create a copy, ensuring immutability like .filter()
                        const childArticles = (articlesByBucket.get(childBucket.name ?? '') ?? []).slice();
                        childrenBucketList.push({
                            bucketName: childBucket.name ?? '',
                            bucketFilterCategory: tab.name ?? '',
                            articles: childArticles,
                            sort: bucket.sort ?? 0,
                            bucketNameOverride: childBucket.nameOverride,
                            bucketFilterTabType: tab.filterTabType,
                        });
                    });

                    // Parent bucket articles: must have bucket == bucket.name AND !parentBucket
                    const allBucketArticles = articlesByBucket.get(bucket.name ?? '') ?? [];
                    const parentArticles = allBucketArticles.filter(a => !a.parentBucket);

                    bucketList.push({
                        bucketName: bucket.name ?? '',
                        bucketFilterCategory: tab.name ?? '',
                        articles: parentArticles,
                        sort: bucket.sort ?? 0,
                        bucketNameOverride: bucket.nameOverride,
                        bucketFilterTabType: tab.filterTabType,
                        isParent: childBuckets.length > 0,
                        children: childrenBucketList,
                    });
                });
            });

        // Filter out empty buckets, BUT preserve important categories even if empty
        // This ensures Diagnostics/DTCs always show up in Browse All even if no articles yet loaded
        const importantBuckets = ['Diagnostics', 'Diagnostic Trouble Codes', 'DTCs', 'Fault Codes'];

        bucketList = bucketList.filter(
            (bucketArticles) => {
                const hasArticles = bucketArticles.articles.length > 0 ||
                    (bucketArticles.isParent === true && bucketArticles.children?.some((item) => item.articles.length > 0));

                const isImportantCategory = importantBuckets.includes(bucketArticles.bucketName) ||
                    importantBuckets.includes(bucketArticles.bucketFilterCategory);

                return hasArticles || isImportantCategory;
            }
        );

        // Sort
        bucketList.sort((a, b) => a.sort - b.sort);

        return bucketList;
    });

    /**
     * Final Structure for UI
     * Mirrors legacy SearchResultsQuery.filterTabsAndTheirFullBuckets$
     */
    readonly filterTabsAndTheirFullBuckets = computed(() => {
        const fullBuckets = this.bucketsFilledWithArticles();
        const headers = this.filterTabs();

        const fullBucketByFilterTab: { [key: string]: BucketArticles[] } = {};
        const allTab = headers.find((tab) => tab.filterTabType === 'All');

        // Initialize
        headers.forEach((tab) => {
            fullBucketByFilterTab[tab.name ?? ''] = [];
        });

        // Distribute buckets
        for (const fullBucket of fullBuckets) {
            fullBucketByFilterTab[fullBucket.bucketFilterCategory]?.push(fullBucket);
            if (allTab?.name) {
                fullBucketByFilterTab[allTab.name]?.push(fullBucket);
            }
        }

        // Calculate Counts
        const bucketCategoryArticleCount: { [key: string]: number } = {};
        for (const [category, buckets] of Object.entries(fullBucketByFilterTab)) {
            bucketCategoryArticleCount[category] = buckets.reduce((count, bucket) => {
                // Filter magic IDs from child buckets consistently with parent articles
                const childArticleCount = bucket.children?.reduce((childCount, childBucket) =>
                    childCount + childBucket.articles.filter((x) => x.id !== '-999' && x.id !== '-998').length, 0) ?? 0;
                // Filter out magic IDs like -999, -998 if they exist in data
                const currentCount = bucket.articles.filter((x) => x.id !== '-999' && x.id !== '-998').length;
                return count + currentCount + childArticleCount;
            }, 0);
        }

        // Return mapped object
        return Object.entries(fullBucketByFilterTab).map(([key, value]) => ({
            filterTab: key,
            articlesCount: bucketCategoryArticleCount[key],
            buckets: value,
            articleTrailId: headers.find((i) => i.name === key)?.articleTrailId,
            isCountUnknown: headers.find((x) => x.name === key)?.isCountUnknown,
            filterTabType: headers.find((x) => x.name === key)?.filterTabType,
        }));
    });


    /**
     * Action: Perform Search
     */
    search(contentSource: string, vehicleId: string, searchTerm: string = '', motorVehicleId?: string): void {
        this.isLoading.set(true);
        this.error.set(null);

        // Call API (using getSearchResultsByVehicleId to match legacy flow)
        this.motorApi.getSearchResultsByVehicleId(contentSource, vehicleId, searchTerm, motorVehicleId)
            .pipe(
                catchError((err) => {
                    this.error.set(err.message || 'Search failed');
                    this.isLoading.set(false);
                    return of({
                        body: {
                            articleDetails: [],
                            filterTabs: [],
                            normalizedMenu: null
                        } as any,
                        header: { status: 'error', statusCode: 500 }
                    });
                })
            )
            .subscribe((res) => {
                // According to model update, res.body has keys articleDetails and filterTabs directly
                const data = res.body;
                if (data) {
                    this.articleDetails.set(data.articleDetails || []);
                    this.filterTabs.set(data.filterTabs || []);
                    this.normalizedMenu.set(data.normalizedMenu || null);
                }
                this.isLoading.set(false);
            });
    }
}
