import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, debounceTime, distinctUntilChanged, catchError } from 'rxjs/operators';
import { Subject, of } from 'rxjs';

// Models
import { Article, PersistedVehicle } from '../../models/motor.models';
import { bucketToModuleType } from '../../utils/module-access.util';

// Services
import { VehicleDataService } from '../../services/vehicle-data.service';
import { MotorApiService } from '../../services/motor-api.service';
import { SearchResultsState } from '../../services/search-results.state';
import { DataSyncService } from '../../services/data-sync.service';
import { VehiclePersistenceService } from '../../services/vehicle-persistence.service';
import { AuthService } from '../../services/auth.service';
import { effect } from '@angular/core';
import { PageTitleService } from '../../services/page-title.service';

// Components
import { DashboardSidebarComponent } from './components/layout/dashboard-sidebar/dashboard-sidebar.component';
import { DashboardSearchComponent } from './components/layout/dashboard-search/dashboard-search.component';
import { SpecsFluidsSectionComponent } from './components/sections/specs-fluids-section/specs-fluids-section.component';
import { DtcSectionComponent } from './components/sections/dtc-section/dtc-section.component';
import { TsbSectionComponent } from './components/sections/tsb-section/tsb-section.component';
import { ProceduresSectionComponent } from './components/sections/procedures-section/procedures-section.component';
import { DiagramsSectionComponent } from './components/sections/diagrams-section/diagrams-section.component';
import { ComponentLocationsSectionComponent } from './components/sections/component-locations-section/component-locations-section.component';
import { MaintenanceSectionComponent } from './components/sections/maintenance-section/maintenance-section.component';
import { PartsSectionComponent } from './components/sections/parts-section/parts-section.component';
import { CommonIssuesSectionComponent } from './components/sections/common-issues-section/common-issues-section.component';
import { SyncProgressOverlayComponent } from './components/layout/sync-progress-overlay/sync-progress-overlay.component';
import { L2SearchPanelComponent } from './components/layout/l2-search-panel/l2-search-panel.component';
import { environment } from '../../environments/environment';

// Icons
import { LucideAngularModule, Menu, X, House, TriangleAlert, FileText, Wrench, Package, Lightbulb, CreditCard } from 'lucide-angular';

// Local Components
import { LogoComponent } from '../../components/logo/logo.component';
import { OrientationSelectorModalComponent, OrientationOption } from '../../components/orientation-selector-modal/orientation-selector-modal.component';
import { ThemeToggleComponent } from '../../components/theme-toggle/theme-toggle.component';
import { ArticleViewerComponent } from '../article-viewer/article-viewer.component';
import { WindowManagerService } from '../../services/window-manager.service';
import { AuthModalComponent } from '../../components/auth-modal/auth-modal.component';

export type DashboardSection = 'overview' | 'dtcs' | 'tsbs' | 'diagrams' | 'component-locations' | 'procedures' | 'parts' | 'specs' | 'maintenance' | 'browse-all' | 'common-issues';

const DASHBOARD_SECTION_LABEL: Record<DashboardSection, string | undefined> = {
  overview: undefined,
  dtcs: 'Diagnostic Codes',
  tsbs: 'TSBs',
  diagrams: 'Wiring Diagrams',
  'component-locations': 'Component Locations',
  procedures: 'Procedures',
  parts: 'Parts',
  specs: 'Specifications',
  maintenance: 'Maintenance',
  'browse-all': 'Browse All',
  'common-issues': 'Common Issues',
};

/**
 * Main vehicle dashboard orchestrator component
 * Delegates data display to modular section components
 */
@Component({
  selector: 'app-vehicle-dashboard',
  templateUrl: './vehicle-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    LucideAngularModule,
    DashboardSidebarComponent,
    DashboardSearchComponent,
    SpecsFluidsSectionComponent,
    DtcSectionComponent,
    TsbSectionComponent,
    ProceduresSectionComponent,
    DiagramsSectionComponent,
    ComponentLocationsSectionComponent,
    MaintenanceSectionComponent,
    PartsSectionComponent,
    LogoComponent,
    OrientationSelectorModalComponent,
    ThemeToggleComponent,
    AuthModalComponent,
    SyncProgressOverlayComponent,
    CommonIssuesSectionComponent,
    L2SearchPanelComponent
  ],
})
export class VehicleDashboardComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private motorApi = inject(MotorApiService);
  private vehicleData = inject(VehicleDataService);
  public searchResultsState = inject(SearchResultsState);
  public dataSync = inject(DataSyncService);
  private persistence = inject(VehiclePersistenceService);
  private auth = inject(AuthService);
  private pageTitle = inject(PageTitleService);
  /** Avoid duplicate Motor Information base-vehicle requests per vehicle+YMME. */
  private motorBaseVehicleResolveInFlight = new Set<string>();

  readonly icons = { Menu, X, House, TriangleAlert, FileText, Wrench, Package, Lightbulb, CreditCard };

  /** L2 semantic search panel (feature-flagged). */
  readonly l2SearchEnabled = environment.features?.l2Search === true;

  // Route parameters
  params = toSignal(this.route.paramMap);
  contentSource = computed(() => this.params()?.get('contentSource') ?? '');
  vehicleId = computed(() => this.params()?.get('vehicleId') ?? '');
  motorVehicleId = computed(() => {
    const vid = this.vehicleId();
    const cs = this.contentSource()?.toUpperCase();

    // If content source is MOTOR, the vehicleId IS exactly what we need
    // No splitting required as MOTOR often uses composite IDs like "61009:2913"
    if (cs === 'MOTOR') {
      return vid;
    }

    // Improved parsing for composite IDs from other sources (e.g., "Source:ID")
    if (vid && vid.includes(':')) {
      const parts = vid.split(':');
      // Return everything after the first segment (handles multi-colon cases)
      return parts.slice(1).join(':');
    }

    return undefined;
  });

  // Vehicle info: always resolve via proxy; `vehicles.name` is not guaranteed in current schema.
  private vehicleInfo$ = this.route.paramMap.pipe(
    switchMap(params => {
      const contentSource = params.get('contentSource');
      const vehicleId = params.get('vehicleId');
      if (!contentSource || !vehicleId) return of('');

      return this.motorApi.getVehicleName(contentSource, vehicleId).pipe(
        map(res => res.body || ''),
        catchError(() => of(''))
      );
    })
  );



  vehicleName = toSignal(this.vehicleInfo$, { initialValue: '' });

  // Section Availability
  private sections$ = this.route.paramMap.pipe(
    switchMap(params => {
      const cs = params.get('contentSource');
      const vid = params.get('vehicleId');

      // Use the same consistent logic as the motorVehicleId computed signal
      const mvid = cs?.toUpperCase() === 'MOTOR' ? vid : (vid && vid.includes(':') ? vid.split(':').slice(1).join(':') : undefined);

      if (cs && vid) {
        return this.vehicleData.getAvailableSections(cs, vid, mvid);
      }
      return of(null);
    })
  );
  availableSections = toSignal(this.sections$, { initialValue: null });

  // State for vehicle resolution (non-MOTOR -> MOTOR)
  isResolvingVehicle = signal(false);

  // Trigger Initial Data Load and Fallback Logic
  constructor() {
    // Data loading effect
    effect(() => {
      const cs = this.contentSource();
      const vid = this.vehicleId();
      const mvid = this.motorVehicleId();

      if (cs && vid) {
        // 1. Check Normalization Status (One-time slow load)
        this.checkAndTriggerNormalization(cs, vid);

        // 2. If it's a non-MOTOR source, try to resolve it to a MOTOR ID first
        if (cs.toUpperCase() !== 'MOTOR') {
          this.resolveVehicleMapping(cs, vid);
        } else {
          this.searchResultsState.searchWithNormalizationCheck(cs, vid, '', mvid);
        }
      }
    });

    // Persist vehicle for "welcome back" on home page
    effect(() => {
      const name = this.vehicleName();
      const cs = this.contentSource();
      const vid = this.vehicleId();
      if (name && cs && vid && name !== 'Unknown Vehicle') {
        const prev = this.persistence.getVehicle();
        const merged: PersistedVehicle = {
          vehicleId: vid,
          contentSource: cs,
          name,
          ...(prev?.vehicleId === vid
            ? {
                year: prev.year,
                makeName: prev.makeName,
                modelName: prev.modelName,
                motorEngineId: prev.motorEngineId,
                motorBaseVehicleId: prev.motorBaseVehicleId
              }
            : {})
        };
        this.persistence.saveVehicle(merged);
      }
    });

    // Cache Motor Information BaseVehicleID when user is signed in and YMME came from home wizard
    effect(() => {
      const vid = this.vehicleId();
      const u = this.auth.user();
      if (!vid || !u) return;
      const pv = this.persistence.getVehicle();
      if (!pv || pv.vehicleId !== vid) return;
      if (pv.motorBaseVehicleId) return;
      if (pv.year == null || !pv.makeName || !pv.modelName) return;
      const key = `${vid}|${pv.year}|${pv.makeName}|${pv.modelName}`;
      if (this.motorBaseVehicleResolveInFlight.has(key)) return;
      this.motorBaseVehicleResolveInFlight.add(key);
      this.motorApi.getMotorInformationBaseVehicle(pv.year, pv.makeName, pv.modelName).subscribe({
        next: (res) => {
          this.motorBaseVehicleResolveInFlight.delete(key);
          const cur = this.persistence.getVehicle();
          if (cur?.vehicleId === vid) {
            this.persistence.saveVehicle({ ...cur, motorBaseVehicleId: String(res.baseVehicleId) });
          }
        },
        error: () => {
          this.motorBaseVehicleResolveInFlight.delete(key);
        }
      });
    });

    // Section availability fallback effect
    effect(() => {
      const avail = this.availableSections();
      if (!avail) return;

      const current = this.activeSection();
      if (current === 'overview' || current === 'browse-all') return;

      // Check if current section is still available
      const mapping: Record<string, boolean> = {
        'dtcs': avail.hasDtcs,
        'tsbs': avail.hasTsbs,
        'diagrams': avail.hasDiagrams,
        'procedures': avail.hasProcedures,
        'specs': avail.hasSpecs,
        'parts': avail.hasParts,
        'maintenance': avail.hasMaintenance,
        'component-locations': avail.hasComponentLocations
      };

      if (mapping[current] === false) {
        console.warn(`[Dashboard] Section "${current}" is unavailable. Reverting to overview.`);
        this.activeSection.set('overview');
      }
    });

    effect(() => {
      const name = this.vehicleName().trim();
      const section = this.activeSection();
      if (!name) {
        this.pageTitle.set();
        return;
      }
      const sectionLabel = DASHBOARD_SECTION_LABEL[section];
      this.pageTitle.setVehicle(name, sectionLabel);
    });
  }

  // UI State
  activeSection = signal<DashboardSection>('overview');
  isMobileMenuOpen = signal(false);
  showAuthModal = signal(false);

  // Orientation Selection State
  showOrientationModal = signal(false);
  orientationOptions = signal<OrientationOption[]>([]);
  pendingArticleId = signal<string | null>(null);
  selectedBrowseFilter = signal<string | null>(null); // For browse-all filter pills

  // Search state
  searchTerm = signal('');
  private searchTerm$ = new Subject<string>();

  // Filtered articles for search
  allArticles = signal<Article[]>([]);

  private searchResults$ = this.searchTerm$.pipe(
    debounceTime(300),
    distinctUntilChanged(),
    switchMap(term => {
      if (!term || term.length < 2) {
        // Reset to empty search to show full buckets
        const cs = this.contentSource();
        const vid = this.vehicleId();
        // Only search if we are on MOTOR source (or if we decided to support others directly)
        // But for now, we rely on the redirection logic for Ford
        if (cs && vid && cs.toUpperCase() === 'MOTOR') {
          this.searchResultsState.searchWithNormalizationCheck(cs, vid, '', this.motorVehicleId());
        }
        return of([]);
      }
      const cs = this.contentSource();
      const vid = this.vehicleId();
      if (!cs || !vid) return of([]);

      // Direct search without AI optimization
      this.searchResultsState.searchWithNormalizationCheck(cs, vid, term, this.motorVehicleId());
      // Return observable purely for filteredArticles consumption if needed, 
      // but we should arguably rely on searchResultsState.articleDetails()
      return of([]);
    })
  );

  searchResults = toSignal(this.searchResults$, { initialValue: [] });

  filteredArticles = computed(() => {
    const search = this.searchTerm().toLowerCase();
    // Use State articles
    const results = this.searchResultsState.articleDetails();

    if (!search || search.length < 2) return [];
    return results;
  });

  // Filtered tabs for browse-all section
  filteredBrowseTabs = computed(() => {
    const selectedFilter = this.selectedBrowseFilter();
    const allTabs = this.searchResultsState.filterTabsAndTheirFullBuckets();

    if (!selectedFilter) return allTabs;
    return allTabs.filter(tab => tab.filterTab === selectedFilter);
  });

  // Section navigation
  setSection(section: DashboardSection): void {
    this.activeSection.set(section);
    this.isMobileMenuOpen.set(false);
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen.update(v => !v);
  }

  // Search handling
  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.searchTerm$.next(term);
  }

  // Filter pills for browse-all
  setBrowseFilter(filterTab: string | null): void {
    this.selectedBrowseFilter.set(filterTab);
  }

  // Vehicle Mapping Resolution
  private resolveVehicleMapping(contentSource: string, vehicleId: string) {
    this.motorApi.getMotorVehicles(contentSource, vehicleId).pipe(
      map(res => res.body || [])
    ).subscribe({
      next: (mappings: any[]) => {
        if (!mappings || mappings.length === 0) {
          console.warn('[Dashboard] No MOTOR mapping found for vehicle, falling back to original source');
          this.searchResultsState.searchWithNormalizationCheck(contentSource, vehicleId, '', this.motorVehicleId());
          return;
        }

        // Flatten mappings to get all engine options
        // Each mapping has { model: string, engines: { id: string, name: string }[] }
        const options: OrientationOption[] = mappings.flatMap(mapping =>
          (mapping.engines && Array.isArray(mapping.engines))
            ? mapping.engines.map((engine: any) => ({
              id: engine.id,
              displayName: `${mapping.model} - ${engine.name}`,
              qualifier: 'Select this configuration'
            }))
            : []
        );

        if (options.length > 0) {
          // If only one option, could auto-select, but explicit is safer for now
          // unless it is extremely obvious. 
          // For Ford Crown Vic, we have different models (LX, Interceptor), so selection is good.
          this.orientationOptions.set(options);
          this.isResolvingVehicle.set(true);
          this.showOrientationModal.set(true);
        } else {
          // No options parsed, fall back
          console.warn('[Dashboard] No valid engine options found in mapping, falling back');
          this.searchResultsState.searchWithNormalizationCheck(contentSource, vehicleId, '', this.motorVehicleId());
        }
      },
      error: (err) => {
        if (err?.name === 'AbortError' || err?.error?.name === 'AbortError') {
          // Silently ignore HTTP cancellations during rapid navigation
          return;
        }
        console.error('[Dashboard] Failed to resolve vehicle mapping, falling back', err);
        this.searchResultsState.searchWithNormalizationCheck(contentSource, vehicleId, '', this.motorVehicleId());
      }
    });
  }

  // Services
  private windowManager = inject(WindowManagerService);

  private async checkAndTriggerNormalization(cs: string, vid: string) {
    const name = this.vehicleName() || 'Vehicle';
    const mvid = this.motorVehicleId();
    await this.dataSync.ensureVehicleRecord(cs, vid, name);
    void this.dataSync.eagerSyncVehicleReferenceData(cs, vid, mvid).catch((err: unknown) =>
      console.warn('[VehicleDashboard] Eager reference sync failed (non-fatal):', err)
    );
  }

  // Orientation Selection
  onArticleClick(event: Event | null, article: Article | any): void {
    if (event) event.preventDefault();

    const articleId = article.id || article;

    if (articleId === '-999' || (typeof articleId === 'string' && articleId.includes('SelectOrientation'))) {
      this.loadOrientationOptions(articleId);
      return;
    }

    const contentSource = this.contentSource();
    const vehicleId = this.vehicleId();
    const title = article.title || 'Article Viewer';
    const moduleType = article.moduleType ?? bucketToModuleType(article.bucket, article.parentBucket);

    if (contentSource && vehicleId && articleId) {
      const queryParams: Record<string, string> = { title };
      if (moduleType) queryParams['moduleType'] = moduleType;

      if (this.windowManager.isDesktop()) {
        this.windowManager.openWindow(
          title,
          ArticleViewerComponent,
          {
            articleId: articleId,
            contentSource: contentSource,
            vehicleId: vehicleId,
            articleTitleInput: title,
            moduleType: moduleType ?? undefined
          }
        );
      } else {
        this.router.navigate(['/vehicle', contentSource, vehicleId, 'article', articleId], {
          queryParams
        });
      }
    }
  }

  private loadOrientationOptions(articleId: string): void {
    const cs = this.contentSource();
    const vid = this.vehicleId();

    if (!cs || !vid) {
      console.error('Missing contentSource or vehicleId');
      return;
    }

    this.motorApi.getArticleOrientations(cs, vid, articleId).subscribe({
      next: (res) => {
        if (res.body && res.body.orientations) {
          this.orientationOptions.set(res.body.orientations);
          this.pendingArticleId.set(articleId);
          this.showOrientationModal.set(true);
        } else {
          console.warn('No orientations found for article', articleId);
        }
      },
      error: (err) => {
        console.error('Failed to load orientations', err);
      }
    });
  }

  onOrientationSelected(option: OrientationOption): void {
    this.showOrientationModal.set(false);

    // If we are resolving a vehicle mapping, redirect to the MOTOR vehicle
    if (this.isResolvingVehicle()) {
      this.isResolvingVehicle.set(false);
      this.orientationOptions.set([]); // Clear options

      // Navigate to the MOTOR source with the selected Engine ID
      this.router.navigate(['/vehicle', 'MOTOR', option.id]);
      return;
    }

    // Normal article orientation selection
    const cs = this.contentSource();
    const vid = this.vehicleId();
    this.router.navigate(['/vehicle', cs, vid, 'article', option.id]);
  }

  closeOrientationModal(): void {
    this.showOrientationModal.set(false);
    this.orientationOptions.set([]);
    this.pendingArticleId.set(null);
    this.isResolvingVehicle.set(false); // Reset this state on close
  }
}
