import { Component, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { VehicleGeoBlockingDetails } from '~/generated/api/models';

@Component({
  selector: 'mtr-geo-blocking-modal',
  templateUrl: './geo-blocking-modal.component.html',
  styleUrls: ['./geo-blocking-modal.component.scss'],
})
export class GeoBlockingModalComponent implements OnInit {
  constructor(private router: Router) {}
  showModal: boolean = false;
  accessMessage: string = '';

  @Input()
  geoBlockStatus?: VehicleGeoBlockingDetails;
  ngOnInit(): void {
    this.initialize();
  }

  initialize() {
    this.showModal = this.geoBlockStatus?.isGeoBlocked ?? false;
    const country = this.geoBlockStatus?.countryName?.length ? ` (${this.geoBlockStatus?.countryName})` : '';
    const make = this.geoBlockStatus?.isLaborContentEntitled ? `some ${this.geoBlockStatus?.make}` : this.geoBlockStatus?.make;
    this.accessMessage = this.geoBlockStatus?.isLaborContentEntitled
      ? `Access to ${make} content is restricted based on your current location${country}.`
      : `Access to ${make} content is not available based on your current location${country}.`;
  }

  close() {
    this.showModal = false;
    if (!this.geoBlockStatus?.isLaborContentEntitled) {
      this.router.navigate(['/vehicles']);
    }
  }
}
