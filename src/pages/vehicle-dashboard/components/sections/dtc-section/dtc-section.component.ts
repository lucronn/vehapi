import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { Dtc } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, TriangleAlert } from 'lucide-angular';

/**
 * Displays diagnostic trouble codes (DTCs)
 */
@Component({
    selector: 'app-dtc-section',
    templateUrl: './dtc-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RouterModule, LoadingSkeletonComponent, EmptyStateComponent, LucideAngularModule],
    standalone: true
})
export class DtcSectionComponent implements OnInit {
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);

    dtcs = signal<Dtc[]>([]);
    isLoading = signal(false);
    readonly icons = { TriangleAlert };

    ngOnInit() {
        this.loadData();
    }

    private loadData() {
        if (this.dtcs().length > 0) return;

        this.vehicleData.loadSectionData(
            'dtcs',
            this.contentSource,
            this.vehicleId,
            this.motorVehicleId,
            this.isLoading,
            (data) => this.dtcs.set(data)
        );
    }

    trackByCode(index: number, dtc: Dtc): string {
        return dtc.code || index.toString();
    }
}
