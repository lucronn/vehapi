import { Injectable } from '@angular/core';
import { Order, QueryConfig, QueryEntity } from '@datorama/akita';
import { Observable } from 'rxjs';
import { FilterTab } from '~/generated/api/models';
import { FilterTabsState, FilterTabsStore } from './filter-tabs.store';

@QueryConfig<FilterTab>({
  sortBy: 'sort',
  sortByOrder: Order.ASC,
})
@Injectable({ providedIn: 'root' })
export class FilterTabsQuery extends QueryEntity<FilterTabsState> {
  constructor(protected store: FilterTabsStore) {
    super(store);
  }

  filterTabs$: Observable<Array<FilterTab>> = this.selectAll();
}
