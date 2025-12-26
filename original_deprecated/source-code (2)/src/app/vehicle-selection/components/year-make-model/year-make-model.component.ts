import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ErrorHandler } from '@angular/core';
import { Router } from '@angular/router';
import { RouterQuery } from '@datorama/akita-ng-router-store';
import { combineLatest, EMPTY, Observable, of } from 'rxjs';
import { catchError, debounceTime, map, shareReplay, startWith, switchMap, tap } from 'rxjs/operators';
import { UserSettingsService } from '~/core/user-settings/user-settings.service';
import { ContentSource, ModelAndVehicleId } from '~/generated/api/models';
import { EngineDetails } from '~/generated/api/models/engine-details';
import { VehicleApi } from '~/generated/api/services';
import { FilterTab } from '~/search/filter-tab-names';
import { QueryStringParameters } from '~/url-parameters';
import { SelectedVehicle, VehicleSelectionFacade } from '~/vehicle-selection/state/state/vehicle-selection.facade';

@Component({
  selector: 'mtr-year-make-model',
  templateUrl: './year-make-model.component.html',
  styleUrls: ['./year-make-model.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class YearMakeModelComponent {
  constructor(
    public router: Router,
    public routerQuery: RouterQuery,
    public vehicleApi: VehicleApi,
    private errorHandler: ErrorHandler,
    private cd: ChangeDetectorRef,
    public userSettingsService: UserSettingsService,
    public vehicleSelectionFacade: VehicleSelectionFacade
  ) {}
  year$ = this.routerQuery.selectQueryParams<string | undefined>(QueryStringParameters.year).pipe(map((year) => Number(year) || undefined));
  make$ = this.routerQuery.selectQueryParams<string | undefined>(QueryStringParameters.make);
  model?: ModelAndVehicleId;
  contentSource?: ContentSource;
  engines?: Array<EngineDetails>;
  engine?: EngineDetails;
  vin: string = '';
  isAwaitingApiResponse: boolean = false;
  isInvalidVin: boolean = false;
  unAuthorizedVinError?: string;
  recentVehicle?: object;
  years$: Observable<Array<number>> = this.vehicleApi.getYears().pipe(
    map((response) => [...response.body!].sort((a, b) => b - a)),
    // Prevent multiple HTTP requests from being sent if there are multiple subscriptions to this observable
    shareReplay({ bufferSize: 1, refCount: true })
  );

  makes$ = this.year$.pipe(
    switchMap((year) => {
      if (year === undefined) {
        return of(new Array<string>());
      }
      return this.vehicleApi.getMakes({ year }).pipe(
        map((response) => response.body!.map((m) => m.makeName).sort()),
        // Reset the list at the start of a new request
        startWith(new Array<string>()),
        catchError((e) => {
          this.errorHandler.handleError(e);
          return EMPTY;
        })
      );
    }),
    // Prevent multiple HTTP requests from being sent if there are multiple subscriptions to this observable
    shareReplay({ bufferSize: 1, refCount: true })
  );

  models$ = combineLatest([this.year$, this.make$]).pipe(
    debounceTime(0), // Only execute once if multiple values change at the same time
    switchMap(([year, make]) => {
      if (year === undefined || make === undefined) {
        return of(new Array<ModelAndVehicleId>());
      }
      return this.vehicleApi.getModels({ year, make }).pipe(
        tap((response) => {
          this.contentSource = response.body!.contentSource;
        }),
        map((response) => [...response.body!.models].sort((a, b) => a.model.localeCompare(b.model))),
        startWith(new Array<ModelAndVehicleId>()),
        catchError((e) => {
          this.errorHandler.handleError(e);
          return EMPTY;
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  setYear(year: number) {
    this.engines = undefined;
    this.router.navigate([], {
      queryParams: { [QueryStringParameters.year]: year, [QueryStringParameters.make]: null },
      queryParamsHandling: 'merge',
    });
  }

  setMake(make: string) {
    this.engines = undefined;
    this.router.navigate([], {
      queryParams: { [QueryStringParameters.make]: make },
      queryParamsHandling: 'merge',
    });
  }

  setModel(model: ModelAndVehicleId) {
    if (!model.engines || model.engines.length === 0) {
      if (this.contentSource !== ContentSource.Motor) {
        this.initializeVehicleSelectionAndNavigation(this.contentSource!, model.id);
      } else {
        this.router.navigate(['docs', FilterTab.All], {
          queryParams: { [QueryStringParameters.vehicleId]: model.id, [QueryStringParameters.contentSource]: this.contentSource },
        });
      }
    } else if (model.engines.length === 1) {
      this.engines = model.engines;
      this.setEngine(model.engines[0]);
    } else {
      this.engines = model.engines;
    }
  }

  setEngine(model: EngineDetails) {
    if (this.engines && this.engines.length > 0) {
      this.router.navigate(['docs', FilterTab.All], {
        queryParams: { [QueryStringParameters.vehicleId]: model.id, [QueryStringParameters.contentSource]: this.contentSource },
      });
    }
  }

  hasEngines() {
    return this.engines && this.engines.length > 0;
  }
  findVehicleWithVIN(vin: string) {
    this.isAwaitingApiResponse = true;
    this.clearErrorMsg();
    this.vehicleApi.getVehicleByVin({ vin }).subscribe((data) => {
      this.isAwaitingApiResponse = false;
      this.contentSource = data.body?.contentSource;
      if (data.body?.errorMessage) {
        this.unAuthorizedVinError = data.body?.errorMessage;
      } else if (data.body?.vehicleId === '' && data.body?.vehicleIdChoices === '') {
        this.isInvalidVin = true;
      } else {
        const queryParams = {
          [QueryStringParameters.vin]: vin,
          [QueryStringParameters.contentSource]: this.contentSource,
          ...(data.body?.vehicleIdChoices &&
            data.body?.vehicleIdChoices?.length > 0 && { [QueryStringParameters.vehicleIdChoices]: data.body?.vehicleIdChoices }),
          ...(data.body?.vehicleId && data.body?.vehicleId?.length > 0 && { [QueryStringParameters.vehicleId]: data.body?.vehicleId }),
          ...(data.body?.motorVehicleId &&
            data.body?.motorVehicleId?.length > 0 && { [QueryStringParameters.motorVehicleId]: data.body?.motorVehicleId }),
        };

        this.router.navigate(['docs', FilterTab.All], {
          queryParams,
        });
      }
      this.cd.detectChanges();
    });
  }
  clearErrorMsg() {
    this.isInvalidVin = false;
    this.unAuthorizedVinError = undefined;
  }
  navigateToVehicle(vehicle: SelectedVehicle) {
    const queryParams = {
      [QueryStringParameters.contentSource]: vehicle.contentSource,
      [QueryStringParameters.vehicleId]: vehicle.vehicleId,
      ...(vehicle.vin && vehicle.vin.length > 0 && { [QueryStringParameters.vin]: vehicle.vin }),
      ...(vehicle.motorVehicleId && vehicle.motorVehicleId.length > 0 && { [QueryStringParameters.motorVehicleId]: vehicle.motorVehicleId }),
    };
    this.router.navigate(['docs', FilterTab.All], {
      queryParams,
    });
  }
  initializeVehicleSelectionAndNavigation(contentSource: ContentSource, vehicleId: string) {
    const result = new Array<ModelAndVehicleId>();
    this.isAwaitingApiResponse = true;
    this.vehicleApi.getMotorVehicleDetails({ contentSource, vehicleId }).subscribe((data) => {
      this.isAwaitingApiResponse = false;
      data.body?.forEach((item) => {
        item.engines?.forEach((engine) => {
          result.push({ id: engine.id, model: `${item.model} ${engine.name}` });
        });
      });

      const queryParams = {
        [QueryStringParameters.vehicleId]: vehicleId,
        [QueryStringParameters.contentSource]: contentSource,
        ...(result.length === 1 && { [QueryStringParameters.motorVehicleId]: result[0].id }),
      };

      this.router.navigate(['docs', FilterTab.All], {
        queryParams,
      });

      this.cd.detectChanges();
    });
  }
}
