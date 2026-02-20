import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { Tsb } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, FileText, X, ArrowUpRight, Lock, Unlock, Sparkles } from 'lucide-angular';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MotorHtmlProcessorService } from '../../../../../services/motor-html-processor.service';
import { WindowManagerService } from '../../../../../services/window-manager.service';
import { ArticleViewerComponent } from '../../../../article-viewer/article-viewer.component';
import { CreditsService } from '../../../../../services/credits.service';

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
    private motorHtml = inject(MotorHtmlProcessorService);
    private windowManager = inject(WindowManagerService);
    private router = inject(Router);
    protected creditsService = inject(CreditsService);

    tsbs = signal<Tsb[]>([]);
    isLoading = signal(false);
    isUnlocking = signal(false);

    readonly icons = { FileText, X, ArrowUpRight, Lock, Unlock, Sparkles };

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

    async unlockSection() {
        if (this.isUnlocking()) return;

        const cost = this.creditsService.COSTS.TSB;
        if (this.creditsService.balance() < cost) {
            alert('Insufficient credits. Please purchase more.');
            return;
        }

        if (confirm(`Unlock Technical Service Bulletins for ${cost} credits?`)) {
            this.isUnlocking.set(true);
            const success = await this.creditsService.unlockModule(this.vehicleId, 'tsbs', cost);
            this.isUnlocking.set(false);

            if (!success) {
                alert('Unlock failed. Please try again.');
            }
        }
    }

    viewTsb(tsb: Tsb) {
        if (!this.creditsService.hasAccess(this.vehicleId, 'tsbs')) {
            this.unlockSection();
            return;
        }

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
        return this.motorHtml.getGraphicUrl(thumbnailHref);
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
