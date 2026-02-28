import { Injectable, inject, WritableSignal } from '@angular/core';
import { Observable, from, of, forkJoin } from 'rxjs';
import { map, switchMap, tap, catchError, timeout } from 'rxjs/operators';
import { MotorApiService } from './motor-api.service';
import { ApiResponse, Dtc, Tsb, Procedure, WiringDiagram, ComponentLocation, Spec, Fluid, MaintenanceSchedule, FilterTab, ArticlesData } from '../models/motor.models';

export interface SectionAvailability {
    hasDtcs: boolean;
    hasTsbs: boolean;
    hasDiagrams: boolean;
    hasProcedures: boolean;
    hasSpecs: boolean;
    hasMaintenance: boolean;
    hasComponentLocations: boolean;
    hasParts: boolean;
}


export interface DataLoadOptions<T> {
    loadingSignal: WritableSignal<boolean>;
    getCurrentState: () => T[];
    updateState: (data: T[]) => void;
    getFromCache: () => Promise<T[] | null>;
    getFromApi: () => Observable<ApiResponse<any>>;
    saveToCache: (data: T[]) => Promise<void>;
}

interface SectionStrategy {
    type: string;
    alwaysIncludeBuckets: string[];
    mapper: (article: any) => any;
    enableFallbackSearch?: boolean;
}

/**
 * Centralized service for vehicle data fetching
 * Implements "Build-As-Used" caching pattern
 */
@Injectable({
    providedIn: 'root'
})
export class VehicleDataService {
    private motorApi = inject(MotorApiService);

    private readonly sectionStrategies: Record<string, SectionStrategy> = {
        dtcs: {
            type: 'DTCs',
            alwaysIncludeBuckets: ['Diagnostic Trouble Codes', 'Diagnostic Codes', 'DTCs'],
            mapper: (a: any) => ({
                id: a.id,
                code: a.code || a.title, // Fallback to title if code is missing
                description: a.description || a.subtitle || a.title || '', // meaningful fallback order
                bucket: a.bucket
            } as Dtc),
            enableFallbackSearch: true
        },
        tsbs: {
            type: 'TSBs',
            alwaysIncludeBuckets: [],
            mapper: (a: any) => ({
                id: a.id,
                bulletinNumber: a.bulletinNumber || '',
                title: a.title,
                releaseDate: a.releaseDate || '',
                description: a.description || a.subtitle || '', // Added description mapping
                thumbnailHref: a.thumbnailHref
            } as Tsb)
        },
        procedures: {
            type: 'Procedures',
            alwaysIncludeBuckets: ['Labor'],
            mapper: (a: any) => ({
                id: a.id,
                bucket: a.bucket,
                title: a.title,
                subtitle: a.subtitle,
                parentBucket: a.parentBucket
            } as Procedure)
        },
        diagrams: {
            type: 'Diagrams',
            alwaysIncludeBuckets: ['Wiring Diagrams', 'Component Locations'],
            mapper: (a: any) => ({
                id: a.id,
                bucket: a.bucket,
                title: a.title,
                subtitle: a.subtitle,
                thumbnailHref: a.thumbnailHref || ''
            } as WiringDiagram)
        },
        'component-locations': {
            type: 'Component Locations',
            alwaysIncludeBuckets: ['Component Locations'],
            mapper: (a: any) => ({
                id: a.id,
                bucket: a.bucket,
                title: a.title,
                thumbnailHref: a.thumbnailHref || ''
            } as ComponentLocation)
        }
    };

    /**
     * Helper to resolve params for Legacy Parity (Force Motor source for strict data)
     */
    private resolveSourceParams(
        contentSource: string,
        vehicleId: string,
        motorVehicleId: string | undefined,
        forceMotorVal: boolean = false
    ): { contentSource: string, vehicleId: string } {
        // Validation: If not Motor and no motorVehicleId, we might fail downstream if we force Motor.
        // Legacy Maintenance logic explicitly switches to Motor.
        if (forceMotorVal && motorVehicleId) {
            return { contentSource: 'MOTOR', vehicleId: motorVehicleId };
        }
        // Implicit switch for known non-Motor sources if motorVehicleId exists?
        // For now, only switch if explicitly requested or if it's a known pattern.
        // Legacy Maintenance Facade: ALWAYS uses Motor.
        return { contentSource: contentSource.toUpperCase(), vehicleId };
    }

    /**
     * Helper to handle search API calls with loading state
     */
    private loadFromSearch<T>(
        contentSource: string,
        vehicleId: string,
        searchTerm: string,
        motorVehicleId: string | undefined,
        loadingSignal: WritableSignal<boolean>,
        updateState: (data: T[]) => void,
        transform: (articles: any[]) => T[]
    ): void {
        loadingSignal.set(true);
        console.log(`[VehicleData] Fetching from Search API(term: "${searchTerm}")...`);

        this.motorApi.searchArticles(contentSource, vehicleId, searchTerm).subscribe({
            next: (res) => {
                // Ensure articleDetails exists
                const articles = res.body?.articleDetails || [];
                const mappedData = transform(articles);
                updateState(mappedData);
                loadingSignal.set(false);
            },
            error: (err) => {
                console.error('[VehicleData] Search API failed', err);
                loadingSignal.set(false);
            }
        });
    }

    /**
     * Load specs and fluids using forkJoin pattern
     */
    loadSpecs(
        contentSource: string,
        vehicleId: string,
        motorVehicleId?: string
    ): Observable<{ specs: Spec[], fluids: Fluid[] }> {
        const getFluids = () => {
            console.log('[Cache DISABLED] Fluids fetching from API...');
            // Legacy Parity: Fluids often align with "Specs/Parts" which tend to be Motor-sourced.
            // Using Motor ID if available to ensure data consistency.
            const params = this.resolveSourceParams(contentSource, vehicleId, motorVehicleId, true);
            return this.motorApi.getFluids(params.contentSource, params.vehicleId).pipe(
                map(res => (res.body as any)?.data || []),
                catchError(err => {
                    console.error('[VehicleDataService] Fluids fetch failed:', err);
                    return of([]);
                })
            );
        };

        const getSpecs = () => {
            const params = this.resolveSourceParams(contentSource, vehicleId, motorVehicleId, true);
            console.log(`[VehicleDataService - V4] Specs loading for ${params.contentSource} / ${params.vehicleId}...`);

            return this.motorApi.searchArticles(params.contentSource, params.vehicleId, '').pipe(
                tap(res => console.log(`[VehicleDataService - V4] articles / v2 response received.Body: ${!!res?.body}, Count: ${res?.body?.articleDetails?.length || 0} `)),
                switchMap(res => {
                    const articles = res.body?.articleDetails || [];

                    // Filter for anything that looks like a specification
                    const specArticles = articles.filter(a => {
                        const bucket = (a.bucket || '').toLowerCase();
                        const title = (a.title || '').toLowerCase();
                        return bucket.includes('specification') ||
                            bucket.includes('specs') ||
                            title.includes('specifications') ||
                            title.includes('specs') ||
                            title.includes('capacity');
                    });

                    console.log(`[VehicleDataService - V4] Found ${specArticles.length} matching articles.`);

                    if (specArticles.length === 0) {
                        return of([]);
                    }

                    // Map to Spec objects
                    const initialSpecs = specArticles.map(a => ({
                        id: a.id,
                        bucket: a.bucket,
                        title: a.title,
                        value: a.description || ''
                    } as Spec));

                    // High value specs for content fetch
                    const priorities = specArticles.filter(a => {
                        const t = (a.title || '').toLowerCase();
                        return t.includes('engine oil') || t.includes('fluid') || t.includes('alignment');
                    }).slice(0, 10);

                    if (priorities.length === 0) return of(initialSpecs);

                    return forkJoin(priorities.map(pa =>
                        this.motorApi.getArticleContent(params.contentSource, params.vehicleId, pa.id, motorVehicleId).pipe(
                            map(contentRes => ({
                                id: pa.id,
                                bucket: pa.bucket,
                                title: pa.title,
                                value: this.parseSpecTable(contentRes.body?.html || '') || pa.description || ''
                            } as Spec)),
                            catchError(() => of({
                                id: pa.id,
                                bucket: pa.bucket,
                                title: pa.title,
                                value: pa.description || ''
                            } as Spec))
                        )
                    )).pipe(
                        map(processed => {
                            const ids = new Set(processed.map(p => p.id));
                            return [...processed, ...initialSpecs.filter(s => !ids.has(s.id))];
                        })
                    );
                }),
                catchError(err => {
                    console.error('[VehicleDataService-V4] getSpecs failed:', err);
                    return of([]);
                })
            );
        };

        return forkJoin({
            fluids: getFluids().pipe(catchError(() => of([]))),
            specs: getSpecs().pipe(catchError(() => of([])))
        }).pipe(
            timeout(20000),
            catchError(err => {
                console.warn('[VehicleDataService-V4] loadSpecs FATAL:', err);
                return of({ specs: [], fluids: [] });
            })
        );
    }

    /**
     * Helper to get bucket names for a specific type from API response data
     */
    private _getBucketNamesForType(type: string, data: any): string[] {
        if (!data || !data.filterTabs) return [];

        // Find the tab(s) that match the requested type or have a similar name for DTCs
        const targetTabs = data.filterTabs.filter((t: any) => {
            const matchesType = t.type === type;
            const isDtcFallback = type === 'DTCs' && (t.name?.includes('Diagnostic') || t.type?.includes('DTC'));
            return matchesType || isDtcFallback;
        });

        if (!targetTabs.length) {
            // FALLBACKS if type is missing or mismatch
            if (type === 'DTCs') return ['Diagnostic Trouble Codes', 'Diagnostic Codes', 'DTCs'];
            if (type === 'TSBs') return ['Technical Service Bulletins', 'Bulletins', 'TSBs'];
            if (type === 'Diagrams') return ['Wiring Diagrams', 'Diagrams', 'System Wiring Diagrams'];
            if (type === 'Component Locations') return ['Component Locations', 'Locations', 'Component Location Diagrams'];
            if (type === 'Procedures') return ['Procedures', 'Labor', 'Service Procedures'];
            // Maintenance fallback
            if (type === 'Maintenance') return ['Maintenance', 'Scheduled Maintenance', 'Schedules'];
            // Specs fallback
            if (type === 'Specs') return ['Specifications', 'Specs'];
            return [];
        }

        const names: string[] = [];

        // Helper to collect names recursively
        const collectNames = (tab: any) => {
            if (tab.name) names.push(tab.name);
            // Support both 'buckets' and 'children' for legacy/upstream parity
            if (tab.buckets && Array.isArray(tab.buckets)) tab.buckets.forEach(collectNames);
            if (tab.children && Array.isArray(tab.children)) tab.children.forEach(collectNames);
        };

        targetTabs.forEach(collectNames);
        return names;
    }

    /**
     * Parse filter tabs and check Parts API to determine available sections
     */
    getAvailableSections(
        contentSource: string,
        vehicleId: string,
        motorVehicleId?: string
    ): Observable<SectionAvailability> {
        // Fetch Search Articles (Filter Tabs)
        const search$ = this.motorApi.searchArticles(contentSource, vehicleId, '').pipe(
            map(res => res.body || { articleDetails: [], filterTabs: [] }),
            catchError(() => of({ articleDetails: [], filterTabs: [] }))
        );

        // Fetch Parts (Check existence)
        const parts$ = this.motorApi.getPartsForVehicle(contentSource, vehicleId, motorVehicleId).pipe(
            map(res => (res.body as any)?.items || []),
            catchError(() => of([]))
        );

        return forkJoin({
            search: search$,
            parts: parts$
        }).pipe(
            map(({ search, parts }) => {
                const tabs = search.filterTabs || [];
                const articles = search.articleDetails || [];

                const hasParts = parts.length > 0;

                // Check sections based on tabs/buckets presence
                // Note: _getBucketNamesForType returns bucket names IF the tab exists or falls back to defaults.
                // We need to check if the tab actually exists in the response.
                // However, _getBucketNamesForType has logic: if (!targetTabs.length) return fallbacks.
                // This implies that it ALWAYS returns something for standard types.
                // So checking `_getBucketNamesForType(...).length > 0` is not enough to verify existence if fallbacks are always returned.
                // We need to verify if the tab exists in `filterTabs`.

                const checkTabExists = (type: string, fallbackNames: string[] = []) => {
                    return tabs.some((t: any) => {
                        const matchesType = t.type === type;
                        const matchesName = fallbackNames.some(n => (t.name || '').includes(n));
                        return matchesType || matchesName;
                    });
                };

                const hasDtcs = checkTabExists('DTCs', ['Diagnostic', 'DTC']);
                const hasTsbs = checkTabExists('TSBs', ['Bulletins', 'TSB']);
                const hasDiagrams = checkTabExists('Diagrams', ['Wiring Diagrams', 'Diagrams']);
                const hasProcedures = checkTabExists('Procedures', ['Procedures', 'Labor']);
                const hasComponentLocations = checkTabExists('Component Locations', ['Component Locations', 'Locations']);
                const hasMaintenance = checkTabExists('Maintenance', ['Maintenance', 'Schedules']);

                // Specs: Check tabs OR articles
                const hasSpecsInTabs = checkTabExists('Specs', ['Specifications', 'Specs']);
                const hasSpecsInArticles = articles.some(a => {
                    const bucket = (a.bucket || '').toLowerCase();
                    const title = (a.title || '').toLowerCase();
                    return bucket.includes('specification') ||
                        bucket.includes('specs') ||
                        title.includes('specifications') ||
                        title.includes('specs') ||
                        title.includes('capacity');
                });
                const hasSpecs = hasSpecsInTabs || hasSpecsInArticles;

                return {
                    hasDtcs,
                    hasTsbs,
                    hasDiagrams,
                    hasProcedures,
                    hasSpecs,
                    hasMaintenance,
                    hasComponentLocations,
                    hasParts
                };
            })
        );
    }

    private getBucketNamesForType(type: string, data: any): string[] {
        if (!data || !data.filterTabs) return [];

        // Find the tab(s) that match the requested type or have a similar name for DTCs
        const targetTabs = data.filterTabs.filter((t: any) => {
            const matchesType = t.type === type;
            const isDtcFallback = type === 'DTCs' && (t.name?.includes('Diagnostic') || t.type?.includes('DTC'));
            return matchesType || isDtcFallback;
        });

        if (!targetTabs.length) {
            // FALLBACKS if type is missing or mismatch
            if (type === 'DTCs') return ['Diagnostic Trouble Codes', 'Diagnostic Codes', 'DTCs'];
            if (type === 'TSBs') return ['Technical Service Bulletins', 'Bulletins', 'TSBs'];
            if (type === 'Diagrams') return ['Wiring Diagrams', 'Diagrams', 'System Wiring Diagrams'];
            if (type === 'Component Locations') return ['Component Locations', 'Locations', 'Component Location Diagrams'];
            if (type === 'Procedures') return ['Procedures', 'Labor', 'Service Procedures'];
            return [];
        }

        const names: string[] = [];

        // Helper to collect names recursively
        const collectNames = (tab: any) => {
            if (tab.name) names.push(tab.name);
            // Support both 'buckets' and 'children' for legacy/upstream parity
            if (tab.buckets && Array.isArray(tab.buckets)) tab.buckets.forEach(collectNames);
            if (tab.children && Array.isArray(tab.children)) tab.children.forEach(collectNames);
        };

        targetTabs.forEach(collectNames);
        return names;
    }

    /**
     * Load data for a specific dashboard section
     */
    loadSectionData(
        section: 'dtcs' | 'tsbs' | 'procedures' | 'diagrams' | 'component-locations',
        contentSource: string,
        vehicleId: string,
        motorVehicleId: string | undefined,
        loadingSignal: WritableSignal<boolean>,
        updateState: (data: any[]) => void,
        errorCallback?: (error: any) => void
    ): void {
        const strategy = this.sectionStrategies[section];
        if (!strategy) {
            console.error(`[VehicleData] Unknown section: ${section} `);
            return;
        }

        // RE-IMPLEMENTING loadSectionData with direct calls to ensure access to headers/tabs
        this.motorApi.searchArticles(contentSource, vehicleId, '').subscribe({
            next: (res) => {
                loadingSignal.set(false);
                const articles = res.body?.articleDetails || [];
                const fullData = res.body;

                const validBuckets = this.getBucketNamesForType(strategy.type, fullData);

                // Add always include buckets
                if (strategy.alwaysIncludeBuckets) {
                    strategy.alwaysIncludeBuckets.forEach(b => {
                        if (!validBuckets.includes(b)) validBuckets.push(b);
                    });
                }

                // DEBUG: Log bucket names and article sample for diagnostics
                const uniqueBuckets = [...new Set(articles.map((a: any) => a.bucket))];
                console.log(`[VehicleData] Section = ${section}, Total articles = ${articles.length}, Valid buckets = [${validBuckets.join(', ')}], All unique buckets in response=[${uniqueBuckets.join(', ')}]`);

                let filtered = articles.filter((a: any) =>
                    validBuckets.includes(a.bucket) ||
                    (a.parentBucket && validBuckets.includes(a.parentBucket))
                ).map(strategy.mapper);

                console.log(`[VehicleData] Section = ${section}, Filtered count = ${filtered.length} `);

                // Handle Fallback Search (DTCs)
                if (strategy.enableFallbackSearch && filtered.length === 0) {
                    console.log(`[VehicleData] No ${strategy.type} found with empty search.Triggering fallback search...`);
                    this.motorApi.searchArticles(contentSource, vehicleId, 'DTC').subscribe({
                        next: (fallbackRes) => {
                            const fallbackArticles = fallbackRes.body?.articleDetails || [];
                            console.log(`[VehicleData] Fallback search returned ${fallbackArticles.length} articles`);

                            const fallbackFiltered = fallbackArticles.filter((a: any) =>
                                validBuckets.includes(a.bucket) ||
                                (a.parentBucket && validBuckets.includes(a.parentBucket))
                            ).map(strategy.mapper);

                            if (fallbackFiltered.length > 0) {
                                console.log(`[VehicleData] Fallback search found ${fallbackFiltered.length} items.`);
                                updateState(fallbackFiltered);
                            } else {
                                updateState([]);
                            }
                        },
                        error: (err) => {
                            console.error('[VehicleData] Fallback search failed', err);
                            updateState([]);
                        }
                    });
                    return;
                }

                updateState(filtered);
            },
            error: (err) => {
                console.error(`[VehicleData] Failed to load ${section} `, err);
                loadingSignal.set(false);
                if (errorCallback) errorCallback(err);
            }
        });
    }

    /**
     * Load Maintenance Schedules (Legacy Parity: Forces Motor Source)
     * Maintenance data is standardized in Motor format.
     */
    loadMaintenanceSchedules(
        contentSource: string,
        vehicleId: string,
        motorVehicleId: string | undefined,
        interval: number,
        loadingSignal: WritableSignal<boolean>,
        updateState: (data: any[]) => void,
        errorCallback?: (error: any) => void
    ): void {
        loadingSignal.set(true);
        const params = this.resolveSourceParams(contentSource, vehicleId, motorVehicleId, true);

        // Fetch By Interval
        this.motorApi.getMaintenanceByIntervals(params.contentSource, params.vehicleId, 'miles', interval)
            .subscribe({
                next: (res) => {
                    loadingSignal.set(false);
                    // Map response to simple MaintenanceSchedule[]
                    // Handle potential variations in API response structure
                    const schedules = (res.body as any)?.schedules || (res.body as any)?.items || (res.body as any)?.data || [];
                    updateState(schedules);
                },
                error: (err) => {
                    console.error('[VehicleDataService] Maintenance fetch failed:', err);
                    loadingSignal.set(false);
                    updateState([]);
                    if (errorCallback) errorCallback(err);
                }
            });
    }

    /**
     * Parse HTML table content into a summary string for quick dashboard viewing
     */
    public parseSpecTable(html: string): string {
        if (!html) return '';

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const tables = doc.querySelectorAll('table');
        const summaries: string[] = [];

        tables.forEach((t) => {
            const table = t as HTMLTableElement;
            const rows: string[] = [];
            const trs = table.rows;

            // Iterate rows, stop early if we have 3 valid rows
            for (let i = 0; i < trs.length && rows.length < 3; i++) {
                const tr = trs[i];
                const cells: string[] = [];
                const children = tr.children;

                for (let j = 0; j < children.length; j++) {
                    const child = children[j];
                    const tagName = child.tagName.toLowerCase();
                    if (tagName === 'td' || tagName === 'th') {
                        let text = child.textContent || '';
                        // Normalize whitespace and handle non-breaking spaces
                        text = text.trim().replace(/\s+/g, ' ');
                        if (text) cells.push(text);
                    }
                }

                if (cells.length >= 2) {
                    // Limit length of individual values to prevent UI bloat
                    const key = cells[0].replace(/:$/, '').trim();
                    const value = cells.slice(1).join(' ');
                    rows.push(`${key}: ${value} `);
                }
            }

            if (rows.length > 0) {
                // Return top 3 rows to keep it concise
                summaries.push(rows.join(' | '));
            }
        });

        return summaries.join('\n');
    }
}
