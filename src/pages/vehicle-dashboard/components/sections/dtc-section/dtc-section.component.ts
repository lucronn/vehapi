import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { Dtc } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, TriangleAlert, ArrowRight, Lock, Unlock, Sparkles } from 'lucide-angular';
import { ArticleViewerComponent } from '../../../../article-viewer/article-viewer.component';
import { WindowManagerService } from '../../../../../services/window-manager.service';
import { CreditsService } from '../../../../../services/credits.service';

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
    @Input() vehicleName: string = '';
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);
    private windowManager = inject(WindowManagerService);
    private router = inject(Router);
    protected creditsService = inject(CreditsService);

    dtcs = signal<Dtc[]>([]);
    isLoading = signal(false);
    isUnlocking = signal(false);

    // Pagination state
    displayLimit = signal(50);
    readonly icons = { TriangleAlert, ArrowRight, Lock, Unlock, Sparkles };

    // Computed property to return only the items we should show right now
    // If locked, we only show a tiny preview slice to save DOM/GPU memory for the blur effect
    displayedDtcs = signal<Dtc[]>([]);

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
            (data) => {
                this.dtcs.set(data);
                this.updateDisplayedDtcs();
            },
            (error) => {
                console.error('Failed to load DTCs', error);
                this.isLoading.set(false);
            }
        );
    }

    private updateDisplayedDtcs() {
        const hasAccess = this.creditsService.hasAccess(this.vehicleId, 'dtcs');
        const limit = hasAccess ? this.displayLimit() : this.dtcs().length; // Show all titles when locked for selective purchase
        this.displayedDtcs.set(this.dtcs().slice(0, limit));
    }

    loadMore() {
        this.displayLimit.update(v => v + 50);
        this.updateDisplayedDtcs();
    }

    trackByCode(index: number, dtc: Dtc): string {
        return dtc.code || index.toString();
    }

    async unlockSection() {
        if (this.isUnlocking()) return;

        const cost = this.creditsService.COSTS.DTC;
        if (this.creditsService.balance() < cost) {
            return; // Button shows insufficient credits already
        }

        this.isUnlocking.set(true);
        const success = await this.creditsService.unlockModule(this.vehicleId, this.vehicleName, 'dtcs', cost);
        this.isUnlocking.set(false);

        if (success) {
            this.updateDisplayedDtcs();
        }
    }

    viewDtc(dtc: Dtc) {
        // Always open article viewer; when locked it shows unlock options (single article or section)
        if (this.windowManager.isDesktop()) {
            this.windowManager.openWindow(
                `DTC: ${dtc.code}`,
                ArticleViewerComponent,
                {
                    contentSource: this.contentSource,
                    vehicleId: this.vehicleId,
                    articleId: dtc.id,
                    articleTitleInput: `${dtc.code} - ${dtc.description}`,
                    moduleType: 'dtcs'
                }
            );
        } else {
            this.router.navigate(['/vehicle', this.contentSource, this.vehicleId, 'article', dtc.id], {
                queryParams: { title: `${dtc.code} - ${dtc.description}`, moduleType: 'dtcs' }
            });
        }
    }
}
