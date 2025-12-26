import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { Tsb } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, FileText, X } from 'lucide-angular';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MotorApiService } from '../../../../../services/motor-api.service';

/**
 * Displays technical service bulletins (TSBs)
 */
@Component({
    selector: 'app-tsb-section',
    templateUrl: './tsb-section.component.html',
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
    private sanitizer = inject(DomSanitizer);

    tsbs = signal<Tsb[]>([]);
    isLoading = signal(false);

    // Viewer State
    selectedTsb = signal<Tsb | null>(null);
    tsbContent = signal<SafeHtml | null>(null);
    isLoadingContent = signal(false);

    readonly icons = { FileText, X };



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
            (data) => this.tsbs.set(data)
        );
    }

    trackById(index: number, tsb: Tsb): string {
        return tsb.id || index.toString();
    }

    viewTsb(tsb: Tsb) {
        this.selectedTsb.set(tsb);
        this.isLoadingContent.set(true);

        this.motorApi.getArticleContent(this.contentSource, this.vehicleId, tsb.id).subscribe({
            next: (res) => {
                const html = res.body?.html || '<p>No content available.</p>';
                this.tsbContent.set(this.sanitizer.bypassSecurityTrustHtml(html));
                this.isLoadingContent.set(false);
            },
            error: (err) => {
                console.error('Failed to load TSB content', err);
                this.tsbContent.set(this.sanitizer.bypassSecurityTrustHtml('<p class="text-red-400">Failed to load content.</p>'));
                this.isLoadingContent.set(false);
            }
        });
    }

    closeViewer() {
        this.selectedTsb.set(null);
        this.tsbContent.set(null);
    }
}
