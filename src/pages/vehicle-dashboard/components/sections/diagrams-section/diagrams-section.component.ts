import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { MotorHtmlProcessorService } from '../../../../../services/motor-html-processor.service';
import { WiringDiagram, ComponentLocation } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, Cable, Lock, Unlock, Sparkles } from 'lucide-angular';
import { ArticleViewerComponent } from '../../../../article-viewer/article-viewer.component';
import { WindowManagerService } from '../../../../../services/window-manager.service';
import { CreditsService } from '../../../../../services/credits.service';

/**
 * Displays wiring diagrams and component locations
 */
@Component({
    selector: 'app-diagrams-section',
    templateUrl: './diagrams-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RouterModule, LoadingSkeletonComponent, EmptyStateComponent, LucideAngularModule],
    standalone: true
})
export class DiagramsSectionComponent implements OnInit {
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;
    @Input() vehicleName: string = '';
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);
    private motorHtml = inject(MotorHtmlProcessorService);
    private windowManager = inject(WindowManagerService);
    private router = inject(Router);
    protected creditsService = inject(CreditsService);

    diagrams = signal<(WiringDiagram | ComponentLocation)[]>([]);
    isLoading = signal(false);
    isUnlocking = signal(false);

    // Pagination state
    displayLimit = signal(50);

    // Computed property to return only the items we should show right now
    // If locked, we only show a tiny preview slice to save DOM/GPU memory for the blur effect
    displayedDiagrams = signal<(WiringDiagram | ComponentLocation)[]>([]);
    readonly icons = { Cable, Lock, Unlock, Sparkles };

    ngOnInit() {
        this.loadData();
    }

    private loadData() {
        if (this.diagrams().length > 0) return;

        this.vehicleData.loadSectionData(
            'diagrams',
            this.contentSource,
            this.vehicleId,
            this.motorVehicleId,
            this.isLoading,
            (data) => {
                this.diagrams.set(data);
                this.updateDisplayedDiagrams();
            },
            (error) => {
                console.error('Failed to load diagrams', error);
                this.isLoading.set(false);
            }
        );
    }

    private updateDisplayedDiagrams() {
        const hasAccess = this.creditsService.hasAccess(this.vehicleId, 'diagrams');
        const limit = hasAccess ? this.displayLimit() : this.diagrams().length; // Show all when locked
        this.displayedDiagrams.set(this.diagrams().slice(0, limit));
    }

    loadMore() {
        this.displayLimit.update(v => v + 50);
        this.updateDisplayedDiagrams();
    }

    trackById(index: number, diagram: WiringDiagram | ComponentLocation): string {
        return diagram.id || index.toString();
    }

    isWiringDiagram(item: WiringDiagram | ComponentLocation): item is WiringDiagram {
        return 'diagramType' in item || 'wiringSystem' in item;
    }

    getThumbnailUrl(thumbnailHref: string | undefined): string {
        if (!thumbnailHref) return '';
        return this.motorHtml.getGraphicUrl(thumbnailHref);
    }

    async unlockSection() {
        if (this.isUnlocking()) return;

        const cost = this.creditsService.COSTS.DIAGRAMS;
        if (this.creditsService.balance() < cost) return;

        this.isUnlocking.set(true);
        const success = await this.creditsService.unlockModule(this.vehicleId, this.vehicleName, 'diagrams', cost);
        this.isUnlocking.set(false);

        if (success) {
            this.updateDisplayedDiagrams();
        }
    }

    viewDiagram(diagram: WiringDiagram | ComponentLocation) {
        if (this.windowManager.isDesktop()) {
            this.windowManager.openWindow(
                diagram.title || 'Diagram',
                ArticleViewerComponent,
                {
                    contentSource: this.contentSource,
                    vehicleId: this.vehicleId,
                    articleId: diagram.id,
                    articleTitleInput: diagram.title,
                    moduleType: 'diagrams'
                }
            );
        } else {
            this.router.navigate(['/vehicle', this.contentSource, this.vehicleId, 'article', diagram.id], {
                queryParams: { title: diagram.title, moduleType: 'diagrams' }
            });
        }
    }
}
