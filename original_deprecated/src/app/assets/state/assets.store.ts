import { Injectable } from '@angular/core';
import { ActiveState, EntityState, EntityStore, Store, StoreConfig } from '@datorama/akita';
import { Labor, PartLineItem } from '~/generated/api/models';

export interface AssetsState {
  html?: string;
  base64Pdf?: string;
  documentId?: string;
  createdDate?: string;
  publishedDate?: string;
  isOutdated?: boolean; // Bookmarking only applies to the root
  contentSilos?: string;
  sourceSilos?: string;
}

const initialState: AssetsState = {};

@Injectable({ providedIn: 'root' })
@StoreConfig({ name: 'leaf-assets', resettable: true })
export class LeafAssetsStore extends Store<AssetsState> {
  constructor() {
    super(initialState);
  }
}

@Injectable({ providedIn: 'root' })
@StoreConfig({ name: 'root-assets', resettable: true })
export class RootAssetsStore extends Store<AssetsState> {
  constructor() {
    super(initialState);
  }
}

export type LaborState = Labor;

@Injectable({ providedIn: 'root' })
@StoreConfig({ name: 'labor', resettable: true })
export class LaborStore extends Store<LaborState> {
  constructor() {
    super({});
  }
}

export interface VehiclePartsState extends EntityState<PartLineItem> {}

const initialVehiclePartsState: VehiclePartsState = {};

@Injectable({ providedIn: 'root' })
@StoreConfig({ name: 'vehicle-parts', resettable: true, idKey: 'partNumber' })
export class VehiclePartsStore extends EntityStore<VehiclePartsState> {
  constructor() {
    super(initialState);
  }
}
