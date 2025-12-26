import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SearchResultsFacade } from '~/search/state/search-results.facade';
import { PathParameters } from '~/url-parameters';

@Component({
  selector: 'mtr-filter-tabs',
  templateUrl: './filter-tabs.component.html',
  styleUrls: ['./filter-tabs.component.scss'],
})
export class FilterTabsComponent {
  constructor(public searchResultsFacade: SearchResultsFacade, private activatedRoute: ActivatedRoute) {}

  isLinkActive(tabName: string): boolean {
    return tabName === this.activatedRoute.snapshot.params[PathParameters.filterTab];
  }
}
