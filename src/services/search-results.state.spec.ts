import '@angular/compiler'; // Load JIT compiler
import { expect, test, describe, beforeEach, mock } from 'bun:test';
import { resolve } from 'path';

// Mocks must be defined before imports

const mockSignal = (initialValue: any) => {
    let _val = initialValue;
    const s = () => _val;
    s.set = (v: any) => { _val = v; };
    return s;
};

const mockComputed = (fn: () => any) => {
    return () => fn();
};

const mockInject = (token: any) => {
    return {
        getSearchResultsByVehicleId: () => ({ pipe: () => ({ subscribe: () => { } }) })
    };
};

// Mock Angular Core
mock.module('@angular/core', () => ({
    Injectable: () => (target: any) => target,
    signal: mockSignal,
    computed: mockComputed,
    inject: mockInject,
}));

// Mock Angular Common (fixes JIT compilation error)
mock.module('@angular/common', () => ({
    PlatformLocation: class { },
    APP_BASE_HREF: 'APP_BASE_HREF'
}));

// Mock Angular Common HTTP
mock.module('@angular/common/http', () => ({
    HttpClient: class { },
    HttpParams: class { set() { return this; } },
    HttpRequest: class { },
    HttpEvent: class { }
}));

// Mock MotorApiService using absolute path
const motorServicePath = resolve(import.meta.dir, 'motor-api.service.ts');
mock.module(motorServicePath, () => {
    return {
        MotorApiService: class {
            getSearchResultsByVehicleId() { return { pipe: () => ({ subscribe: () => { } }) }; }
        }
    };
});

// Import the service under test
import { SearchResultsState } from './search-results.state';
import { Article, FilterTab } from '../models/motor.models';

describe('SearchResultsState', () => {
    let state: SearchResultsState;

    beforeEach(() => {
        state = new SearchResultsState();
    });

    test('should initialize with default values', () => {
        expect(state.articleDetails()).toEqual([]);
        expect(state.filterTabs()).toEqual([]);
        expect(state.isLoading()).toBe(false);
        expect(state.error()).toBeNull();
    });

    describe('bucketsFilledWithArticles', () => {
        const mockArticles: Article[] = [
            { id: '1', title: 'Article 1', bucket: 'General', sort: 1 },
            { id: '2', title: 'Article 2', bucket: 'Diagnostics', sort: 2 },
            { id: '3', title: 'Procedure 1', bucket: 'Procedures', parentBucket: 'Procedures', sort: 3 },
            { id: '4', title: 'DTC 1', bucket: 'DTCs', sort: 4 }
        ];

        const mockFilterTabs: FilterTab[] = [
            {
                name: 'Service',
                filterTabType: 'Basic',
                buckets: [
                    { name: 'General', count: 0, sort: 1 },
                    { name: 'Diagnostics', count: 0, sort: 2 },
                    {
                        name: 'Procedures',
                        count: 0,
                        sort: 3,
                        children: [
                            { name: 'Procedures', count: 0, sort: 1 } // Child bucket same name as parent
                        ]
                    },
                    { name: 'DTCs', count: 0, sort: 4 },
                    { name: 'EmptyBucket', count: 0, sort: 5 }
                ]
            }
        ];

        test('should filter out empty buckets but keep important ones', () => {
            state.articleDetails.set([
                { id: '1', title: 'Article 1', bucket: 'General', sort: 1 }
            ]);
            state.filterTabs.set(mockFilterTabs);

            const buckets = state.bucketsFilledWithArticles();

            // General has articles, should be present
            expect(buckets.some(b => b.bucketName === 'General')).toBe(true);

            // Diagnostics is empty but important, should be present
            expect(buckets.some(b => b.bucketName === 'Diagnostics')).toBe(true);

            // DTCs is empty but important, should be present
            expect(buckets.some(b => b.bucketName === 'DTCs')).toBe(true);

            // EmptyBucket is empty and not important, should be removed
            expect(buckets.some(b => b.bucketName === 'EmptyBucket')).toBe(false);
        });

        test('should sort buckets correctly', () => {
            state.articleDetails.set(mockArticles);

            const unsortedTabs: FilterTab[] = [{
                name: 'Service',
                filterTabType: 'Basic',
                buckets: [
                    { name: 'DTCs', count: 0, sort: 10 },
                    { name: 'General', count: 0, sort: 1 }
                ]
            }];

            state.filterTabs.set(unsortedTabs);
            const buckets = state.bucketsFilledWithArticles();

            expect(buckets[0].bucketName).toBe('General');
            expect(buckets[1].bucketName).toBe('DTCs');
        });

        test('should flatten procedures when showProcedureSilo is false', () => {
            state.showProcedureSilo.set(false);

            const articles = [
                { id: 'p1', title: 'Proc 1', bucket: 'Procedures', parentBucket: 'Procedures' } as Article
            ];

            const tabs = [{
                name: 'Service',
                filterTabType: 'Basic',
                buckets: [{
                    name: 'Procedures',
                    count: 0,
                    sort: 1,
                    children: [{ name: 'Procedures', count: 0, sort: 1 }]
                }]
            }] as FilterTab[];

            state.articleDetails.set(articles);
            state.filterTabs.set(tabs);

            const buckets = state.bucketsFilledWithArticles();
            const procBucket = buckets.find(b => b.bucketName === 'Procedures');

            expect(procBucket).toBeDefined();
            expect(procBucket?.articles.length).toBe(1);
            expect(procBucket?.articles[0].id).toBe('p1');
            expect(procBucket?.children?.length).toBe(0);
        });

        test('should keep procedures nested when showProcedureSilo is true', () => {
            state.showProcedureSilo.set(true); // Default

            const articles = [
                { id: 'p1', title: 'Proc 1', bucket: 'Procedures', parentBucket: 'Procedures' } as Article
            ];

            const tabs = [{
                name: 'Service',
                filterTabType: 'Basic',
                buckets: [{
                    name: 'Procedures',
                    count: 0,
                    sort: 1,
                    children: [{ name: 'Procedures', count: 0, sort: 1 }]
                }]
            }] as FilterTab[];

            state.articleDetails.set(articles);
            state.filterTabs.set(tabs);

            const buckets = state.bucketsFilledWithArticles();
            const procBucket = buckets.find(b => b.bucketName === 'Procedures');

            expect(procBucket).toBeDefined();

            // Logic check:
            // articles still have parentBucket='Procedures'
            // nonParentedArticles will NOT include 'p1'
            // So procBucket.articles should be empty (direct articles)
            expect(procBucket?.articles.length).toBe(0);

            // But children buckets should be populated
            expect(procBucket?.isParent).toBe(true);
            expect(procBucket?.children?.length).toBe(1);
            expect(procBucket?.children?.[0].articles.length).toBe(1);
            expect(procBucket?.children?.[0].articles[0].id).toBe('p1');
        });
    });

    describe('filterTabsAndTheirFullBuckets', () => {
        const mockArticles: Article[] = [
            { id: '1', title: 'Article 1', bucket: 'General', sort: 1 },
            { id: '2', title: 'Article 2', bucket: 'Diagnostics', sort: 2 },
            { id: '3', title: 'Article 3', bucket: 'Procedures', sort: 3 },
            { id: '-999', title: 'Magic 1', bucket: 'General', sort: 4 },
            { id: '-998', title: 'Magic 2', bucket: 'Diagnostics', sort: 5 }
        ];

        const mockFilterTabs: FilterTab[] = [
            {
                name: 'Browse All',
                filterTabType: 'All',
                articleTrailId: 100,
                isCountUnknown: false,
                buckets: [
                    { name: 'General', count: 0, sort: 1 },
                    { name: 'Diagnostics', count: 0, sort: 2 },
                    { name: 'Procedures', count: 0, sort: 3 }
                ]
            },
            {
                name: 'Service',
                filterTabType: 'Basic',
                articleTrailId: 200,
                isCountUnknown: true,
                buckets: [
                    { name: 'General', count: 0, sort: 1 }
                ]
            },
            {
                name: 'Repair',
                filterTabType: 'Basic',
                articleTrailId: 300,
                isCountUnknown: false,
                buckets: [
                    { name: 'Diagnostics', count: 0, sort: 2 },
                    {
                        name: 'Procedures', count: 0, sort: 3, children: [
                            { name: 'ProcChild', count: 0, sort: 1 }
                        ]
                    }
                ]
            }
        ];

        beforeEach(() => {
            state.articleDetails.set(mockArticles);
            state.filterTabs.set(mockFilterTabs);
        });

        test('should correctly group buckets by filter tab', () => {
            const results = state.filterTabsAndTheirFullBuckets();
            const serviceTab = results.find((r: any) => r.filterTab === 'Service');

            expect(serviceTab).toBeDefined();
            expect(serviceTab?.buckets.length).toBe(1);
            expect(serviceTab?.buckets[0].bucketName).toBe('General');
            expect(serviceTab?.articleTrailId).toBe(200);
            expect(serviceTab?.isCountUnknown).toBe(true);
            expect(serviceTab?.filterTabType).toBe('Basic');
        });

        test('should include all buckets in the "All" tab', () => {
            const results = state.filterTabsAndTheirFullBuckets();
            const allTab = results.find((r: any) => r.filterTab === 'Browse All');

            expect(allTab).toBeDefined();
            // Browse All tab receives all distributed buckets.
            // In the logic: fullBucketByFilterTab[allTab.name]?.push(fullBucket)
            // fullBuckets will have General, Diagnostics, Procedures. So Browse All gets all of them.
            expect(allTab?.buckets.length).toBe(3);
        });

        test('should calculate article counts correctly and exclude magic IDs', () => {
            const results = state.filterTabsAndTheirFullBuckets();
            const serviceTab = results.find((r: any) => r.filterTab === 'Service');

            // Service tab -> General bucket. Articles: '1', '-999'. Magic ID '-999' is excluded. Count: 1.
            expect(serviceTab?.articlesCount).toBe(1);

            const repairTab = results.find((r: any) => r.filterTab === 'Repair');
            // Repair tab -> Diagnostics ('2', '-998' -> count 1) and Procedures ('3' -> count 1). Total: 2.
            expect(repairTab?.articlesCount).toBe(2);
        });

        test('should calculate child bucket article counts correctly', () => {
            const customArticles: Article[] = [
                { id: '10', title: 'Proc Parent', bucket: 'Procedures', sort: 1 },
                { id: '11', title: 'Proc Child', bucket: 'ProcChild', sort: 2 }
            ];
            const customTabs: FilterTab[] = [{
                name: 'Repair',
                filterTabType: 'Basic',
                buckets: [
                    {
                        name: 'Procedures', count: 0, sort: 1, children: [
                            { name: 'ProcChild', count: 0, sort: 1 }
                        ]
                    }
                ]
            }];

            state.articleDetails.set(customArticles);
            state.filterTabs.set(customTabs);

            const results = state.filterTabsAndTheirFullBuckets();
            const repairTab = results.find((r: any) => r.filterTab === 'Repair');

            // Parent has 1 article, child has 1 article, so total is 2.
            expect(repairTab?.articlesCount).toBe(2);
        });

        test('should handle empty or missing buckets gracefully', () => {
            state.filterTabs.set([
                { name: 'Empty Tab', filterTabType: 'Basic', buckets: [] }
            ]);

            const results = state.filterTabsAndTheirFullBuckets();
            expect(results.length).toBe(1);
            expect(results[0].filterTab).toBe('Empty Tab');
            expect(results[0].buckets.length).toBe(0);
            expect(results[0].articlesCount).toBe(0);
        });
    });
});
