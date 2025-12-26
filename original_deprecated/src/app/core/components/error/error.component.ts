import { Location } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'mtr-error',
  templateUrl: './error.component.html',
  styleUrls: ['./error.component.scss'],
})
export class ErrorComponent {
  constructor(public location: Location) {}

  goBack(): void {
    this.location.back();
  }
}
