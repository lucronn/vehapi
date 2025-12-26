import { Injectable } from '@angular/core';
import { EntityState, EntityStore, StoreConfig } from '@datorama/akita';
import { Indicator, MaintenanceSchedulesByInterval } from '~/generated/api/models';

export interface MaintenanceSchedulesByIndicatorState extends EntityState<Indicator> {}

const initialStateByIndicator: MaintenanceSchedulesByIndicatorState = {};

@Injectable({ providedIn: 'root' })
@StoreConfig({ name: 'maintenance-schedules-by-indicators', resettable: true, idKey: 'name' })
export class MaintenanceSchedulesByIndicatorStore extends EntityStore<MaintenanceSchedulesByIndicatorState> {
  constructor() {
    super(initialStateByIndicator);
  }
}

export interface MaintenanceSchedulesByIntervalState extends EntityState<MaintenanceSchedulesByInterval> {}

const initialStateByInterval: MaintenanceSchedulesByIntervalState = {};

@Injectable({ providedIn: 'root' })
@StoreConfig({ name: 'maintenance-schedules-by-intervals', resettable: true, idKey: 'name' })
export class MaintenanceSchedulesByIntervalStore extends EntityStore<MaintenanceSchedulesByIntervalState> {
  constructor() {
    super(initialStateByInterval);
  }
}
