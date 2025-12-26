import { Injectable } from '@angular/core';
import { ActiveState, EntityState, EntityStore, StoreConfig } from '@datorama/akita';
import { ArticleDetails } from '~/generated/api/models';

export interface SearchResultsState extends EntityState<ArticleDetails>, ActiveState {}

const initialState: SearchResultsState = {
  active: null,
  loading: false,
};

@Injectable({ providedIn: 'root' })
@StoreConfig({ name: 'search-results', resettable: true })
export class SearchResultsStore extends EntityStore<SearchResultsState> {
  constructor() {
    super(initialState);
  }
}
