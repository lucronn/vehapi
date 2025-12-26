import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'mtr-horizontal-circles-loader',
  templateUrl: './horizontal-circles-loader.component.html',
  styleUrls: ['./horizontal-circles-loader.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HorizontalCirclesLoaderComponent {
  constructor() {}
}
