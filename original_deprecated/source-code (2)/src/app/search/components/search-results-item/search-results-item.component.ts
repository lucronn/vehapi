import { ChangeDetectionStrategy, Component, HostBinding, Input } from '@angular/core';
import { ArticleDetails } from '~/generated/api/models';

@Component({
  selector: 'mtr-search-results-item',
  templateUrl: './search-results-item.component.html',
  styleUrls: ['./search-results-item.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchResultsItemComponent {
  @HostBinding('class.selected')
  @Input()
  isSelected = false;

  @HostBinding('class.full-screen')
  @Input()
  isFullScreen: boolean | null = false;

  @Input() details!: Partial<ArticleDetails>;

  @HostBinding('attr.id')
  get id() {
    return this.details.id;
  }
}
