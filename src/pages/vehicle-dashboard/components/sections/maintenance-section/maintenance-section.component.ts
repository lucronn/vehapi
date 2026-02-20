import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { MaintenanceSchedule } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, ClipboardList, Gauge, Lock, Unlock, Sparkles } from 'lucide-angular';
import { CreditsService } from '../../../../../services/credits.service';

/**
 * Displays Maintenance Schedules with interval selector
 */
@Component({
    selector: 'app-maintenance-section',
    templateUrl: './maintenance-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, LoadingSkeletonComponent, EmptyStateComponent, LucideAngularModule],
    standalone: true
})
export class MaintenanceSectionComponent implements OnInit {
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);
    protected creditsService = inject(CreditsService);

    schedules = signal<MaintenanceSchedule[]>([]);
    isLoading = signal(false);
    isUnlocking = signal(false);

    // Interval selection
    selectedInterval = signal<number>(30000); // Default to 30k
    availableIntervals = [
        7500, 15000, 30000, 45000, 60000,
        75000, 90000, 100000, 120000, 150000
    ];

    readonly icons = { ClipboardList, Gauge, Lock, Unlock, Sparkles };

    ngOnInit() {
        this.loadData();
    }

    onIntervalChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value;
        this.selectedInterval.set(Number(value));
        this.loadData();
    }

    private loadData() {
        this.vehicleData.loadMaintenanceSchedules(
            this.contentSource,
            this.vehicleId,
            this.motorVehicleId,
            this.selectedInterval(),
            this.isLoading,
            (data) => this.schedules.set(data),
            (error) => {
                console.error('Failed to load maintenance schedules', error);
                // Ensure loading state is cleared even if service didn't handle it
                this.isLoading.set(false);
            }
        );
    }

    async unlockSection() {
        if (this.isUnlocking()) return;

        const cost = this.creditsService.COSTS.MAINTENANCE;
        if (this.creditsService.balance() < cost) {
            alert('Insufficient credits. Please purchase more.');
            return;
        }

        if (confirm(`Unlock Maintenance Schedules for ${cost} credits?`)) {
            this.isUnlocking.set(true);
            const success = await this.creditsService.unlockModule(this.vehicleId, 'maintenance', cost);
            this.isUnlocking.set(false);

            if (!success) {
                alert('Unlock failed. Please try again.');
            }
        }
    }
}
