import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { Tsb } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, FileText } from 'lucide-angular';

/**
 * Displays technical service bulletins (TSBs)
 */
@Component({
    selector: 'app-tsb-section',
    templateUrl: './tsb-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RouterModule, LoadingSkeletonComponent, EmptyStateComponent, LucideAngularModule],
    standalone: true
})
export class TsbSectionComponent implements OnInit {
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);

    tsbs = signal<Tsb[]>([]);
    isLoading = signal(false);
    readonly icons = { FileText };

    ngOnInit() {
        this.loadData();
    }

    private loadData() {
        if (this.tsbs().length > 0) return;

        this.vehicleData.loadSectionData(
            'tsbs',
            this.contentSource,
            this.vehicleId,
            this.motorVehicleId,
            this.isLoading,
            (data) => this.tsbs.set(data)
        );
    }

    trackById(index: number, tsb: Tsb): string {
        return tsb.id || index.toString();
    }
}
