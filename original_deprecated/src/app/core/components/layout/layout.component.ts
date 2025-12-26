import { ChangeDetectionStrategy, Component } from '@angular/core';
import { combineLatest, merge, Observable, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, first, map, switchMap, tap } from 'rxjs/operators';
import { AssetsFacade } from '~/assets/state/assets.facade';
import { LayoutFacade } from '~/core/state/layout.facade';
import { ExpansionLevel } from '~/core/state/layout.store';
import { UserSettingsService } from '~/core/user-settings/user-settings.service';
import { ContentSource, ModelAndVehicleId } from '~/generated/api/models';
import { SearchResultsFacade } from '~/search/state/search-results.facade';
import { detectMobile, filterNullish, modelSelectorArticleIds } from '~/utilities';
import { VehicleSelectionFacade } from '~/vehicle-selection/state/state/vehicle-selection.facade';

@Component({
  selector: 'mtr-layout',
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayoutComponent {
  constructor(
    public assetsFacade: AssetsFacade,
    public layoutFacade: LayoutFacade,
    public searchResultsFacade: SearchResultsFacade,
    public vehicleSelectionFacade: VehicleSelectionFacade,
    public userSettingsService: UserSettingsService
  ) {}
  IsAwaitingApiResponse: boolean = false;
  /** Create a new search results panel when the selected filter or search term changes to reset scroll positions and bucket expanded states. */
  searchPanelRecreationTrigger$ = merge(this.searchResultsFacade.selectedFilter$, this.searchResultsFacade.searchTerm$);

  isLoadingContent$ = merge(this.assetsFacade.rootLoading$);

  ExpansionLevel = ExpansionLevel;

  shouldDisplayModelSelector$: Observable<boolean> = this.vehicleSelectionFacade.vehicleIdChoices$.pipe(
    map((vehicleIdChoices) => !!vehicleIdChoices),
    distinctUntilChanged()
  );

  shouldDisplayEngineSubModelSelector$: Observable<boolean> = combineLatest([
    this.vehicleSelectionFacade.contentSource$.pipe(filterNullish()),
    this.assetsFacade.rootId$,
    this.searchResultsFacade.motorVehicleId$,
  ]).pipe(
    map(([contentSource, articleId, motorVehicleId]) => {
      return contentSource !== ContentSource.Motor && !motorVehicleId && modelSelectorArticleIds.indexOf(articleId!) !== -1;
    }),
    distinctUntilChanged()
  );

  modelDetails$: Observable<Array<ModelAndVehicleId>> = combineLatest([
    this.vehicleSelectionFacade.activeVehicleId$,
    this.vehicleSelectionFacade.contentSource$,
  ]).pipe(
    tap(() => {
      this.IsAwaitingApiResponse = true;
    }),
    debounceTime(0),
    switchMap(([vehicleId, contentSource]) => {
      if (!vehicleId || contentSource === ContentSource.Motor) {
        return of(new Array<ModelAndVehicleId>());
      }

      const result = new Array<ModelAndVehicleId>();
      return this.vehicleSelectionFacade.getMotorModels(contentSource!, vehicleId).pipe(
        map((models) => {
          models.forEach((item) => {
            item.engines?.forEach((engine) => {
              result.push({ id: engine.id, model: `${item.model} ${engine.name}` });
            });
          });
          return result;
        })
      );
    }),
    tap(() => {
      this.IsAwaitingApiResponse = false;
    })
  );

  modelSelector$: Observable<string> = combineLatest([
    this.vehicleSelectionFacade.activeVehicleId$.pipe(filterNullish()),
    this.vehicleSelectionFacade.contentSource$.pipe(filterNullish()),
    this.userSettingsService.ymmeSelectorMode$,
    this.vehicleSelectionFacade.vehicleVin$,
  ]).pipe(
    debounceTime(0),
    switchMap(([vehicleId, contentSource, ymmeSelectorMode, vin]) => {
      if (ymmeSelectorMode === 'Disabled') return of('');
      return this.vehicleSelectionFacade.getVehicleYMM(contentSource, vehicleId).pipe(
        map((vehicleName) => {
          if (vin) {
            vehicleName = `${vehicleName} - ${vin}`;
          }
          return vehicleName ?? '';
        })
      );
    }),
    first(),
    distinctUntilChanged()
  );

  isMotorVehicleModel$ = combineLatest([
    this.assetsFacade.isLaborTab$,
    this.assetsFacade.isMaintenanceScheduleTab$,
    this.userSettingsService.enableMotorVehicleModel$
  ]).pipe(
    map(([isLabor, isSchedule, isMotorEnabled]) => 
      (isLabor || isSchedule) && isMotorEnabled
    )
  );

  motorModelSelector$: Observable<string> = combineLatest([
    this.searchResultsFacade.motorVehicleId$.pipe(filterNullish())
  ]).pipe(
    debounceTime(0),
    switchMap(([vehicleId]) => {      
      return this.vehicleSelectionFacade.getMotorModels(ContentSource.Motor, vehicleId).pipe(
        map((data) => {  
          const result = new Array<ModelAndVehicleId>();   
          data?.forEach((item) => {
            item.engines?.forEach((engine) => {
              result.push({ id: engine.id, model: `${item.model} ${engine.name}` });
            });
          });    
          const match = result.find(r => r.id === vehicleId);
          return match?.model ?? '';
        })
      );
    }),
    first(),
    distinctUntilChanged()
  );


  filterModelItems = (arr: Array<ModelAndVehicleId>, query: string) => {
    if (query && arr.find((el) => el.model.toLowerCase().indexOf(query.toLowerCase()) !== -1))
      return arr.filter((el) => el.model.toLowerCase().indexOf(query.toLowerCase()) !== -1);
    return arr;
  };
  
  detectMobile(){
    return detectMobile();
  }
}
