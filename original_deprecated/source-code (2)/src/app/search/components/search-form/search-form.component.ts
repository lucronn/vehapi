import { Component, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { SearchResultsFacade } from '~/search/state/search-results.facade';

@Component({
  selector: 'mtr-search-form',
  templateUrl: './search-form.component.html',
  styleUrls: ['./search-form.component.scss'],
})
export class SearchFormComponent implements OnDestroy {
  constructor(public searchResultsFacade: SearchResultsFacade) {
    this.subscription = searchResultsFacade.searchTerm$.subscribe((value) => (this.searchTerm = value));
  }

  searchTerm?: string;
  subscription: Subscription;

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }
}
