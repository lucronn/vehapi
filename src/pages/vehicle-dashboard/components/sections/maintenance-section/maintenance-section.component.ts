import { LoggerService } from '@/src/services/logger.service';
import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { lastValueFrom } from 'rxjs';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { MotorApiService } from '../../../../../services/motor-api.service';
import { ApiDataService } from '../../../../../services/api-data.service';
import { MaintenanceSchedule } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, ClipboardList, Gauge, Lock, Unlock, Sparkles } from 'lucide-angular';
import { CreditsService } from '../../../../../services/credits.service';
import { WindowManagerService } from '../../../../../services/window-manager.service';
import { ArticleViewerComponent } from '../../../../article-viewer/article-viewer.component';
import { pickLaborArticleFromCatalog } from '../../../../../utils/maintenance-labor-resolve.util';

/**
 * Displays Maintenance Schedules with interval selector.
 *
 * **Why `/labor/L:…` for “maintenance” rows:** Motor stores PMSST lines under estimating/labor silos;
 * flat-rate time is served from the **labor** API, not `GET /article/…`. Credits still use
 * `moduleType: 'maintenance'` so the maintenance unlock applies. `applicationID` on schedule stubs
 * is **not** a labor catalog id — we resolve a real `L:` via `taxonomyLiteralName` + catalog match.
 */
@Component({
    selector: 'app-maintenance-section',
    templateUrl: './maintenance-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RouterModule, LoadingSkeletonComponent, EmptyStateComponent, LucideAngularModule],
    standalone: true
})
export class MaintenanceSectionComponent implements OnInit {
    private logger = inject(LoggerService);

    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;
    @Input() vehicleName: string = '';
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);
    private motorApi = inject(MotorApiService);
    private api = inject(ApiDataService);
    private router = inject(Router);
    private windowManager = inject(WindowManagerService);
    protected creditsService = inject(CreditsService);

    schedules = signal<MaintenanceSchedule[]>([]);
    isLoading = signal(false);
    isUnlocking = signal(false);
    /** True while resolving PMSST row → catalog `L:` id (async). */
    isResolvingLabor = signal(false);

    // Pagination state
    displayLimit = signal(50);

    // Computed property to return only the items we should show right now
    // If locked, we only show a tiny preview slice to save DOM/GPU memory for the blur effect
    displayedSchedules = signal<MaintenanceSchedule[]>([]);

    // Interval selection
    selectedInterval = signal<number>(30000); // Default to 30k
    availableIntervals = [
        7500, 15000, 30000, 45000, 60000,
        75000, 90000, 100000, 120000, 150000
    ];

    readonly icons = { ClipboardList, Gauge, Lock, Unlock, Sparkles };

    ngOnInit() {
        this.loadData();
    }

    onIntervalChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value;
        this.selectedInterval.set(Number(value));
        this.loadData();
    }

    private loadData() {
        this.vehicleData.loadMaintenanceSchedules(
            this.contentSource,
            this.vehicleId,
            this.motorVehicleId,
            this.selectedInterval(),
            this.isLoading,
            (data) => {
                this.schedules.set(data);
                this.updateDisplayedSchedules();
            },
            (error) => {
                this.logger.error('Failed to load maintenance schedules', error);
                // Ensure loading state is cleared even if service didn't handle it
                this.isLoading.set(false);
            }
        );
    }

    private updateDisplayedSchedules() {
        const hasAccess = this.creditsService.hasAccess(this.vehicleId, 'maintenance');
        const limit = hasAccess ? this.displayLimit() : 8; // Only 8 items if locked (preview)
        this.displayedSchedules.set(this.schedules().slice(0, limit));
    }

    loadMore() {
        this.displayLimit.update(v => v + 50);
        this.updateDisplayedSchedules();
    }

    /**
     * Row can open detail if we have either a PMSST application id (weak fallback) or
     * `taxonomyLiteralName` from merged `body.applications` (strong match path).
     */
    rowCanOpenDetail(item: MaintenanceSchedule): boolean {
        const m = item.taskMetadata;
        if (!m) return false;
        const id = m['applicationID'] ?? m['applicationId'];
        const lit = m['taxonomyLiteralName'];
        const hasApp = id != null && String(id).trim() !== '';
        const hasLit = typeof lit === 'string' && lit.trim() !== '';
        return hasApp || hasLit;
    }

    /**
     * Resolve catalog `L:` id: DB `articles` → Motor search by taxonomy → full catalog scan.
     */
    private async resolveLaborArticleId(item: MaintenanceSchedule): Promise<{ id: string; title: string } | null> {
        const m = item.taskMetadata!;
        const literal =
            typeof m['taxonomyLiteralName'] === 'string' ? m['taxonomyLiteralName'].trim() : '';
        const appRaw = m['applicationID'] ?? m['applicationId'];
        const appId = appRaw != null ? String(appRaw).trim() : '';

        const mapRow = (r: {
            original_id: string;
            title?: string | null;
            bucket?: string | null;
            parent_bucket?: string | null;
        }) => ({
            id: r.original_id,
            title: r.title || '',
            bucket: r.bucket || undefined,
            parentBucket: r.parent_bucket || undefined
        });

        const { data: supRows, error: supErr } = await this.api
            .from('articles')
            .select('original_id,title,bucket,parent_bucket')
            .eq('vehicle_id', this.vehicleId)

            .limit(2000);

        if (!supErr && supRows?.length) {
            const picked = pickLaborArticleFromCatalog(
                supRows.filter((r: any) => r.original_id?.startsWith('L:')).map(mapRow),
                literal,
                item.description
            );
            if (picked) return picked;
        }

        if (literal) {
            try {
                const res = await lastValueFrom(
                    this.motorApi.searchArticles(
                        this.contentSource,
                        this.vehicleId,
                        literal,
                        this.motorVehicleId
                    )
                );
                const picked = pickLaborArticleFromCatalog(
                    res.body?.articleDetails || [],
                    literal,
                    item.description
                );
                if (picked) return picked;
            } catch {
                /* fall through */
            }
        }

        try {
            const resAll = await lastValueFrom(
                this.motorApi.searchArticles(this.contentSource, this.vehicleId, '', this.motorVehicleId)
            );
            const picked = pickLaborArticleFromCatalog(
                resAll.body?.articleDetails || [],
                literal,
                item.description
            );
            if (picked) return picked;
        } catch {
            /* fall through */
        }

        if (appId) {
            return { id: `L:${appId}`, title: `${item.action} — ${item.description}`.trim() };
        }
        return null;
    }

    async openMaintenanceRow(item: MaintenanceSchedule): Promise<void> {
        if (!this.creditsService.hasAccess(this.vehicleId, 'maintenance')) return;
        if (!this.rowCanOpenDetail(item)) return;
        if (this.isResolvingLabor()) return;

        this.isResolvingLabor.set(true);
        try {
            const resolved = await this.resolveLaborArticleId(item);
            if (!resolved) return;

            const title = `${item.action} — ${resolved.title}`.trim();
            const laborId = resolved.id;

            if (this.windowManager.isDesktop()) {
                this.windowManager.openWindow(title, ArticleViewerComponent, {
                    contentSource: this.contentSource,
                    vehicleId: this.vehicleId,
                    articleId: laborId,
                    articleTitleInput: title,
                    moduleType: 'maintenance'
                });
            } else {
                this.router.navigate(['/vehicle', this.contentSource, this.vehicleId, 'article', laborId], {
                    queryParams: { title, moduleType: 'maintenance' }
                });
            }
        } finally {
            this.isResolvingLabor.set(false);
        }
    }

    async unlockSection() {
        if (this.isUnlocking()) return;

        const cost = this.creditsService.COSTS.MAINTENANCE;
        if (this.creditsService.balance() < cost) return;

        this.isUnlocking.set(true);
        const success = await this.creditsService.unlockModule(this.vehicleId, this.vehicleName, 'maintenance', cost);
        this.isUnlocking.set(false);

        if (success) {
            this.updateDisplayedSchedules();
        }
    }
}
