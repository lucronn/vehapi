import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy, computed } from '@angular/core';
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
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);

    procedures = signal<Procedure[]>([]);

    // Grouped procedures logic
    groupedProcedures = computed(() => {
        const all = this.procedures();
        const groups: { [key: string]: Procedure[] } = {};

        all.forEach(p => {
            // Use bucket as category, fallback to 'General'
            const category = p.bucket || 'General';
            if (!groups[category]) {
                groups[category] = [];
            }
            groups[category].push(p);
        });

        // Sort categories alphabetically match sites.motor.com style or just basic sort
        return Object.keys(groups).sort().map(category => ({
            name: category,
            items: groups[category]
        }));
    });

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
            this.motorVehicleId,
            this.isLoading,
            (data) => this.procedures.set(data),
            (error) => {
                console.error('Failed to load procedures', error);
                this.isLoading.set(false);
            }
        );
    }

    trackById(index: number, procedure: Procedure): string {
        return procedure.id || index.toString();
    }
}
