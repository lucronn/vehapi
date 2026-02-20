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

    // Pagination state
    displayLimit = signal(50);

    // Computed property to return only the items we should show right now
    // If locked, we only show a tiny preview slice to save DOM/GPU memory for the blur effect
    displayedSchedules = signal<MaintenanceSchedule[]>([]);

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
            (data) => {
                this.schedules.set(data);
                this.updateDisplayedSchedules();
            },
            (error) => {
                console.error('Failed to load maintenance schedules', error);
                // Ensure loading state is cleared even if service didn't handle it
                this.isLoading.set(false);
            }
        );
    }

    private updateDisplayedSchedules() {
        const hasAccess = this.creditsService.hasAccess(this.vehicleId, 'maintenance');
        const limit = hasAccess ? this.displayLimit() : 8; // Only 8 items if locked (preview)
        this.displayedSchedules.set(this.schedules().slice(0, limit));
    }

    loadMore() {
        this.displayLimit.update(v => v + 50);
        this.updateDisplayedSchedules();
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
            } else {
                // Update display since we are now unlocked
                this.updateDisplayedSchedules();
            }
        }
    }
}
