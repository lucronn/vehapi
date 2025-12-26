import { ErrorHandler, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { setLoading } from '@datorama/akita';
import { RouterQuery } from '@datorama/akita-ng-router-store';
import { BehaviorSubject, combineLatest, EMPTY, Observable, of } from 'rxjs';
import { catchError, debounceTime, filter, map, switchMap, take } from 'rxjs/operators';
import { UserSettingsService } from '~/core/user-settings/user-settings.service';
import { ContentSource, ModelAndVehicleId } from '~/generated/api/models';
import { VehicleApi } from '~/generated/api/services';
import { QueryStringParameters } from '~/url-parameters';
import { filterNullish } from '~/utilities';
import { VehicleSelectionQuery } from './vehicle-selection.query';
import { VehicleSelectionStore } from './vehicle-selection.store';
type NullableString = string | null | undefined;

export interface SelectedVehicle {
  id: number;
  vehicleName?: string | null;
  contentSource?: ContentSource;
  vehicleId?: string;
  vin?: string | null;
  motorVehicleId?: string | null;
}
@Injectable({ providedIn: 'root' })
export class VehicleSelectionFacade {
  hasVehicleSelected$ = new BehaviorSubject(this.getSelectedVehicles().length > 0);
  constructor(
    private routerQuery: RouterQuery,
    private vehicleApi: VehicleApi,
    private vehicleSelectionStore: VehicleSelectionStore,
    private vehicleSelectionQuery: VehicleSelectionQuery,
    private router: Router,
    private errorHandler: ErrorHandler,
    public userSettingsService: UserSettingsService
  ) {
    combineLatest([this.contentSource$, this.vehicleIdChoices$])
      .pipe(
        debounceTime(0),
        filter((data): data is [ContentSource, Array<string>] => data.every(filterNullish)),
        switchMap(([contentSource, vehicleIdChoices]) => {
          if (contentSource && vehicleIdChoices) {
            return this.vehicleApi.getVehicles({ contentSource, body: { vehicleIds: vehicleIdChoices } }).pipe(
              setLoading(this.vehicleSelectionStore),
              catchError((e) => {
                this.errorHandler.handleError(e);
                return EMPTY;
              })
            );
          }
          return EMPTY; // Ensure all code paths return an Observable
        })
      )
      .subscribe(({ body: entities }) => {
        this.vehicleSelectionStore.set(entities ?? []);
      });
    combineLatest([this.activeVehicleId$, this.contentSource$, this.vehicleVin$, this.motorVehicleId$])
      .pipe(debounceTime(0))
      .subscribe(([vehicleId, contentSource, vin, motorVehicleId]) => {
        if (vehicleId && contentSource) {
          this.getVehicleYMM(contentSource, vehicleId).subscribe((vehicleName) => {
            if (vin) {
              vehicleName = `${vehicleName} - ${vin}`;
            }
            this.addVehicleSelectionToSessionStorage(vehicleName, vehicleId, contentSource, vin, motorVehicleId);
          });
        }
      });
  }
  contentSource$ = this.routerQuery.selectQueryParams<ContentSource | undefined>(QueryStringParameters.contentSource);
  activeVehicleId$ = this.routerQuery.selectQueryParams<string | undefined>(QueryStringParameters.vehicleId);
  motorVehicleId$ = this.routerQuery.selectQueryParams<string | undefined>(QueryStringParameters.motorVehicleId);
  vehicleVin$ = this.routerQuery.selectQueryParams<string | undefined>(QueryStringParameters.vin);
  vehicleIdChoices$ = this.routerQuery.selectQueryParams<string | undefined>(QueryStringParameters.vehicleIdChoices).pipe(map((v) => v?.split(',')));

  all$ = this.vehicleSelectionQuery.selectAll({ sortBy: 'model' });
  loading$ = this.vehicleSelectionQuery.selectLoading();

  setVehicleId(vehicleId?: string | null) {
    let ymmeSelectorMode: string | undefined;
    let contentSource: ContentSource | undefined;
    const result = new Array<ModelAndVehicleId>();
    this.userSettingsService.ymmeSelectorMode$.pipe(take(1)).subscribe((val) => {
      ymmeSelectorMode = val;
    });
    this.contentSource$.pipe(take(1)).subscribe((val) => {
      contentSource = val;
    });
    if (contentSource !== ContentSource.Motor) {
      this.vehicleApi.getMotorVehicleDetails({ contentSource: contentSource!, vehicleId: vehicleId! }).subscribe((data) => {
        data.body?.forEach((item) => {
          item.engines?.forEach((engine) => {
            result.push({ id: engine.id, model: `${item.model} ${engine.name}` });
          });
        });
        this.router.navigate([], {
          queryParams: {
            [QueryStringParameters.vehicleId]: vehicleId,
            [QueryStringParameters.articleIdTrail]: null,
            [QueryStringParameters.bookmarkId]: null,
            ...(result.length === 1 && { [QueryStringParameters.motorVehicleId]: result[0].id }),
            ...(ymmeSelectorMode !== 'Disabled' && { [QueryStringParameters.vehicleIdChoices]: null }),
          },
          queryParamsHandling: 'merge',
          ...(ymmeSelectorMode !== 'Disabled' && { replaceUrl: true }),
        });
      });
    } else {
      this.router.navigate([], {
        queryParams: {
          [QueryStringParameters.vehicleId]: vehicleId,
          [QueryStringParameters.articleIdTrail]: null,
          [QueryStringParameters.bookmarkId]: null,
          ...(ymmeSelectorMode !== 'Disabled' && { [QueryStringParameters.vehicleIdChoices]: null }),
        },
        queryParamsHandling: 'merge',
        ...(ymmeSelectorMode !== 'Disabled' && { replaceUrl: true }),
      });
    }
  }
  getEngineSubmodels(year: number, make: string): Observable<Array<ModelAndVehicleId>> {
    return this.vehicleApi.getMotorModels({ year, make }).pipe(
      map((response) => [...response.body!].sort((a, b) => a.model.localeCompare(b.model))),
      catchError((error) => {
        return of([]);
      })
    );
  }

  getMotorModels(contentSource: ContentSource, vehicleId: string) {
    return this.vehicleApi.getMotorVehicleDetails({ contentSource, vehicleId }).pipe(
      map((response) => [...response.body!]),
      catchError((error) => {
        return of([]);
      })
    );
  }

  getVehicleYMM(contentSource: ContentSource, vehicleId: string) {
    return this.vehicleApi.getVehicleName({ contentSource, vehicleId }).pipe(
      map((response) => response.body),
      catchError((error) => {
        return of(undefined);
      })
    );
  }

  setMotorVehicleId(vehicleId?: string | null) {
    this.router.navigate([], {
      queryParams: {
        [QueryStringParameters.motorVehicleId]: vehicleId,
        [QueryStringParameters.bookmarkId]: null,
        [QueryStringParameters.articleIdTrail]: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  addVehicleSelectionToSessionStorage(
    vehicleName: NullableString,
    vehicleId: string | undefined,
    contentSource: ContentSource | undefined,
    vin: NullableString,
    motorVehicleId: NullableString
  ) {
    const selectedVehicles = this.getSelectedVehicles();
    const vehicleIndex = selectedVehicles.findIndex((item) => item.vehicleId === vehicleId);
    if (vehicleIndex > -1) {
      selectedVehicles[vehicleIndex].id = Date.now();
    } else {
      selectedVehicles.push({ id: Date.now(), vehicleId, contentSource, vehicleName, vin, motorVehicleId });
    }
    sessionStorage.setItem('selectedVehicles', JSON.stringify(selectedVehicles));
    this.hasVehicleSelected$.next(true);
  }

  getSelectedVehicles() {
    const selectedVehicles = JSON.parse(sessionStorage.getItem('selectedVehicles') ?? '[]') as Array<SelectedVehicle>;
    selectedVehicles.sort((a, b) => b.id - a.id);
    let recentVehiclesCount = 10;
    this.userSettingsService.recentVehiclesCount$.pipe(take(1)).subscribe((val) => {
      recentVehiclesCount = parseInt(val, 10);
    });
    return selectedVehicles.length > recentVehiclesCount ? selectedVehicles.splice(0, recentVehiclesCount) : selectedVehicles;
  }
}
