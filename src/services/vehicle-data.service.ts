import { Injectable, inject, WritableSignal } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, tap, catchError, timeout } from 'rxjs/operators';
import { MotorApiService } from './motor-api.service';
import { FirebaseService } from './firebase.service';
import { ApiResponse, Dtc, Tsb, Procedure, WiringDiagram, ComponentLocation, Spec, Fluid } from '../models/motor.models';

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
    private firebase = inject(FirebaseService);

    /**
   * Generic helper to implement the "Build-As-Used" caching pattern with granular loading
   * 
   * TEMPORARILY DISABLED: Firebase caching disabled, using Motor API only
   */
    loadWithCache<T>(options: DataLoadOptions<T>): void {
        const { loadingSignal, getCurrentState, updateState, getFromCache, getFromApi, saveToCache } = options;

        // Skip if already have data
        if (getCurrentState().length > 0) {
            loadingSignal.set(false);
            return;
        }

        loadingSignal.set(true);

        // DISABLED: Cache check - always fetch from API
        // getFromCache().then(cached => {
        //   if (cached && cached.length > 0) {
        //     console.log('[Cache Hit] Loading from Firebase');
        //     updateState(cached);
        //     loadingSignal.set(false);
        //   } else {
        // Always fetch from API
        console.log('[Cache DISABLED] Fetching from Motor API');
        getFromApi().subscribe({
            next: (res) => {
                const data = res.body.data as T[];
                updateState(data);
                loadingSignal.set(false);
                // DISABLED: Cache save
                // saveToCache(data);
            },
            error: (err) => {
                console.error('Failed to load data', err);
                loadingSignal.set(false);
            }
        });
        //   }
        // });
    }

    /**
     * Load specs and fluids using forkJoin pattern
     * Returns observable that completes with both datasets
     * 
     * TEMPORARILY DISABLED: Firebase caching disabled, using Motor API only
     */
    loadSpecs(
        contentSource: string,
        vehicleId: string
    ): Observable<{ specs: Spec[], fluids: Fluid[] }> {
        // DISABLED: Cache check - always fetch from API
        const getFluids = () => {
            // return from(this.firebase.getFluidList(contentSource, vehicleId)).pipe(
            //   switchMap(cached => {
            //     if (cached) {
            //       console.log('[loadSpecs] Fluids cached found');
            //       return of(cached);
            //     }
            console.log('[Cache DISABLED] Fluids fetching from API...');
            return this.motorApi.getFluids(contentSource, vehicleId).pipe(
                map(res => res.body.data)
                // DISABLED: Cache save
                // tap(data => {
                //   console.log('[loadSpecs] Fluids API success, saving...');
                //   this.firebase.saveFluidList(contentSource, vehicleId, data);
                // })
            );
            //   })
            // );
        };

        const getSpecs = () => {
            // return from(this.firebase.getSpecList(contentSource, vehicleId)).pipe(
            //   switchMap(cached => {
            //     if (cached) {
            //       console.log('[loadSpecs] Specs cached found');
            //       return of(cached);
            //     }
            console.log('[Cache DISABLED] Specs fetching from API...');
            return this.motorApi.getSpecs(contentSource, vehicleId).pipe(
                map(res => res.body.data)
                // DISABLED: Cache save
                // tap(data => {
                //   console.log('[loadSpecs] Specs API success, saving...');
                //   this.firebase.saveSpecList(contentSource, vehicleId, data);
                // })
            );
            //   })
            // );
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
     * Load data for a specific dashboard section
     */
    loadSectionData(
        section: 'dtcs' | 'tsbs' | 'procedures' | 'diagrams',
        contentSource: string,
        vehicleId: string,
        loadingSignal: WritableSignal<boolean>,
        updateState: (data: any[]) => void
    ): void {
        switch (section) {
            case 'dtcs':
                this.loadWithCache<Dtc>({
                    loadingSignal,
                    getCurrentState: () => [], // Caller tracks current state
                    updateState,
                    getFromCache: () => this.firebase.getDtcList(contentSource, vehicleId),
                    getFromApi: () => this.motorApi.getDtcs(contentSource, vehicleId),
                    saveToCache: (data) => this.firebase.saveDtcList(contentSource, vehicleId, data)
                });
                break;

            case 'tsbs':
                this.loadWithCache<Tsb>({
                    loadingSignal,
                    getCurrentState: () => [],
                    updateState,
                    getFromCache: () => this.firebase.getTsbList(contentSource, vehicleId),
                    getFromApi: () => this.motorApi.getTsbs(contentSource, vehicleId),
                    saveToCache: (data) => this.firebase.saveTsbList(contentSource, vehicleId, data)
                });
                break;

            case 'procedures':
                this.loadWithCache<Procedure>({
                    loadingSignal,
                    getCurrentState: () => [],
                    updateState,
                    getFromCache: () => this.firebase.getProcedureList(contentSource, vehicleId),
                    getFromApi: () => this.motorApi.getProcedures(contentSource, vehicleId),
                    saveToCache: (data) => this.firebase.saveProcedureList(contentSource, vehicleId, data)
                });
                break;

            case 'diagrams':
                this.loadWithCache<WiringDiagram | ComponentLocation>({
                    loadingSignal,
                    getCurrentState: () => [],
                    updateState,
                    getFromCache: () => this.firebase.getAllDiagramList(contentSource, vehicleId),
                    getFromApi: () => this.motorApi.getAllDiagrams(contentSource, vehicleId),
                    saveToCache: (data) => this.firebase.saveAllDiagramList(contentSource, vehicleId, data)
                });
                break;
        }
    }
}
