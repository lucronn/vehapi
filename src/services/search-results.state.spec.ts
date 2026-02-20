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
});
