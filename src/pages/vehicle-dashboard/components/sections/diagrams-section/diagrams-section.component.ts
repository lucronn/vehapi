import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { MotorApiService } from '../../../../../services/motor-api.service';
import { WiringDiagram, ComponentLocation } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, Cable } from 'lucide-angular';
import { ArticleViewerComponent } from '../../../../article-viewer/article-viewer.component';
import { WindowManagerService } from '../../../../../services/window-manager.service';

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

    diagrams = signal<(WiringDiagram | ComponentLocation)[]>([]);
    isLoading = signal(false);
    readonly icons = { Cable };

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

    viewDiagram(diagram: WiringDiagram | ComponentLocation) {
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
