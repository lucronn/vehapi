import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { Procedure } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, Wrench } from 'lucide-angular';

/**
 * Displays repair procedures
 */
@Component({
    selector: 'app-procedures-section',
    templateUrl: './procedures-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RouterModule, LoadingSkeletonComponent, EmptyStateComponent, LucideAngularModule],
    standalone: true
})
export class ProceduresSectionComponent implements OnInit {
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;

    private vehicleData = inject(VehicleDataService);

    procedures = signal<Procedure[]>([]);
    isLoading = signal(false);
    readonly icons = { Wrench };

    ngOnInit() {
        this.loadData();
    }

    private loadData() {
        if (this.procedures().length > 0) return;

        this.vehicleData.loadSectionData(
            'procedures',
            this.contentSource,
            this.vehicleId,
            this.isLoading,
            (data) => this.procedures.set(data)
        );
    }

    trackById(index: number, procedure: Procedure): string {
        return procedure.id || index.toString();
    }
}
