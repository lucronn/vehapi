import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { Tsb } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, FileText, X, ArrowUpRight } from 'lucide-angular';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MotorApiService } from '../../../../../services/motor-api.service';
import { WindowManagerService } from '../../../../../services/window-manager.service';
import { ArticleViewerComponent } from '../../../../article-viewer/article-viewer.component';

/**
 * Displays technical service bulletins (TSBs)
 */
@Component({
    selector: 'app-tsb-section',
    templateUrl: './tsb-section.component.html',
    styleUrls: ['./tsb-section.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RouterModule, LoadingSkeletonComponent, EmptyStateComponent, LucideAngularModule],
    standalone: true
})
export class TsbSectionComponent implements OnInit {
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);
    private motorApi = inject(MotorApiService);
    private windowManager = inject(WindowManagerService);
    private router = inject(Router);

    tsbs = signal<Tsb[]>([]);
    isLoading = signal(false);

    readonly icons = { FileText, X, ArrowUpRight };



    ngOnInit() {
        this.loadData();
    }

    private loadData() {
        if (this.tsbs().length > 0) return;

        this.vehicleData.loadSectionData(
            'tsbs',
            this.contentSource,
            this.vehicleId,
            this.motorVehicleId,
            this.isLoading,
            (data) => this.tsbs.set(data),
            (error) => {
                console.error('Failed to load TSBs', error);
                this.isLoading.set(false);
            }
        );
    }

    trackById(index: number, tsb: Tsb): string {
        return tsb.id || index.toString();
    }

    viewTsb(tsb: Tsb) {
        if (this.windowManager.isDesktop()) {
            this.windowManager.openWindow(
                `TSB: ${tsb.bulletinNumber || 'View'}`,
                ArticleViewerComponent,
                {
                    contentSource: this.contentSource,
                    vehicleId: this.vehicleId,
                    articleId: tsb.id,
                    articleTitleInput: tsb.title
                }
            );
        } else {
            this.router.navigate(['/vehicle', this.contentSource, this.vehicleId, 'article', tsb.id], {
                queryParams: { title: tsb.title }
            });
        }
    }

    getThumbnailUrl(thumbnailHref: string | undefined): string {
        if (!thumbnailHref) return '';
        // If it's already a full URL, return as is
        if (thumbnailHref.startsWith('http')) return thumbnailHref;
        // Otherwise, prepend the base URL
        return this.motorApi.getGraphicUrl(thumbnailHref);
    }

    formatDate(dateString: string): string {
        if (!dateString) return '';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch {
            return dateString;
        }
    }
}
