import { Injectable } from '@angular/core';
import { QueryEntity } from '@datorama/akita';
import { VehicleSelectionState, VehicleSelectionStore } from './vehicle-selection.store';

@Injectable({ providedIn: 'root' })
export class VehicleSelectionQuery extends QueryEntity<VehicleSelectionState> {
  constructor(protected store: VehicleSelectionStore) {
    super(store);
  }
}
