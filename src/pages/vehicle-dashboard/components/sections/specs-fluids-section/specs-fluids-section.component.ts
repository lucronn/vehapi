import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { Spec, Fluid } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';

import { LucideAngularModule, Gauge, Droplets, Info, ChevronRight } from 'lucide-angular';

import { RouterModule } from '@angular/router';

/**
 * Displays vehicle specifications and fluids
 * Handles data loading with cache management
 */
@Component({
    selector: 'app-specs-fluids-section',
    templateUrl: './specs-fluids-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RouterModule, LoadingSkeletonComponent, EmptyStateComponent, LucideAngularModule],
    standalone: true
})
export class SpecsFluidsSectionComponent implements OnInit {
    readonly icons = { Gauge, Droplets, Info, ChevronRight };
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);

    specs = signal<Spec[]>([]);
    fluids = signal<Fluid[]>([]);
    isLoading = signal(true);
    hasAttemptedLoad = false;

    ngOnInit() {
        this.loadData();
    }

    private loadData() {
        if (this.hasAttemptedLoad) return;

        this.hasAttemptedLoad = true;
        this.isLoading.set(true);

        // Safety timeout
        setTimeout(() => {
            if (this.isLoading()) {
                console.warn('[SpecsFluidsSectionComponent] Force stopping spinner via safety timeout');
                this.isLoading.set(false);
            }
        }, 10000);

        this.vehicleData.loadSpecs(this.contentSource, this.vehicleId, this.motorVehicleId).subscribe({
            next: (results) => {
                this.fluids.set(results.fluids || []);
                this.specs.set(results.specs || []);
                this.isLoading.set(false);
            },
            error: (err) => {
                console.error('Failed to load specs/fluids', err);
                // On error, we still want to stop loading. 
                // We'll leave the signals as empty arrays, which triggers the empty state.
                // In a future pass, we could add a specific error state UI.
                this.isLoading.set(false);
            }
        });
    }

    trackByTitle(index: number, item: Spec | Fluid): string {
        return item.title || index.toString();
    }
}
