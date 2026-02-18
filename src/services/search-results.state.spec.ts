import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { Article, FilterTab, FilterTabType, Bucket, BucketArticles } from '../models/motor.models';

// --- Mocks Setup ---

// Mock Signal
function signal<T>(initialValue: T) {
    let value = initialValue;
    const s: any = () => value;
    s.set = (v: T) => { value = v; };
    return s;
}

// Mock Computed
function computed<T>(fn: () => T) {
    return () => fn();
}

// Mock Injectable
function Injectable(config?: any) {
    return (target: any) => target;
}

// Mock MotorApiService instance
const mockMotorApiInstance = {
    getSearchResultsByVehicleId: mock(() => ({ pipe: () => ({ subscribe: () => {} }) }))
};

// Mock inject
function inject(token: any) {
    return mockMotorApiInstance;
}

// Apply mocks to @angular/core
mock.module('@angular/core', () => ({
    Injectable,
    signal,
    computed,
    inject
}));

// Mock rxjs
mock.module('rxjs', () => ({
    of: (val: any) => ({ pipe: () => ({ subscribe: (cb: any) => cb({ body: val }) }) }),
}));

// Mock rxjs/operators
mock.module('rxjs/operators', () => ({
    catchError: (fn: any) => (source: any) => source,
}));

// Mock MotorApiService (the class itself)
class MockMotorApiService {}
mock.module('./motor-api.service', () => ({
    MotorApiService: MockMotorApiService
}));

describe('SearchResultsState', () => {
    let SearchResultsStateClass: any;
    let state: any;

    beforeEach(async () => {
        // Reset mocks
        mockMotorApiInstance.getSearchResultsByVehicleId.mockClear();

        // Dynamic import to allow mocks to take effect
        const module = await import('./search-results.state');
        SearchResultsStateClass = module.SearchResultsState;

        state = new SearchResultsStateClass();
    });

    test('should initialize with default values', () => {
        expect(state.articleDetails()).toEqual([]);
        expect(state.filterTabs()).toEqual([]);
        expect(state.isLoading()).toBe(false);
        expect(state.error()).toBe(null);
        expect(state.showProcedureSilo()).toBe(true);
    });

    test('should bucket articles correctly (Standard Scenario)', () => {
        const articles: Article[] = [
            { id: '1', title: 'Oil Change', bucket: 'Maintenance', sort: 1 },
            { id: '2', title: 'Brake Pad Replacement', bucket: 'Repairs', sort: 2 }
        ];
        const tabs: FilterTab[] = [
            {
                name: 'Maintenance',
                filterTabType: 'Basic',
                buckets: [
                    { name: 'Maintenance', count: 0, sort: 1 }
                ]
            },
            {
                name: 'Repairs',
                filterTabType: 'Basic',
                buckets: [
                    { name: 'Repairs', count: 0, sort: 2 }
                ]
            }
        ];

        state.articleDetails.set(articles);
        state.filterTabs.set(tabs);

        const buckets = state.bucketsFilledWithArticles();

        expect(buckets.length).toBe(2);
        expect(buckets[0].bucketName).toBe('Maintenance');
        expect(buckets[0].articles.length).toBe(1);
        expect(buckets[0].articles[0].id).toBe('1');
        expect(buckets[1].bucketName).toBe('Repairs');
        expect(buckets[1].articles.length).toBe(1);
        expect(buckets[1].articles[0].id).toBe('2');
    });

    test('should handle showProcedureSilo = true (Nested Procedures)', () => {
        const articles: Article[] = [
            { id: 'p1', title: 'Remove Engine', bucket: 'Removal', parentBucket: 'Procedures', sort: 1 }
        ];
        const tabs: FilterTab[] = [
            {
                name: 'Procedures',
                filterTabType: 'Basic',
                buckets: [
                    {
                        name: 'Procedures', count: 0, sort: 1, children: [
                            { name: 'Removal', count: 0, sort: 1 }
                        ]
                    }
                ]
            }
        ];

        state.articleDetails.set(articles);
        state.filterTabs.set(tabs);
        state.showProcedureSilo.set(true);

        const buckets = state.bucketsFilledWithArticles();

        const procBucket = buckets.find((b: any) => b.bucketName === 'Procedures');
        expect(procBucket).toBeDefined();
        expect(procBucket?.isParent).toBe(true);
        expect(procBucket?.children?.length).toBe(1);
        expect(procBucket?.children?.[0].bucketName).toBe('Removal');
        expect(procBucket?.children?.[0].articles.length).toBe(1);
        expect(procBucket?.children?.[0].articles[0].id).toBe('p1');
    });

    test('should handle showProcedureSilo = false (Flattened Procedures)', () => {
        const articles: Article[] = [
            { id: 'p1', title: 'Remove Engine', bucket: 'Removal', parentBucket: 'Procedures', sort: 1 }
        ];
        const tabs: FilterTab[] = [
            {
                name: 'Procedures',
                filterTabType: 'Basic',
                buckets: [
                    {
                        name: 'Procedures', count: 0, sort: 1, children: [
                            { name: 'Removal', count: 0, sort: 1 }
                        ]
                    }
                ]
            }
        ];

        state.articleDetails.set(articles);
        state.filterTabs.set(tabs);
        state.showProcedureSilo.set(false);

        const buckets = state.bucketsFilledWithArticles();

        const procBucket = buckets.find((b: any) => b.bucketName === 'Procedures');
        expect(procBucket).toBeDefined();

        expect(procBucket?.isParent).toBeFalsy();
        expect(procBucket?.articles.length).toBe(1);
        expect(procBucket?.articles[0].id).toBe('p1');
        expect(procBucket?.articles[0].bucket).toBe('Procedures');
    });

    test('should filter out empty buckets', () => {
        const articles: Article[] = [];
        const tabs: FilterTab[] = [
            {
                name: 'EmptyCategory',
                filterTabType: 'Basic',
                buckets: [
                    { name: 'EmptyBucket', count: 0, sort: 1 }
                ]
            }
        ];

        state.articleDetails.set(articles);
        state.filterTabs.set(tabs);

        const buckets = state.bucketsFilledWithArticles();
        expect(buckets.length).toBe(0);
    });

    test('should preserve important buckets even if empty', () => {
        const articles: Article[] = [];
        const tabs: FilterTab[] = [
            {
                name: 'Diagnostics',
                filterTabType: 'Basic',
                buckets: [
                    { name: 'Diagnostics', count: 0, sort: 1 }
                ]
            }
        ];

        state.articleDetails.set(articles);
        state.filterTabs.set(tabs);

        const buckets = state.bucketsFilledWithArticles();
        expect(buckets.length).toBe(1);
        expect(buckets[0].bucketName).toBe('Diagnostics');
    });

    test('should sort buckets correctly', () => {
         const articles: Article[] = [
            { id: '1', title: 'A', bucket: 'B1', sort: 1 },
            { id: '2', title: 'B', bucket: 'B2', sort: 1 }
        ];
        const tabs: FilterTab[] = [
            {
                name: 'Cat',
                filterTabType: 'Basic',
                buckets: [
                    { name: 'B2', count: 0, sort: 20 },
                    { name: 'B1', count: 0, sort: 10 }
                ]
            }
        ];

        state.articleDetails.set(articles);
        state.filterTabs.set(tabs);

        const buckets = state.bucketsFilledWithArticles();
        expect(buckets.length).toBe(2);
        expect(buckets[0].bucketName).toBe('B1');
        expect(buckets[1].bucketName).toBe('B2');
    });
});
