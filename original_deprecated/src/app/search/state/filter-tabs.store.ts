import { Injectable } from '@angular/core';
import { ActiveState, EntityState, EntityStore, StoreConfig } from '@datorama/akita';
import { FilterTab } from '~/generated/api/models';

export interface FilterTabsState extends EntityState<FilterTab>, ActiveState {}

const initialState: FilterTabsState = {
  active: null,
  loading: false,
};

@Injectable({ providedIn: 'root' })
@StoreConfig({ name: 'filter-tabs', resettable: true, idKey: 'name' })
export class FilterTabsStore extends EntityStore<FilterTabsState> {
  constructor() {
    super(initialState);
  }
}