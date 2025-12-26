import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { combineLatest, Observable, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, first, map, switchMap } from 'rxjs/operators';
import { AssetsFacade } from '~/assets/state/assets.facade';
import { UserSettingsService } from '~/core/user-settings/user-settings.service';
import { ContentSource, Labor } from '~/generated/api/models';
import { filterNullish } from '~/utilities';
import { VehicleSelectionFacade } from '~/vehicle-selection/state/state/vehicle-selection.facade';

@Component({
  selector: 'mtr-labor-operation[labor]',
  templateUrl: './labor-operation.component.html',
  styleUrls: ['./labor-operation.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LaborOperationComponent implements OnInit {

  constructor(
    public assetsFacade: AssetsFacade,
    public userSettingsService: UserSettingsService,
    public vehicleSelectionFacade: VehicleSelectionFacade
  ) {}
  @Input()
  labor!: Labor;

  isMainPartsExpanded = false;
  isOptionalPartsExpanded: { [_: number]: boolean } = {};

  modelSelector$: Observable<string> = combineLatest([
    this.vehicleSelectionFacade.activeVehicleId$.pipe(filterNullish()),
    this.vehicleSelectionFacade.motorVehicleId$.pipe(),
    this.userSettingsService.userSettingsPrintHeader$,
  ]).pipe(
    debounceTime(0),
    switchMap(([vehicleId, motorVehicleId, userSettingsPrintHeader]) => {
      if (userSettingsPrintHeader?.printDisplayVehicleDetails !== 'Yes') return of('');
      return this.vehicleSelectionFacade.getVehicleYMM(ContentSource.Motor, motorVehicleId ?? vehicleId).pipe(
        map((vehicleName) => {
          return vehicleName ?? '';
        })
      );
    }),
    first(),
    distinctUntilChanged()
  );

  ngOnInit(): void {
    if (this.labor?.mainOperation.parts.length > 0) {
      this.isMainPartsExpanded = true;
    }
  }
}
