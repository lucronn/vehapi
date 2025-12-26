import { ChangeDetectionStrategy, Component, ErrorHandler, HostListener } from '@angular/core';
import { combineLatest, EMPTY, forkJoin, Observable } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { AssetsFacade } from '~/assets/state/assets.facade';
import { AssetApi } from '~/generated/api/services';
import { QueryStringParameters } from '~/url-parameters';
import { detectMobile, filterNullish } from '~/utilities';
import { VehicleSelectionFacade } from '~/vehicle-selection/state/state/vehicle-selection.facade';

@Component({
  selector: 'mtr-article-modal',
  templateUrl: './article-modal.component.html',
  styleUrls: ['./article-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleModalComponent {

  constructor(
    public assetsFacade: AssetsFacade,
    private assetsApi: AssetApi,
    public vehicleSelectionFacade: VehicleSelectionFacade,
    private errorHandler: ErrorHandler
  ) {}

  breadcrumbTrailTitles$: Observable<Array<string | null | undefined>> = combineLatest([
    this.vehicleSelectionFacade.contentSource$.pipe(filterNullish()),
    this.vehicleSelectionFacade.activeVehicleId$.pipe(filterNullish()),
    this.assetsFacade.articleIds$,
  ]).pipe(
    switchMap(([contentSource, vehicleId, ids]) =>
      forkJoin(
        ids.map((id) =>
          this.assetsApi.getArticleTitle({ contentSource, vehicleId, articleId: id }).pipe(
            map((response) => response.body),
            catchError((e) => {
              this.errorHandler.handleError(e);
              return EMPTY;
            })
          )
        )
      )
    )
  );

  getDestinationQueryParameters(index: number) {
    const articleIds = this.assetsFacade.getArticleIds();
    return { [QueryStringParameters.articleIdTrail]: articleIds.slice(0, index + 1).join(',') };
  }

  /** Don't close the modal on escape if there is an element on top of the modal blocking the close button, such as an image viewer. */
  @HostListener('document:keydown.esc', ['$event'])
  closeIfXButtonVisible($event: KeyboardEvent) {
    const xButton = document.querySelector('#articleModalX');
    if (xButton) {
      const boundingRect = xButton.getBoundingClientRect();

      if (document.elementFromPoint(boundingRect.x + 1, boundingRect.y + 1) === xButton) {
        this.close();
      }
    }
  }

  close() {
    this.assetsFacade.showRootArticle();
  }
  
  detectMobile(){
    return detectMobile();
  }
}
