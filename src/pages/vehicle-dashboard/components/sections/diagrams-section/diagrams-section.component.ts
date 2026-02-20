import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { MotorApiService } from '../../../../../services/motor-api.service';
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
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);
    private motorApi = inject(MotorApiService);
    private windowManager = inject(WindowManagerService);
    private router = inject(Router);
    protected creditsService = inject(CreditsService);

    diagrams = signal<(WiringDiagram | ComponentLocation)[]>([]);
    isLoading = signal(false);
    isUnlocking = signal(false);
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
            (data) => this.diagrams.set(data),
            (error) => {
                console.error('Failed to load diagrams', error);
                this.isLoading.set(false);
            }
        );
    }

    trackById(index: number, diagram: WiringDiagram | ComponentLocation): string {
        return diagram.id || index.toString();
    }

    isWiringDiagram(item: WiringDiagram | ComponentLocation): item is WiringDiagram {
        return 'diagramType' in item || 'wiringSystem' in item;
    }

    getThumbnailUrl(thumbnailHref: string | undefined): string {
        if (!thumbnailHref) return '';
        return this.motorApi.getGraphicUrl(thumbnailHref);
    }

    async unlockSection() {
        if (this.isUnlocking()) return;

        const cost = this.creditsService.COSTS.DIAGRAMS;
        if (this.creditsService.balance() < cost) {
            alert('Insufficient credits. Please purchase more.');
            return;
        }

        if (confirm(`Unlock Wiring Diagrams for ${cost} credits?`)) {
            this.isUnlocking.set(true);
            const success = await this.creditsService.unlockModule(this.vehicleId, 'diagrams', cost);
            this.isUnlocking.set(false);

            if (!success) {
                alert('Unlock failed. Please try again.');
            }
        }
    }

    viewDiagram(diagram: WiringDiagram | ComponentLocation) {
        if (!this.creditsService.hasAccess(this.vehicleId, 'diagrams')) {
            this.unlockSection();
            return;
        }

        if (this.windowManager.isDesktop()) {
            this.windowManager.openWindow(
                diagram.title || 'Diagram',
                ArticleViewerComponent,
                {
                    contentSource: this.contentSource,
                    vehicleId: this.vehicleId,
                    articleId: diagram.id,
                    articleTitleInput: diagram.title
                }
            );
        } else {
            this.router.navigate(['/vehicle', this.contentSource, this.vehicleId, 'article', diagram.id], {
                queryParams: { title: diagram.title }
            });
        }
    }
}
