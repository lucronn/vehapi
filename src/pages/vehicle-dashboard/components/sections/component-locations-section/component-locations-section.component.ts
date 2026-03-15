import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { ComponentLocation } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, TriangleAlert, MapPin, Image, Lock, Unlock, Sparkles } from 'lucide-angular';
import { MotorHtmlProcessorService } from '../../../../../services/motor-html-processor.service';
import { ArticleViewerComponent } from '../../../../article-viewer/article-viewer.component';
import { WindowManagerService } from '../../../../../services/window-manager.service';
import { CreditsService } from '../../../../../services/credits.service';

/**
 * Displays Component Locations
 */
@Component({
    selector: 'app-component-locations-section',
    templateUrl: './component-locations-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RouterModule, LoadingSkeletonComponent, EmptyStateComponent, LucideAngularModule],
    standalone: true
})
export class ComponentLocationsSectionComponent implements OnInit {
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;
    @Input() vehicleName: string = '';
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);
    private motorHtml = inject(MotorHtmlProcessorService); // For graphic URL if needed
    private windowManager = inject(WindowManagerService);
    private router = inject(Router);
    protected creditsService = inject(CreditsService);

    locations = signal<ComponentLocation[]>([]);
    isLoading = signal(false);
    isUnlocking = signal(false);
    readonly icons = { TriangleAlert, MapPin, Image, Lock, Unlock, Sparkles };

    ngOnInit() {
        this.loadData();
    }

    private loadData() {
        if (this.locations().length > 0) return;

        this.vehicleData.loadSectionData(
            'component-locations',
            this.contentSource,
            this.vehicleId,
            this.motorVehicleId,
            this.isLoading,
            (data) => this.locations.set(data as ComponentLocation[]),
            (error) => {
                console.error('Failed to load component locations', error);
                this.isLoading.set(false);
            }
        );
    }

    trackById(index: number, item: ComponentLocation): string {
        return item.id || index.toString();
    }

    getThumbnailUrl(thumbnailHref: string | undefined): string {
        if (!thumbnailHref) return '';
        if (thumbnailHref.startsWith('http')) return thumbnailHref;
        return this.motorHtml.getGraphicUrl(thumbnailHref);
    }

    async unlockSection() {
        if (this.isUnlocking()) return;

        const cost = this.creditsService.COSTS.DIAGRAMS;
        if (this.creditsService.balance() < cost) {
            alert('Insufficient credits. Please purchase more.');
            return;
        }

        if (confirm(`Unlock Component Locations for ${cost} credits?`)) {
            this.isUnlocking.set(true);
            const success = await this.creditsService.unlockModule(this.vehicleId, this.vehicleName, 'diagrams', cost);
            this.isUnlocking.set(false);

            if (!success) {
                alert('Unlock failed. Please try again.');
            }
        }
    }

    viewLocation(item: ComponentLocation) {
        if (!this.creditsService.hasAccess(this.vehicleId, 'diagrams')) {
            this.unlockSection();
            return;
        }

        if (this.windowManager.isDesktop()) {
            this.windowManager.openWindow(
                item.title || 'Component Location',
                ArticleViewerComponent,
                {
                    contentSource: this.contentSource,
                    vehicleId: this.vehicleId,
                    articleId: item.id,
                    articleTitleInput: item.title,
                    moduleType: 'diagrams'
                }
            );
        } else {
            this.router.navigate(['/vehicle', this.contentSource, this.vehicleId, 'article', item.id], {
                queryParams: { title: item.title, moduleType: 'diagrams' }
            });
        }
    }
}
