import { Component } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { UiApi } from '~/generated/api/services';

@Component({
  selector: 'mtr-banner',
  templateUrl: './banner.component.html',
  styleUrls: ['./banner.component.scss']
})
export class BannerComponent {
  constructor(private bannerapi: UiApi) {}
  banner$: Observable<string | undefined> = this.bannerapi.getBannerHtml().pipe(map((response) => (response as any) as string));
}
