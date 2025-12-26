import { Injectable } from '@angular/core';
import { QueryEntity } from '@datorama/akita';
import { Observable } from 'rxjs';
import { Indicator, MaintenanceSchedulesByInterval } from '~/generated/api/models';
import {
  MaintenanceSchedulesByIndicatorState,
  MaintenanceSchedulesByIndicatorStore,
  MaintenanceSchedulesByIntervalState,
  MaintenanceSchedulesByIntervalStore,
} from './maintenance-schedules.store';

@Injectable({ providedIn: 'root' })
export class MaintenanceSchedulesByIndicatorQuery extends QueryEntity<MaintenanceSchedulesByIndicatorState> {
  constructor(protected store: MaintenanceSchedulesByIndicatorStore) {
    super(store);
  }

  maintenanceSchedulesByIndicator$: Observable<Array<Indicator>> = this.selectAll();
}

@Injectable({ providedIn: 'root' })
export class MaintenanceSchedulesByIntervalQuery extends QueryEntity<MaintenanceSchedulesByIntervalState> {
  constructor(protected store: MaintenanceSchedulesByIntervalStore) {
    super(store);
  }

  maintenanceSchedulesByInterval$: Observable<Array<MaintenanceSchedulesByInterval>> = this.selectAll();
}
