import { Injectable, inject, WritableSignal } from '@angular/core';
import { Observable, from, of, forkJoin } from 'rxjs';
import { map, switchMap, tap, catchError, timeout } from 'rxjs/operators';
import { MotorApiService } from './motor-api.service';
import { LoggerService } from './logger.service';
import { SupabaseService } from './supabase.service';
import { DataSyncService } from './data-sync.service';
import { VehiclePersistenceService } from './vehicle-persistence.service';
import { ApiResponse, Dtc, Tsb, Procedure, WiringDiagram, ComponentLocation, Spec, Fluid, MaintenanceSchedule, FilterTab, ArticlesData } from '../models/motor.models';
import {
    flatMaintenanceToUiRows,
    flattenMaintenanceIntervalResponseBody
} from '../utils/maintenance-response.util';

export type DashboardSection = 'overview' | 'specs' | 'fluids' | 'maintenance' | 'parts' | 'labor' | 'tsbs' | 'dtcs' | 'diagrams' | 'bookmarks' | 'search' | 'common-issues';

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
 * Implements "Build-As-Used" caching pattern.
 *
 * **Normalized vehicles (`vehicles.is_normalized`):** read from Supabase only for sections below;
 * do not fall back to Motor for display — ingest runs via {@link DataSyncService} (see
 * `documentation/DATA_SOURCE_AND_NORMALIZATION.md`).
 */
@Injectable({
    providedIn: 'root'
})
export class VehicleDataService {
    private logger = inject(LoggerService);
    private motorApi = inject(MotorApiService);
    private supabase = inject(SupabaseService);
    private dataSync = inject(DataSyncService);
    private vehiclePersistence = inject(VehiclePersistenceService);

    /** When home wizard + dashboard cached Motor Information YMME, use `api.motor.com` fluids. */
    private motorInformationForFluids(
        contentSource: string,
        vehicleId: string
    ): { baseVehicleId: string; engineId: string } | undefined {
        const pv = this.vehiclePersistence.getVehicle();
        if (!pv || pv.vehicleId !== vehicleId) return undefined;
        if (pv.contentSource?.toUpperCase() !== contentSource.toUpperCase()) return undefined;
        if (pv.motorBaseVehicleId && pv.motorEngineId) {
            return { baseVehicleId: pv.motorBaseVehicleId, engineId: pv.motorEngineId };
        }
        return undefined;
    }

    private readonly sectionStrategies: Record<string, SectionStrategy> = {
        dtcs: {
            type: 'DTCs',
            alwaysIncludeBuckets: [
                'Diagnostic Trouble Codes', 'Diagnostic Codes', 'DTCs',
                'Diagnostic Codes (DTC)',
                // Some catalogs use simplified or OEM-specific labels without the (P/C/B/U) suffixes.
                'Powertrain (P-Codes)', 'Chassis (C-Codes)', 'Body (B-Codes)', 'Network (U-Codes)', 'Other Codes',
                'Powertrain', 'Chassis', 'Body', 'Network',
                'Fault Codes', 'Trouble Codes', 'OBD', 'OBD-II', 'OBD II'
            ],
            mapper: (a: any) => ({
                id: a.original_id ?? a.id,
                code: a.code || a.title,
                description: a.description || a.subtitle || a.title || '',
                bucket: a.bucket
            } as Dtc),
            enableFallbackSearch: true
        },
        tsbs: {
            type: 'TSBs',
            alwaysIncludeBuckets: [
                'Technical Service Bulletins', 'Bulletins', 'TSBs',
                'Service Bulletins (TSB)', 'Service Bulletins'
            ],
            mapper: (a: any) => ({
                id: a.original_id ?? a.id,
                bulletinNumber: a.bulletin_number || a.bulletinNumber || '',
                title: a.title,
                releaseDate: a.release_date || a.releaseDate || '',
                description: a.description || a.subtitle || '',
                thumbnailHref: a.thumbnail_href || a.thumbnailHref
            } as Tsb)
        },
        procedures: {
            type: 'Procedures',
            alwaysIncludeBuckets: [
                'Procedures', 'Labor', 'Service Procedures',
                'Labor & Estimating',
                'Engine Mechanical', 'Transmission & Driveline', 'Electrical & Sensors',
                'Fuel & Emissions', 'Steering & Suspension', 'Cooling System',
                'Brakes', 'HVAC', 'Body & Interior', 'Restraints & Safety',
                'Fluids & Maintenance', 'General'
            ],
            mapper: (a: any) => ({
                id: a.original_id ?? a.id,
                bucket: a.bucket,
                title: a.title,
                subtitle: a.subtitle,
                parentBucket: a.parent_bucket || a.parentBucket || ''
            } as Procedure)
        },
        diagrams: {
            type: 'Diagrams',
            alwaysIncludeBuckets: ['Wiring Diagrams', 'Component Locations', 'Diagrams', 'System Wiring Diagrams'],
            mapper: (a: any) => ({
                id: a.original_id ?? a.id,
                bucket: a.bucket,
                title: a.title,
                subtitle: a.subtitle,
                thumbnailHref: a.thumbnail_href || a.thumbnailHref || ''
            } as WiringDiagram)
        },
        'component-locations': {
            type: 'Component Locations',
            alwaysIncludeBuckets: ['Component Locations', 'Component Location Diagrams'],
            mapper: (a: any) => ({
                id: a.original_id ?? a.id,
                bucket: a.bucket,
                title: a.title,
                thumbnailHref: a.thumbnail_href || a.thumbnailHref || ''
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
        // Preserve Motor path casing (e.g. GeneralMotors); upstream routes are case-sensitive.
        return { contentSource, vehicleId };
    }

    /**
     * Load specs and fluids using forkJoin pattern
     */
    loadSpecs(
        contentSource: string,
        vehicleId: string,
        motorVehicleId?: string
    ): Observable<{ specs: Spec[], fluids: Fluid[] }> {
        // Priority: Check Supabase if vehicle is normalized
        return from(this.dataSync.checkNormalizationStatus(vehicleId)).pipe(
            switchMap((isNormalized) => {
                if (isNormalized) {
                    this.logger.info(`[VehicleDataService] Loading specs from Supabase for ${vehicleId}`);
                    return from(this.supabase.client
                        .from('specifications')
                        .select('*')
                        .eq('vehicle_id', vehicleId)
                    ).pipe(
                        map(({ data: specsData }) => {
                            const specs: Spec[] = (specsData || [])
                                .filter(s => s.category !== 'Fluids')
                                .map(s => ({
                                    id: s.id,
                                    bucket: s.category,
                                    title: s.name,
                                    value: s.display_text || s.value || '',
                                    description: s.unit ? `${s.value} ${s.unit}` : undefined
                                }));
                            const fluids: Fluid[] = (specsData || [])
                                .filter(s => s.category === 'Fluids')
                                .map(s => ({
                                    id: s.id,
                                    bucket: s.category,
                                    title: s.name,
                                    capacity: s.value || '',
                                    specification: s.metadata?.specification || s.display_text || ''
                                }));
                            return { specs, fluids };
                        }),
                        catchError(err => {
                            this.logger.error('[VehicleDataService] Supabase specs fetch failed:', err);
                            return of({ specs: [], fluids: [] });
                        })
                    );
                }

                // Pre-normalization: legacy Motor proxy reads only until ingest completes
                return this.loadSpecsFromApi(contentSource, vehicleId, motorVehicleId);
            })
        );
    }

    private loadSpecsFromApi(
        contentSource: string,
        vehicleId: string,
        motorVehicleId?: string
    ): Observable<{ specs: Spec[], fluids: Fluid[] }> {
        // We enhance basic specs with additional keywords to ensure we capture maximum data
        // tailored to consumption and efficiency as per updated Swagger.
        const consumptionKeywords = ['consumption', 'efficiency', 'fuel', 'economy', 'intelligence'];

        const getFluids = () => {
            this.logger.info('[Cache DISABLED] Fluids fetching from API...');
            // Legacy Parity: Fluids often align with "Specs/Parts" which tend to be Motor-sourced.
            // Using Motor ID if available to ensure data consistency.
            const params = this.resolveSourceParams(contentSource, vehicleId, motorVehicleId, true);
            const mi = this.motorInformationForFluids(params.contentSource, params.vehicleId);
            return this.motorApi.getFluids(params.contentSource, params.vehicleId, mi).pipe(
                map(res => (res.body as any)?.data || []),
                catchError(err => {
                    this.logger.error('[VehicleDataService] Fluids fetch failed:', err);
                    return of([]);
                })
            );
        };

        const getSpecs = () => {
            const params = this.resolveSourceParams(contentSource, vehicleId, motorVehicleId, true);
            this.logger.info(`[VehicleDataService - V4] Specs loading for ${params.contentSource} / ${params.vehicleId}...`);

            return this.motorApi.searchArticles(params.contentSource, params.vehicleId, '').pipe(
                tap(res => { this.logger.info(`[VehicleDataService - V4] articles / v2 response received.Body: ${!!res?.body}, Count: ${res?.body?.articleDetails?.length || 0} `); }),
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

                    this.logger.info(`[VehicleDataService - V4] Found ${specArticles.length} matching articles.`);

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
                    this.logger.error('[VehicleDataService-V4] getSpecs failed:', err);
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
                this.logger.warn('[VehicleDataService-V4] loadSpecs FATAL:', err);
                return of({ specs: [], fluids: [] });
            })
        );
    }


    /**
     * Parse filter tabs and check Parts API to determine available sections
     */
    getAvailableSections(
        contentSource: string,
        vehicleId: string,
        motorVehicleId?: string
    ): Observable<SectionAvailability> {
        // Priority: Check Supabase if vehicle is normalized
        return from(this.dataSync.checkNormalizationStatus(vehicleId)).pipe(
            switchMap((isNormalized) => {
                if (isNormalized) {
                    return from(this.supabase.client
                        .from('articles')
                        .select('bucket,parent_bucket')
                        .eq('vehicle_id', vehicleId)
                    ).pipe(
                        switchMap(({ data: articles }) => {
                            const allBuckets = new Set<string>();
                            (articles || []).forEach(a => {
                                if (a.bucket) allBuckets.add(a.bucket.toLowerCase());
                                if (a.parent_bucket) allBuckets.add(a.parent_bucket.toLowerCase());
                            });
                            const has = (keywords: string[]) =>
                                [...allBuckets].some(b => keywords.some(k => b.includes(k)));

                            return from(this.supabase.client
                                .from('parts')
                                .select('id', { head: true, count: 'exact' })
                                .eq('vehicle_id', vehicleId)
                            ).pipe(
                                map(({ count }) => ({
                                    hasDtcs: has(['dtc', 'diagnostic', 'fault', 'trouble code', 'obd']),
                                    hasTsbs: has(['tsb', 'bulletin']),
                                    hasDiagrams: has(['diagram', 'wiring']),
                                    hasProcedures: has(['procedure', 'labor', 'service procedures']),
                                    hasSpecs: has(['spec', 'capacity', 'fluid']),
                                    hasMaintenance: has(['maintenance']),
                                    hasComponentLocations: has(['component location', 'locations']),
                                    hasParts: (count ?? 0) > 0
                                }))
                            );
                        })
                    );
                }

                // Pre-normalization: legacy Motor proxy reads only until ingest completes
                return this.getAvailableSectionsFromMotor(contentSource, vehicleId, motorVehicleId);
            })
        );
    }

    private getAvailableSectionsFromMotor(
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
                // Note: getBucketNamesForType returns bucket names IF the tab exists or falls back to defaults.
                // We need to check if the tab actually exists in the response.
                // However, getBucketNamesForType has logic: if (!targetTabs.length) return fallbacks.
                // This implies that it ALWAYS returns something for standard types.
                // So checking `getBucketNamesForType(...).length > 0` is not enough to verify existence if fallbacks are always returned.
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
     * Matches an article row against the section's bucket list,
     * checking both bucket and parent_bucket for a match.
     */
    private matchesSectionBuckets(article: any, bucketNames: string[]): boolean {
        if (bucketNames.length === 0) return false;
        const b = (article.bucket || article.parent_bucket || '').toLowerCase();
        const pb = (article.parent_bucket || article.parentBucket || '').toLowerCase();
        return bucketNames.some(name => b.includes(name) || pb.includes(name));
    }

    /**
     * Load data for a specific dashboard section.
     * Uses `articles` as the list source. If the vehicle is **normalized**, Supabase only — no Motor
     * display fallback (empty UI until ingest fills rows). If not normalized, Motor API + lazy sync.
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
        if (!strategy) return;

        loadingSignal.set(true);

        from(this.dataSync.checkNormalizationStatus(vehicleId)).pipe(
            switchMap((isNormalized) => {
                return from(this.supabase.client.from('articles').select('*').eq('vehicle_id', vehicleId)).pipe(
                    map(({ data }) => {
                        if (!data || data.length === 0) {
                            return { isNormalized, mapped: null as any[] | null };
                        }
                        const bucketNames = strategy.alwaysIncludeBuckets.map(b => b.toLowerCase());
                        const filtered = data.filter((a: any) => this.matchesSectionBuckets(a, bucketNames));
                        if (filtered.length === 0) {
                            return { isNormalized, mapped: null };
                        }
                        return { isNormalized, mapped: filtered.map(strategy.mapper) };
                    }),
                    catchError(() => of({ isNormalized, mapped: null as any[] | null }))
                );
            })
        ).subscribe({
            next: ({ isNormalized, mapped }) => {
                if (mapped && mapped.length > 0) {
                    this.logger.info(`[VehicleData] Loaded ${section} from Supabase articles (${mapped.length} items)`);
                    updateState(mapped);
                    loadingSignal.set(false);
                    return;
                }
                if (isNormalized) {
                    updateState([]);
                    loadingSignal.set(false);
                    return;
                }
                this.loadSectionDataFromApi(section, contentSource, vehicleId, motorVehicleId, loadingSignal, updateState, errorCallback);
            },
            error: (err) => {
                this.logger.error('[VehicleData] Supabase read failed for', section, err);
                if (errorCallback) errorCallback(err);
                updateState([]);
                loadingSignal.set(false);
            }
        });
    }

    private loadSectionDataFromApi(
        section: string,
        contentSource: string,
        vehicleId: string,
        motorVehicleId: string | undefined,
        loadingSignal: WritableSignal<boolean>,
        updateState: (data: any[]) => void,
        errorCallback?: (error: any) => void
    ): void {
        const strategy = this.sectionStrategies[section];
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

                const uniqueBuckets = [...new Set(articles.map((a: any) => a.bucket))];
                this.logger.info(`[VehicleData] Section = ${section}, Total articles = ${articles.length}, Valid buckets = [${validBuckets.join(', ')}], All unique buckets in response=[${uniqueBuckets.join(', ')}]`);

                let filtered = articles.filter((a: any) =>
                    validBuckets.includes(a.bucket) ||
                    (a.parentBucket && validBuckets.includes(a.parentBucket))
                ).map(strategy.mapper);

                this.logger.info(`[VehicleData] Section = ${section}, Filtered count = ${filtered.length} `);

                // Handle Fallback Search (DTCs)
                if (strategy.enableFallbackSearch && filtered.length === 0) {
                    this.logger.info(`[VehicleData] No ${strategy.type} found with empty search.Triggering fallback search...`);
                    this.motorApi.searchArticles(contentSource, vehicleId, 'DTC').subscribe({
                        next: (fallbackRes) => {
                            const fallbackArticles = fallbackRes.body?.articleDetails || [];
                            this.logger.info(`[VehicleData] Fallback search returned ${fallbackArticles.length} articles`);

                            const fallbackFiltered = fallbackArticles.filter((a: any) =>
                                validBuckets.includes(a.bucket) ||
                                (a.parentBucket && validBuckets.includes(a.parentBucket))
                            ).map(strategy.mapper);

                            if (fallbackFiltered.length > 0) {
                                this.logger.info(`[VehicleData] Fallback search found ${fallbackFiltered.length} items.`);
                                updateState(fallbackFiltered);
                            } else {
                                updateState([]);
                            }
                        },
                        error: (err) => {
                            this.logger.error('[VehicleData] Fallback search failed', err);
                            updateState([]);
                        }
                    });
                    return;
                }

                updateState(filtered);
            },
            error: (err) => {
                this.logger.error(`[VehicleData] Failed to load ${section} `, err);
                loadingSignal.set(false);
                if (errorCallback) errorCallback(err);
            }
        });
    }

    /**
     * Load maintenance schedules. Normalized vehicles: Supabase only; empty rows trigger background
     * lazy sync (no Motor display). Pre-normalization: Motor API + lazy cache to Supabase.
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

        // 1. Check Supabase first
        from(this.dataSync.checkNormalizationStatus(vehicleId)).pipe(
            switchMap((isNormalized) => {
                if (isNormalized) {
                    this.logger.info(`[VehicleDataService] Loading maintenance from Supabase for ${vehicleId}`);
                    return from(this.supabase.client
                        .from('maintenance_task')
                        .select('id, action, item, description, interval_value, frequency_code, metadata_json')
                        .eq('vehicle_id', vehicleId)
                        .eq('interval_value', interval)
                    ).pipe(
                        map(({ data: mbData }) => {
                            if (!mbData || mbData.length === 0) {
                                void this.dataSync
                                    .lazySyncMaintenanceInterval(contentSource, vehicleId, interval, motorVehicleId)
                                    .catch(() => {});
                                return [];
                            }
                            return mbData.map((s: any) => ({
                                id: s.id,
                                description: s.description ?? s.item,
                                action: s.action,
                                interval: s.interval_value,
                                frequency: s.frequency_code,
                                taskMetadata:
                                    s.metadata_json && typeof s.metadata_json === 'object'
                                        ? (s.metadata_json as Record<string, unknown>)
                                        : null
                            }));
                        })
                    );
                }
                return of(null);
            })
        ).subscribe({
            next: (supabaseData) => {
                if (supabaseData !== null) {
                    updateState(supabaseData);
                    loadingSignal.set(false);
                } else {
                    this.loadMaintenanceSchedulesFromApi(contentSource, vehicleId, motorVehicleId, interval, loadingSignal, updateState, errorCallback);
                }
            },
            error: () => this.loadMaintenanceSchedulesFromApi(contentSource, vehicleId, motorVehicleId, interval, loadingSignal, updateState, errorCallback)
        });
    }

    private loadMaintenanceSchedulesFromApi(
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

        this.motorApi.getMaintenanceByIntervals(params.contentSource, params.vehicleId, 'miles', interval)
            .subscribe({
                next: (res) => {
                    loadingSignal.set(false);
                    const flat = flattenMaintenanceIntervalResponseBody(res.body, interval);
                    const schedules = flatMaintenanceToUiRows(flat, interval) as MaintenanceSchedule[];
                    updateState(schedules);
                    // Lazily cache this interval for next visit (fire-and-forget)
                    this.dataSync
                        .lazySyncMaintenanceInterval(contentSource, vehicleId, interval, motorVehicleId)
                        .catch(() => {});
                },
                error: (err) => {
                    this.logger.error('[VehicleDataService] Maintenance fetch failed:', err);
                    loadingSignal.set(false);
                    updateState([]);
                    if (errorCallback) errorCallback(err);
                }
            });
    }

    /**
     * Load parts. Normalized vehicles: Supabase only; empty full-catalog triggers lazy parts ingest.
     */
    loadParts(
        contentSource: string,
        vehicleId: string,
        motorVehicleId: string | undefined,
        searchTerm: string,
        loadingSignal: WritableSignal<boolean>,
        updateState: (data: any[]) => void,
        errorCallback?: (error: any) => void
    ): void {
        loadingSignal.set(true);

        from(this.dataSync.checkNormalizationStatus(vehicleId)).pipe(
            switchMap((isNormalized) => {
                if (isNormalized) {
                    let query = this.supabase.client
                        .from('parts')
                        .select('*')
                        .eq('vehicle_id', vehicleId);

                    if (searchTerm) {
                        query = query.ilike('description', `%${searchTerm}%`);
                    }

                    return from(query).pipe(
                        map(({ data: partsData }) => {
                            if (!partsData || partsData.length === 0) {
                                if (!searchTerm) {
                                    void this.dataSync.lazySyncParts(contentSource, vehicleId, motorVehicleId).catch(() => {});
                                }
                                return [];
                            }
                            return partsData.map(p => ({
                                partNumber: p.part_number,
                                description: p.description,
                                manufacturer: p.manufacturer || '',
                                listPrice: p.list_price,
                                dealerPrice: p.dealer_price || 0,
                                category: ''
                            }));
                        })
                    );
                }
                return of(null);
            })
        ).subscribe({
            next: (supabaseData) => {
                if (supabaseData !== null) {
                    updateState(supabaseData);
                    loadingSignal.set(false);
                } else {
                    this.motorApi.getParts(contentSource, vehicleId, searchTerm, motorVehicleId).subscribe({
                        next: (res) => {
                            updateState(res.body?.data || []);
                            loadingSignal.set(false);
                            if (!searchTerm) {
                                this.dataSync.lazySyncParts(contentSource, vehicleId, motorVehicleId).catch(() => {});
                            }
                        },
                        error: (err) => {
                            this.logger.error('[VehicleDataService] Parts API failed:', err);
                            loadingSignal.set(false);
                            if (errorCallback) errorCallback(err);
                        }
                    });
                }
            },
            error: (err) => {
                this.logger.error('[VehicleDataService] Supabase parts read failed:', err);
                loadingSignal.set(false);
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
