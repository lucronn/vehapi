import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { Procedure } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, Wrench, Lock, Unlock, Sparkles } from 'lucide-angular';
import { CreditsService } from '../../../../../services/credits.service';

import { ArticleViewerComponent } from '../../../../article-viewer/article-viewer.component';
import { WindowManagerService } from '../../../../../services/window-manager.service';

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
    @Input() vehicleName: string = '';
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);
    private windowManager = inject(WindowManagerService);
    private router = inject(Router);
    protected creditsService = inject(CreditsService);

    procedures = signal<Procedure[]>([]);
    isUnlocking = signal(false);

    // Pagination state
    displayLimit = signal(50);

    // Grouped procedures logic (sliced to displayLimit or 8 if locked)
    groupedProcedures = computed(() => {
        const hasAccess = this.creditsService.hasAccess(this.vehicleId, 'procedures');
        const limit = hasAccess ? this.displayLimit() : 8; // Only 8 items if locked (preview)

        // We slice the flat array before grouping to ensure we don't render thousands of nodes across groups
        const all = this.procedures().slice(0, limit);
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

    totalGroupedItems() {
        const groups = this.groupedProcedures();
        if (!groups || groups.length === 0) return 0;
        let total = 0;
        for (const group of groups) {
            total += group.items.length;
        }
        return total;
    }

    loadMore() {
        this.displayLimit.update(v => v + 50);
    }

    isLoading = signal(false);
    readonly icons = { Wrench, Lock, Unlock, Sparkles };

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

    async unlockSection() {
        if (this.isUnlocking()) return;

        const cost = this.creditsService.COSTS.PROCEDURES;
        if (this.creditsService.balance() < cost) {
            return; // Button shows insufficient credits already
        }

        this.isUnlocking.set(true);
        await this.creditsService.unlockModule(this.vehicleId, this.vehicleName, 'procedures', cost);
        this.isUnlocking.set(false);
    }

    viewProcedure(procedure: Procedure) {
        if (!this.creditsService.hasAccess(this.vehicleId, 'procedures')) {
            this.unlockSection();
            return;
        }

        if (this.windowManager.isDesktop()) {
            this.windowManager.openWindow(
                procedure.title || 'Procedure',
                ArticleViewerComponent,
                {
                    contentSource: this.contentSource,
                    vehicleId: this.vehicleId,
                    articleId: procedure.id,
                    articleTitleInput: procedure.title
                }
            );
        } else {
            this.router.navigate(['/vehicle', this.contentSource, this.vehicleId, 'article', procedure.id], {
                queryParams: { title: procedure.title }
            });
        }
    }
}
