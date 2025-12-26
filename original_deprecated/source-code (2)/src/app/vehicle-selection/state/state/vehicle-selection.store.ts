import { Injectable } from '@angular/core';
import { EntityState, EntityStore, StoreConfig } from '@datorama/akita';
import { ModelAndVehicleId } from '~/generated/api/models';

export interface VehicleSelectionState extends EntityState<ModelAndVehicleId> {}

const initialState: VehicleSelectionState = {};

@Injectable({ providedIn: 'root' })
@StoreConfig({ name: 'vehicle-selection' })
export class VehicleSelectionStore extends EntityStore<VehicleSelectionState> {
  constructor() {
    super(initialState);
  }
}
