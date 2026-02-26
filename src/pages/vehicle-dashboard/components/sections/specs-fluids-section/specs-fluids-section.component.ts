import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { Spec, Fluid } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';

import { LucideAngularModule, Gauge, Droplets, Info, ChevronRight, FileText, ArrowRight, Lock, Unlock, Sparkles } from 'lucide-angular';

import { RouterModule, Router } from '@angular/router';
import { ArticleViewerComponent } from '../../../../article-viewer/article-viewer.component';
import { WindowManagerService } from '../../../../../services/window-manager.service';
import { CreditsService } from '../../../../../services/credits.service';

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
    readonly icons = { Gauge, Droplets, Info, ChevronRight, FileText, ArrowRight, Lock, Unlock, Sparkles };
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;
    @Input() vehicleName: string = '';
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);
    private windowManager = inject(WindowManagerService);
    private router = inject(Router);
    protected creditsService = inject(CreditsService); // Protected for template access

    specs = signal<Spec[]>([]);
    fluids = signal<Fluid[]>([]);
    isLoading = signal(true);
    hasAttemptedLoad = false;

    // Track unlocking state locally for UI feedback
    isUnlocking = signal(false);

    // Pagination state (applies individually to each list)
    displayLimit = signal(50);

    // Computed property to return only the items we should show right now
    // If locked, we only show a tiny preview slice to save DOM/GPU memory for the blur effect
    displayedSpecs = signal<Spec[]>([]);
    displayedFluids = signal<Fluid[]>([]);

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
                this.updateDisplayedItems();
                this.isLoading.set(false);
            },
            error: (err) => {
                console.error('Failed to load specs/fluids', err);
                this.isLoading.set(false);
            }
        });
    }

    private updateDisplayedItems() {
        const hasAccess = this.creditsService.hasAccess(this.vehicleId, 'specs');
        const limit = hasAccess ? this.displayLimit() : 8; // Only 8 items if locked (preview)
        this.displayedSpecs.set(this.specs().slice(0, limit));
        this.displayedFluids.set(this.fluids().slice(0, limit));
    }

    loadMore() {
        this.displayLimit.update(v => v + 50);
        this.updateDisplayedItems();
    }

    trackByTitle(index: number, item: Spec | Fluid): string {
        return item.title || index.toString();
    }

    async unlockSection() {
        if (this.isUnlocking()) return;

        const cost = this.creditsService.COSTS.SPECS;
        if (this.creditsService.balance() < cost) {
            alert('Insufficient credits. Please purchase more.');
            return;
        }

        if (confirm(`Unlock Specifications & Fluids for ${cost} credits?`)) {
            this.isUnlocking.set(true);
            const success = await this.creditsService.unlockModule(this.vehicleId, this.vehicleName, 'specs', cost);
            this.isUnlocking.set(false);

            if (!success) {
                alert('Unlock failed. Please try again.');
            } else {
                // Update display since we are now unlocked
                this.updateDisplayedItems();
            }
        }
    }

    viewArticle(item: Spec | Fluid) {
        if (!this.creditsService.hasAccess(this.vehicleId, 'specs')) {
            this.unlockSection();
            return;
        }

        if (this.windowManager.isDesktop()) {
            this.windowManager.openWindow(
                item.title || 'Specification',
                ArticleViewerComponent,
                {
                    contentSource: this.contentSource,
                    vehicleId: this.vehicleId,
                    articleId: item.id,
                    articleTitleInput: item.title
                }
            );
        } else {
            this.router.navigate(['/vehicle', this.contentSource, this.vehicleId, 'article', item.id], {
                queryParams: { title: item.title }
            });
        }
    }
}
