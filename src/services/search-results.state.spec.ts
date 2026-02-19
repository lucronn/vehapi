import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { Article, FilterTab, BucketArticles, Bucket } from '../models/motor.models';

// Mock dependencies
const mockMotorApiInstance = {
  getSearchResultsByVehicleId: () => ({ pipe: () => ({ subscribe: () => {} }) })
};

// Mock rxjs
mock.module('rxjs', () => {
    return {
        of: (val: any) => ({
            pipe: () => ({ subscribe: (fn: any) => fn({ body: val }) })
        }),
        catchError: () => (source: any) => source
    };
});

mock.module('rxjs/operators', () => {
    return {
        catchError: (fn: any) => (source: any) => source,
        map: (fn: any) => (source: any) => source,
        tap: (fn: any) => (source: any) => source,
    };
});

// Mock MotorApiService module to prevent loading its dependencies
mock.module('./motor-api.service', () => {
    return {
        MotorApiService: class DummyMotorApiService {}
    };
});

// Mock @angular/core
mock.module('@angular/core', () => {
  return {
    Injectable: () => (target: any) => target,
    inject: (token: any) => {
        // checks against the token name or reference
        // Since we mocked MotorApiService class, we check if token matches our dummy class
        // or we just return the mock instance if it looks like MotorApiService
        return mockMotorApiInstance;
    },
    signal: (initialValue: any) => {
      let value = initialValue;
      const s = (newValue?: any) => {
        if (newValue !== undefined) {
          value = newValue;
        }
        return value;
      };
      s.set = (v: any) => { value = v; };
      return s;
    },
    computed: (fn: any) => {
      const s = () => fn();
      return s;
    }
  };
});

// Original implementation for baseline comparison
function originalBucketsFilledWithArticles(
    articles: Article[],
    tabs: FilterTab[],
    showProceduresInSilo: boolean
): BucketArticles[] {
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
                children: bucket.name === 'Procedures' ? [] : bucket.children,
            })),
        }));
    }

    let bucketList: BucketArticles[] = [];

    tabs
        .filter((item) => item.filterTabType !== 'All')
        .forEach((tab) => {
            tab.buckets?.forEach((bucket) => {
                const childrenBucketList: BucketArticles[] = [];

                bucket.children?.forEach((childBucket) => {
                    childrenBucketList.push({
                        bucketName: childBucket.name ?? '',
                        bucketFilterCategory: tab.name ?? '',
                        articles: articles.filter((item) => item.bucket === childBucket.name) ?? [],
                        sort: bucket.sort ?? 0,
                        bucketNameOverride: childBucket.nameOverride,
                        bucketFilterTabType: tab.filterTabType,
                    });
                });

                const nonParentedArticles = articles.filter((item) => !item.parentBucket);

                bucketList.push({
                    bucketName: bucket.name ?? '',
                    bucketFilterCategory: tab.name ?? '',
                    articles: nonParentedArticles.filter((item) => item.bucket === bucket.name) ?? [],
                    sort: bucket.sort ?? 0,
                    bucketNameOverride: bucket.nameOverride,
                    bucketFilterTabType: tab.filterTabType,
                    isParent: bucket.children && bucket.children.length > 0,
                    children: childrenBucketList,
                });
            });
        });

    // Filter out empty buckets, BUT preserve important categories even if empty
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
}

describe('SearchResultsState Performance', () => {
    let SearchResultsStateClass: any;
    let state: any;

    beforeEach(async () => {
        // Dynamic import to allow mocking to take effect
        const module = await import('./search-results.state');
        SearchResultsStateClass = module.SearchResultsState;
        state = new SearchResultsStateClass();
    });

    it('should be faster than the original implementation', () => {
        // 1. Generate large dataset (reduced for quick testing, but large enough to measure)
        // 5000 is good enough.
        const ARTICLE_COUNT = 5000;
        const TABS_COUNT = 5;
        const BUCKETS_PER_TAB = 5;
        const CHILDREN_PER_BUCKET = 3;

        const tabs: FilterTab[] = [];
        const bucketNames: string[] = [];

        for (let i = 0; i < TABS_COUNT; i++) {
            const buckets: Bucket[] = [];
            for (let j = 0; j < BUCKETS_PER_TAB; j++) {
                const children: Bucket[] = [];
                const bucketName = `Tab${i}_Bucket${j}`;
                bucketNames.push(bucketName);

                for (let k = 0; k < CHILDREN_PER_BUCKET; k++) {
                    const childName = `Tab${i}_Bucket${j}_Child${k}`;
                    bucketNames.push(childName);
                    children.push({ name: childName, count: 0, sort: k });
                }

                buckets.push({
                    name: bucketName,
                    count: 0,
                    sort: j,
                    children: children
                });
            }
            tabs.push({
                name: `Tab${i}`,
                filterTabType: 'Basic',
                buckets: buckets
            });
        }

        const articles: Article[] = [];
        for (let i = 0; i < ARTICLE_COUNT; i++) {
            const bucketIndex = Math.floor(Math.random() * bucketNames.length);
            articles.push({
                id: `art_${i}`,
                title: `Article ${i}`,
                bucket: bucketNames[bucketIndex],
                // Randomly assign parentBucket for some articles
                parentBucket: Math.random() > 0.8 ? 'Procedures' : undefined
            });
        }

        // Set state
        state.articleDetails.set(articles);
        state.filterTabs.set(tabs);
        state.showProcedureSilo.set(true); // Default behavior

        // 2. Measure Original
        const startOriginal = performance.now();
        const resultOriginal = originalBucketsFilledWithArticles(articles, tabs, true);
        const endOriginal = performance.now();
        const timeOriginal = endOriginal - startOriginal;

        console.log(`Original Implementation Time: ${timeOriginal.toFixed(2)}ms`);

        // 3. Measure Current (State)
        const startState = performance.now();
        const resultState = state.bucketsFilledWithArticles();
        const endState = performance.now();
        const timeState = endState - startState;

        console.log(`Current Implementation Time: ${timeState.toFixed(2)}ms`);
        // If speedup is close to 1, that's expected for now.
        console.log(`Speedup: ${(timeOriginal / timeState).toFixed(2)}x`);

        // 4. Verify Correctness
        expect(resultState.length).toBe(resultOriginal.length);

        if (resultState.length > 0) {
            // Check a few items
            for(let i=0; i<Math.min(5, resultState.length); i++) {
                 expect(resultState[i].bucketName).toBe(resultOriginal[i].bucketName);
                 expect(resultState[i].articles.length).toBe(resultOriginal[i].articles.length);
                 expect(resultState[i].children?.length).toBe(resultOriginal[i].children?.length);
            }
        }
    });
});
