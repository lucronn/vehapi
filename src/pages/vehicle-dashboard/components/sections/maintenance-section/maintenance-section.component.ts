import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { MaintenanceSchedule } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, ClipboardList, Gauge, Lock, Unlock, Sparkles } from 'lucide-angular';
import { CreditsService } from '../../../../../services/credits.service';
import { WindowManagerService } from '../../../../../services/window-manager.service';
import { ArticleViewerComponent } from '../../../../article-viewer/article-viewer.component';

/**
 * Displays Maintenance Schedules with interval selector
 */
@Component({
    selector: 'app-maintenance-section',
    templateUrl: './maintenance-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RouterModule, LoadingSkeletonComponent, EmptyStateComponent, LucideAngularModule],
    standalone: true
})
export class MaintenanceSectionComponent implements OnInit {
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;
    @Input() vehicleName: string = '';
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);
    private router = inject(Router);
    private windowManager = inject(WindowManagerService);
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

    /** Motor application id when present — labor time rows use `L:{applicationID}` in the viewer. */
    rowHasLaborLink(item: MaintenanceSchedule): boolean {
        const m = item.taskMetadata;
        if (!m) return false;
        const id = m['applicationID'] ?? m['applicationId'];
        return id != null && String(id).trim() !== '';
    }

    openMaintenanceRow(item: MaintenanceSchedule): void {
        if (!this.creditsService.hasAccess(this.vehicleId, 'maintenance')) return;
        if (!this.rowHasLaborLink(item)) return;

        const m = item.taskMetadata!;
        const raw = m['applicationID'] ?? m['applicationId'];
        const laborId = `L:${String(raw).trim()}`;
        const title = `${item.action} — ${item.description}`.trim();

        if (this.windowManager.isDesktop()) {
            this.windowManager.openWindow(
                title,
                ArticleViewerComponent,
                {
                    contentSource: this.contentSource,
                    vehicleId: this.vehicleId,
                    articleId: laborId,
                    articleTitleInput: title,
                    moduleType: 'maintenance'
                }
            );
        } else {
            this.router.navigate(['/vehicle', this.contentSource, this.vehicleId, 'article', laborId], {
                queryParams: { title, moduleType: 'maintenance' }
            });
        }
    }

    async unlockSection() {
        if (this.isUnlocking()) return;

        const cost = this.creditsService.COSTS.MAINTENANCE;
        if (this.creditsService.balance() < cost) return;

        this.isUnlocking.set(true);
        const success = await this.creditsService.unlockModule(this.vehicleId, this.vehicleName, 'maintenance', cost);
        this.isUnlocking.set(false);

        if (success) {
            this.updateDisplayedSchedules();
        }
    }
}
