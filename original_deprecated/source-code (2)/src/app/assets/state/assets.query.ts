import { Injectable } from '@angular/core';
import { Query, QueryEntity } from '@datorama/akita';
import { AssetsState, LaborState, LaborStore, LeafAssetsStore, RootAssetsStore, VehiclePartsState, VehiclePartsStore } from './assets.store';

@Injectable({ providedIn: 'root' })
export class RootAssetsQuery extends Query<AssetsState> {
  constructor(protected store: RootAssetsStore) {
    super(store);
  }
}

@Injectable({ providedIn: 'root' })
export class LeafAssetsQuery extends Query<AssetsState> {
  constructor(protected store: LeafAssetsStore) {
    super(store);
  }
}

@Injectable({ providedIn: 'root' })
export class LaborQuery extends Query<LaborState> {
  constructor(protected store: LaborStore) {
    super(store);
  }
}

@Injectable({ providedIn: 'root' })
export class VehiclePartsQuery extends QueryEntity<VehiclePartsState> {
  constructor(protected store: VehiclePartsStore) {
    super(store);
  }
}
