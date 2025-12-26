import { ErrorHandler, Injectable } from '@angular/core';
import { setLoading } from '@datorama/akita';
import { combineLatest, EMPTY, Observable, of, Subject } from 'rxjs';
import { catchError, map, switchMap, take, tap } from 'rxjs/operators';
import {
  ContentSource,
  IntervalType,
  MaintenanceScheduleApp,
  MaintenanceSchedulesByInterval,
  MaintenanceScheduleSeverity,
} from '~/generated/api/models';
import { AssetApi } from '~/generated/api/services';
import { SearchResultsFacade } from '~/search/state/search-results.facade';
import { filterNullish } from '~/utilities';
import { VehicleSelectionFacade } from '~/vehicle-selection/state/state/vehicle-selection.facade';
import { MaintenanceSchedulesByIndicatorQuery, MaintenanceSchedulesByIntervalQuery } from './maintenance-schedules.query';
import { MaintenanceSchedulesByIndicatorStore, MaintenanceSchedulesByIntervalStore } from './maintenance-schedules.store';

@Injectable({ providedIn: 'root' })
export class MaintenanceSchedulesFacade {
  constructor(
    private vehicleSelectionFacade: VehicleSelectionFacade,
    private assetApi: AssetApi,
    private maintenanceSchedulesQuery: MaintenanceSchedulesByIndicatorQuery,
    private maintenanceSchedulesStore: MaintenanceSchedulesByIndicatorStore,
    private maintenanceSchedulesByIntervalQuery: MaintenanceSchedulesByIntervalQuery,
    private maintenanceSchedulesByIntervalStore: MaintenanceSchedulesByIntervalStore,
    private errorHandler: ErrorHandler,
    public searchResultsFacade: SearchResultsFacade
  ) {}

  maintenanceSchedulesByIndicator$ = this.maintenanceSchedulesQuery.maintenanceSchedulesByIndicator$;
  maintenanceSchedulesByInterval$ = this.maintenanceSchedulesByIntervalQuery.maintenanceSchedulesByInterval$;
  maintenanceSchedulesByFrequency$ = new Subject<{ [frequency: string]: Array<MaintenanceScheduleApp> } | undefined>();

  motorVehicleId$ = this.searchResultsFacade.motorVehicleId$;

  hasIndicators$: Observable<boolean> = this.maintenanceSchedulesByIndicator$.pipe(map((ids) => ids.length > 1));

  pmsstError$ = this.maintenanceSchedulesQuery.selectError();

  searchByIndicators(severity?: MaintenanceScheduleSeverity): void {
    combineLatest([
      this.vehicleSelectionFacade.activeVehicleId$.pipe(filterNullish()),
      this.motorVehicleId$.pipe(),
      this.vehicleSelectionFacade.contentSource$,
      this.searchResultsFacade.searchTerm$,
    ])
      .pipe(
        take(1),
        tap(() => this.maintenanceSchedulesStore.reset()),
        switchMap(([vehicleId, motorVehicleId, contentSource, searchTerm]) => {
          if (contentSource === undefined || !vehicleId || (contentSource !== ContentSource.Motor && !motorVehicleId)) return of(null);
          return this.assetApi
            .getIndicatorsWithMaintenanceSchedules({
              contentSource: ContentSource.Motor,
              vehicleId: motorVehicleId ? motorVehicleId : vehicleId,
              severity,
              searchTerm,
            })
            .pipe(
              setLoading(this.maintenanceSchedulesStore),
              catchError((e) => {
                this.maintenanceSchedulesStore.setError(e);
                this.errorHandler.handleError(e);
                return EMPTY;
              })
            );
        })
      )
      .subscribe((pmsstResponse) => {
        this.maintenanceSchedulesStore.set(pmsstResponse?.body?.indicators ?? []);
      });
  }

  searchByInterval(intervalType?: IntervalType, interval?: number, severity?: MaintenanceScheduleSeverity): void {
    combineLatest([
      this.vehicleSelectionFacade.activeVehicleId$.pipe(filterNullish()),
      this.motorVehicleId$.pipe(),
      this.vehicleSelectionFacade.contentSource$,
      this.searchResultsFacade.searchTerm$,
    ])
      .pipe(
        take(1),
        tap(() => this.maintenanceSchedulesByIntervalStore.reset()),
        switchMap(([vehicleId, motorVehicleId, contentSource, searchTerm]) => {
          if (contentSource === undefined || !vehicleId || (contentSource !== ContentSource.Motor && !motorVehicleId)) return of(null);
          return this.assetApi
            .getMaintenanceSchedulesByInterval({
              contentSource: ContentSource.Motor,
              vehicleId: motorVehicleId ? motorVehicleId : vehicleId,
              intervalType,
              interval,
              severity,
              searchTerm,
            })
            .pipe(
              setLoading(this.maintenanceSchedulesByIntervalStore),
              catchError((e) => {
                this.maintenanceSchedulesStore.setError(e);
                this.errorHandler.handleError(e);
                return EMPTY;
              })
            );
        })
      )
      .subscribe((pmsstResponse) => {
        const maintenanceSchedulesByIntervals: Array<MaintenanceSchedulesByInterval> = [];
        if (pmsstResponse?.body) {
          maintenanceSchedulesByIntervals.push(pmsstResponse?.body);
        }
        this.maintenanceSchedulesByIntervalStore.set(maintenanceSchedulesByIntervals ?? []);
      });
  }

  searchByFrequency(frequencyTypeCode: string, severity?: MaintenanceScheduleSeverity): void {
    combineLatest([
      this.vehicleSelectionFacade.activeVehicleId$.pipe(filterNullish()),
      this.motorVehicleId$.pipe(),
      this.vehicleSelectionFacade.contentSource$,
      this.searchResultsFacade.searchTerm$,
    ])
      .pipe(
        take(1),
        switchMap(([vehicleId, motorVehicleId, contentSource, searchTerm]) => {
          if (contentSource === undefined || !vehicleId || (contentSource !== ContentSource.Motor && !motorVehicleId)) return of(null);
          return this.assetApi
            .getMaintenanceSchedulesByFrequency({
              contentSource: ContentSource.Motor,
              vehicleId: motorVehicleId ? motorVehicleId : vehicleId,
              frequencyTypeCode,
              severity,
              searchTerm
            })
            .pipe(
              catchError((e) => {
                this.maintenanceSchedulesStore.setError(e);
                this.errorHandler.handleError(e);
                return EMPTY;
              })
            );
        })
      )
      .subscribe((pmsstResponse) => {
        this.maintenanceSchedulesByFrequency$.next({ [frequencyTypeCode]: pmsstResponse?.body?.applications ?? [] });
      });
  }
}
