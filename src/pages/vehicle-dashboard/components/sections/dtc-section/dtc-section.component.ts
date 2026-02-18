import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { Dtc } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, TriangleAlert, ArrowRight } from 'lucide-angular';
import { ArticleViewerComponent } from '../../../../article-viewer/article-viewer.component';
import { WindowManagerService } from '../../../../../services/window-manager.service';

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
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);
    private windowManager = inject(WindowManagerService);
    private router = inject(Router);

    dtcs = signal<Dtc[]>([]);
    isLoading = signal(false);
    readonly icons = { TriangleAlert, ArrowRight };

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
            (data) => this.dtcs.set(data),
            (error) => {
                console.error('Failed to load DTCs', error);
                this.isLoading.set(false);
            }
        );
    }

    trackByCode(index: number, dtc: Dtc): string {
        return dtc.code || index.toString();
    }

    viewDtc(dtc: Dtc) {
        console.log('[DtcSection] Opening DTC:', dtc);

        if (this.windowManager.isDesktop()) {
            this.windowManager.openWindow(
                `DTC: ${dtc.code}`,
                ArticleViewerComponent,
                {
                    contentSource: this.contentSource,
                    vehicleId: this.vehicleId,
                    articleId: dtc.id,
                    articleTitleInput: `${dtc.code} - ${dtc.description}`
                }
            );
        } else {
            this.router.navigate(['/vehicle', this.contentSource, this.vehicleId, 'article', dtc.id], {
                queryParams: { title: `${dtc.code} - ${dtc.description}` }
            });
        }
    }
}
