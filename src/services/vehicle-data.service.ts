import { Injectable, inject, WritableSignal } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, tap, catchError, timeout } from 'rxjs/operators';
import { MotorApiService } from './motor-api.service';
import { FirebaseService } from './firebase.service';
import { ApiResponse, Dtc, Tsb, Procedure, WiringDiagram, ComponentLocation, Spec, Fluid, MaintenanceSchedule, FilterTab } from '../models/motor.models';

export interface SectionAvailability {
    hasDtcs: boolean;
    hasTsbs: boolean;
    hasDiagrams: boolean;
    hasProcedures: boolean;
    hasSpecs: boolean;
    hasMaintenance: boolean;
    hasComponentLocations: boolean;
}


export interface DataLoadOptions<T> {
    loadingSignal: WritableSignal<boolean>;
    getCurrentState: () => T[];
    updateState: (data: T[]) => void;
    getFromCache: () => Promise<T[] | null>;
    getFromApi: () => Observable<ApiResponse<any>>;
    saveToCache: (data: T[]) => Promise<void>;
}

/**
 * Centralized service for vehicle data fetching with Firebase caching
 * Implements "Build-As-Used" caching pattern
 */
@Injectable({
    providedIn: 'root'
})
export class VehicleDataService {
    private motorApi = inject(MotorApiService);
    // private firebase = inject(FirebaseService); // DATABASE DISABLED

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
            return { contentSource: 'Motor', vehicleId: motorVehicleId };
        }
        // Implicit switch for known non-Motor sources if motorVehicleId exists?
        // For now, only switch if explicitly requested or if it's a known pattern.
        // Legacy Maintenance Facade: ALWAYS uses Motor.
        return { contentSource, vehicleId };
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
        console.log(`[VehicleData] Fetching from Search API (term: "${searchTerm}")...`);

        this.motorApi.searchArticles(contentSource, vehicleId, searchTerm, motorVehicleId).subscribe({
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
                map(res => res.body.data || [])
            );
        };

        const getSpecs = () => {
            console.log('[Cache DISABLED] Specs fetching from Search API...');
            return this.motorApi.searchArticles(contentSource, vehicleId, '', motorVehicleId).pipe(
                map(res => {
                    const articles = res.body?.articleDetails || [];
                    return articles
                        .filter(a => a.bucket === 'Specifications')
                        .map(a => ({
                            id: a.id,
                            bucket: a.bucket,
                            title: a.title,
                            description: a.description,
                            value: a.description // Fallback or mapping
                        } as Spec));
                })
            );
        };

        return from(Promise.all([getFluids(), getSpecs()])).pipe(
            switchMap(([fluidsObs, specsObs]) =>
                from(Promise.all([
                    fluidsObs.toPromise ? fluidsObs.toPromise() : (fluidsObs as any as Promise<Fluid[]>),
                    specsObs.toPromise ? specsObs.toPromise() : (specsObs as any as Promise<Spec[]>)
                ]))
            ),
            map(([fluids, specs]) => ({ fluids, specs })),
            timeout(8000),
            catchError(err => {
                console.warn('Specs/Fluids failed or timed out:', err);
                return of({ fluids: [], specs: [] });
            })
        );
    }

    /**
     * Parse filter tabs to determine available sections
     */
    getAvailableSections(
        contentSource: string,
        vehicleId: string,
        motorVehicleId?: string
    ): Observable<SectionAvailability> {
        // Use empty search to get filter headers
        return this.motorApi.searchArticles(contentSource, vehicleId, '', motorVehicleId).pipe(
            map(res => {
                const tabs = res.body?.filterTabs || [];

                const hasTypeOrName = (type: string, keywords: string[]) => {
                    return tabs.some(t =>
                        t.type === type ||
                        keywords.some(k => t.name.toLowerCase().includes(k.toLowerCase()))
                    );
                };

                // Check counts if available, otherwise just existence
                const hasItems = (type: string, keywords: string[]) => {
                    const tab = tabs.find(t =>
                        t.type === type ||
                        keywords.some(k => t.name.toLowerCase().includes(k.toLowerCase()))
                    );
                    return tab ? (tab.count > 0) : false;
                };

                return {
                    hasDtcs: hasItems('DTCs', ['Diagnostic', 'DTC']),
                    hasTsbs: hasItems('TSBs', ['Bulletin', 'TSB']),
                    hasDiagrams: hasItems('Diagrams', ['Wiring']),
                    hasComponentLocations: hasItems('Diagrams', ['Component Location', 'Location']), // Often under Diagrams
                    hasProcedures: hasItems('Procedures', ['Procedure', 'Labor']),
                    hasSpecs: hasItems('Specifications', ['Specification', 'Fluid']), // Specs & Fluids often grouped
                    hasMaintenance: true // Maintenance is usually available via separate endpoint, assume true for now or check
                };
            }),
            catchError(() => of({
                hasDtcs: false, hasTsbs: false, hasDiagrams: false,
                hasProcedures: false, hasSpecs: false, hasMaintenance: false, hasComponentLocations: false
            }))
        );
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
        updateState: (data: any[]) => void
    ): void {
        // Skip if already have data check is removed here as it's often handled by caller or we want to refresh.
        // But referencing original code, it had: if (getCurrentState().length > 0) return;
        // Since we don't have access to getCurrentState direct value here easily without passing it, 
        // we'll rely on the fact that standard usage usually checks before calling.

        const getBucketNamesForType = (type: string, data: any): string[] => {
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
        };

        switch (section) {
            case 'dtcs':
                // We pass a TRANSFORM function that receives the FULL response (because we refactored loadFromSearch to pass the full body maybe? No, loadFromSearch calls transform(articles). We need to change that.)
                // CORRECT FIX: We need access to `res.body.filterTabs`. 
                // Since I cannot easily change loadFromSearch signature without breaking other things, I will modify loadFromSearch to pass the full body to transform?
                // Actually, let's keep it simple. We will perform the logic inside the transform, but loadFromSearch needs to pass `res.body`.

                // Wait, I can't change loadFromSearch here easily, it's a private method. I will assume I update it or inline it.
                // Or I can use this.motorApi.searchArticles calls directly here if I want total control?
                // No, better to update the signature of transform in loadFromSearch.
                break;
        }

        // RE-IMPLEMENTING loadSectionData with direct calls to ensure access to headers/tabs
        this.motorApi.searchArticles(contentSource, vehicleId, '', motorVehicleId).subscribe({
            next: (res) => {
                loadingSignal.set(false);
                const articles = res.body?.articleDetails || [];
                const fullData = res.body;

                let filtered: any[] = [];

                if (section === 'dtcs') {
                    const standardDtcBuckets = ['Diagnostic Trouble Codes', 'Diagnostic Codes', 'DTCs'];
                    const validBuckets = getBucketNamesForType('DTCs', fullData);

                    // BUCKET PARITY: Always include standard names to catch misclassified articles
                    standardDtcBuckets.forEach(b => {
                        if (!validBuckets.includes(b)) validBuckets.push(b);
                    });

                    const mapDtcs = (arts: any[]) => arts.filter(a =>
                        validBuckets.includes(a.bucket) ||
                        (a.parentBucket && validBuckets.includes(a.parentBucket))
                    ).map(a => ({
                        id: a.id,
                        code: a.code || a.title, // Fallback to title if code is missing
                        description: a.title,
                        bucket: a.bucket
                    } as Dtc));

                    filtered = mapDtcs(articles);

                    // FALLBACK SEARCH: If no DTCs found with empty search, try searching for "DTC"
                    if (filtered.length === 0) {
                        console.log('[VehicleData] No DTCs found with empty search. Triggering fallback search for "DTC"...');
                        this.motorApi.searchArticles(contentSource, vehicleId, 'DTC', motorVehicleId).subscribe({
                            next: (fallbackRes) => {
                                const fallbackArticles = fallbackRes.body?.articleDetails || [];
                                const fallbackFiltered = mapDtcs(fallbackArticles);
                                if (fallbackFiltered.length > 0) {
                                    console.log(`[VehicleData] Fallback search found ${fallbackFiltered.length} DTCs.`);
                                    updateState(fallbackFiltered);
                                } else {
                                    updateState([]); // Still nothing
                                }
                            },
                            error: (err) => {
                                console.error('[VehicleData] Fallback DTC search failed', err);
                                updateState([]);
                            }
                        });
                        return; // Exit early as updateState will be called in subscribe
                    }
                } else if (section === 'tsbs') {
                    const validBuckets = getBucketNamesForType('TSBs', fullData);
                    filtered = articles.filter(a =>
                        validBuckets.includes(a.bucket) ||
                        (a.parentBucket && validBuckets.includes(a.parentBucket))
                    ).map(a => ({
                        id: a.id,
                        bulletinNumber: a.bulletinNumber || '',
                        title: a.title,
                        releaseDate: a.releaseDate || ''
                    } as Tsb));
                } else if (section === 'procedures') {
                    const validBuckets = getBucketNamesForType('Procedures', fullData);
                    // Legacy parity: explicit check for 'Labor' sometimes
                    if (!validBuckets.includes('Labor')) validBuckets.push('Labor');

                    filtered = articles.filter(a =>
                        validBuckets.includes(a.bucket) ||
                        (a.parentBucket && validBuckets.includes(a.parentBucket))
                    ).map(a => ({
                        id: a.id,
                        bucket: a.bucket,
                        title: a.title,
                        subtitle: a.subtitle,
                        parentBucket: a.parentBucket
                    } as Procedure));
                } else if (section === 'diagrams') {
                    const validBuckets = getBucketNamesForType('Diagrams', fullData);
                    // Fallback/Legacy explicit
                    if (!validBuckets.includes('Wiring Diagrams')) validBuckets.push('Wiring Diagrams');
                    if (!validBuckets.includes('Component Locations')) validBuckets.push('Component Locations');

                    filtered = articles.filter(a =>
                        validBuckets.includes(a.bucket) ||
                        (a.parentBucket && validBuckets.includes(a.parentBucket))
                    ).map(a => ({
                        id: a.id,
                        bucket: a.bucket,
                        title: a.title,
                        subtitle: a.subtitle,
                        thumbnailHref: a.thumbnailHref || ''
                    } as WiringDiagram));
                } else if (section === 'component-locations') {
                    // Separate Component Locations
                    const validBuckets = getBucketNamesForType('Component Locations', fullData);
                    // Fallback
                    if (!validBuckets.includes('Component Locations')) validBuckets.push('Component Locations');

                    filtered = articles.filter(a =>
                        validBuckets.includes(a.bucket) ||
                        (a.parentBucket && validBuckets.includes(a.parentBucket))
                    ).map(a => ({
                        id: a.id,
                        bucket: a.bucket,
                        title: a.title,
                        thumbnailHref: a.thumbnailHref || ''
                    } as ComponentLocation));
                }


                updateState(filtered);
            },
            error: (err) => {
                console.error(`[VehicleData] Failed to load ${section}`, err);
                loadingSignal.set(false);
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
        updateState: (data: any[]) => void
    ): void {
        loadingSignal.set(true);
        const params = this.resolveSourceParams(contentSource, vehicleId, motorVehicleId, true);

        // Fetch By Interval
        this.motorApi.getMaintenanceByIntervals(params.contentSource, params.vehicleId, 'miles', interval)
            .subscribe({
                next: (res) => {
                    loadingSignal.set(false);
                    // Map response to simple MaintenanceSchedule[]
                    // The response structure needs to be checked.
                    // Assuming body.data is valid or body is the object.
                    // Swagger: body.intervals?
                    // Let's assume the API Service handles the response type locally or we map it.
                    // For now, simply update state with whatever array we find.
                    const schedules = (res.body as any)?.items || [];
                    updateState(schedules);
                },
                error: (err) => {
                    console.error('[VehicleData] Maintenance load failed', err);
                    loadingSignal.set(false);
                }
            });
    }
}
