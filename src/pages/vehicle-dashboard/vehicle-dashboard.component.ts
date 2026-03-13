import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, debounceTime, distinctUntilChanged, catchError } from 'rxjs/operators';
import { Subject, of } from 'rxjs';

// Models
import { Article } from '../../models/motor.models';

// Services
import { VehicleDataService } from '../../services/vehicle-data.service';
import { MotorApiService } from '../../services/motor-api.service';
import { SearchResultsState } from '../../services/search-results.state';
import { DataSyncService } from '../../services/data-sync.service';
import { effect } from '@angular/core';

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

// Icons
import { LucideAngularModule, Menu, X, House, TriangleAlert, FileText, Wrench, Package, Lightbulb } from 'lucide-angular';

// Local Components
import { LogoComponent } from '../../components/logo/logo.component';
import { OrientationSelectorModalComponent, OrientationOption } from '../../components/orientation-selector-modal/orientation-selector-modal.component';
import { ThemeToggleComponent } from '../../components/theme-toggle/theme-toggle.component';
import { ArticleViewerComponent } from '../article-viewer/article-viewer.component';
import { WindowManagerService } from '../../services/window-manager.service';
import { AuthModalComponent } from '../../components/auth-modal/auth-modal.component';

export type DashboardSection = 'overview' | 'dtcs' | 'tsbs' | 'diagrams' | 'component-locations' | 'procedures' | 'parts' | 'specs' | 'maintenance' | 'browse-all' | 'common-issues';

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
    CommonIssuesSectionComponent
  ],
})
export class VehicleDashboardComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private motorApi = inject(MotorApiService);
  private vehicleData = inject(VehicleDataService);
  public searchResultsState = inject(SearchResultsState);
  public dataSync = inject(DataSyncService);

  readonly icons = { Menu, X, House, TriangleAlert, FileText, Wrench, Package, Lightbulb };

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

  // Vehicle info
  private vehicleInfo$ = this.route.paramMap.pipe(
    switchMap(params => {
      const contentSource = params.get('contentSource');
      const vehicleId = params.get('vehicleId');
      if (contentSource && vehicleId) {
        return this.motorApi.getVehicleName(contentSource, vehicleId).pipe(
          map(res => res.body || '')
        );
      }
      return of('');
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
          this.searchResultsState.search(cs, vid, '', mvid);
        }
      }
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
          this.searchResultsState.search(cs, vid, '', this.motorVehicleId());
        }
        return of([]);
      }
      const cs = this.contentSource();
      const vid = this.vehicleId();
      if (!cs || !vid) return of([]);

      // Direct search without AI optimization
      this.searchResultsState.search(cs, vid, term, this.motorVehicleId());
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
          this.searchResultsState.search(contentSource, vehicleId, '', this.motorVehicleId());
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
          this.searchResultsState.search(contentSource, vehicleId, '', this.motorVehicleId());
        }
      },
      error: (err) => {
        if (err?.name === 'AbortError' || err?.error?.name === 'AbortError') {
          // Silently ignore HTTP cancellations during rapid navigation
          return;
        }
        console.error('[Dashboard] Failed to resolve vehicle mapping, falling back', err);
        this.searchResultsState.search(contentSource, vehicleId, '', this.motorVehicleId());
      }
    });
  }

  // Services
  private windowManager = inject(WindowManagerService);

  // Normalization Flow
  private async checkAndTriggerNormalization(cs: string, vid: string) {
    // We only trigger "Full" sync for core metadata and essential features (Common Issues, Specs)
    // Deep article content is now handled lazily in ArticleViewer
    const name = this.vehicleName() || 'Vehicle';
    // this.dataSync.syncFullVehicle(cs, vid, name);
  }

  // Orientation Selection
  onArticleClick(event: Event | null, article: Article | any): void {
    // Prevent default navigation
    if (event) {
      event.preventDefault();
    }
    // Prevent default navigation
    if (event) {
      event.preventDefault();
    }

    const articleId = article.id || article;

    // Check if this article needs orientation selection
    // Article ID "-999" or similar indicates orientation required
    if (articleId === '-999' || (typeof articleId === 'string' && articleId.includes('SelectOrientation'))) {
      this.loadOrientationOptions(articleId);
      return;
    }

    // Open in Window or Navigate on Mobile
    const contentSource = this.contentSource();
    const vehicleId = this.vehicleId();
    const title = article.title || 'Article Viewer';

    if (contentSource && vehicleId && articleId) {
      if (this.windowManager.isDesktop()) {
        this.windowManager.openWindow(
          title,
          ArticleViewerComponent,
          {
            articleId: articleId,
            contentSource: contentSource,
            vehicleId: vehicleId,
            articleTitleInput: title
          }
        );
      } else {
        this.router.navigate(['/vehicle', contentSource, vehicleId, 'article', articleId], {
          queryParams: { title }
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
