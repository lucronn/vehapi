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

// Icons
import { LucideAngularModule, Menu, X, House, TriangleAlert, FileText, Wrench, Package } from 'lucide-angular';

// Local Components
import { LogoComponent } from '../../components/logo/logo.component';
import { OrientationSelectorModalComponent, OrientationOption } from '../../components/orientation-selector-modal/orientation-selector-modal.component';

export type DashboardSection = 'overview' | 'dtcs' | 'tsbs' | 'diagrams' | 'component-locations' | 'procedures' | 'parts' | 'specs' | 'maintenance' | 'browse-all';

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
    CommonIssuesSectionComponent,
    LogoComponent,
    OrientationSelectorModalComponent
  ],
})
export class VehicleDashboardComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private motorApi = inject(MotorApiService);
  private vehicleData = inject(VehicleDataService);
  public searchResultsState = inject(SearchResultsState);

  readonly icons = { Menu, X, House, TriangleAlert, FileText, Wrench, Package };

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

  // Trigger Initial Data Load and Fallback Logic
  constructor() {
    // Data loading effect
    effect(() => {
      const cs = this.contentSource();
      const vid = this.vehicleId();
      const mvid = this.motorVehicleId();

      if (cs && vid) {
        this.searchResultsState.search(cs, vid, '', mvid);
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
        if (cs && vid) {
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

  // Orientation Selection
  onArticleClick(event: Event, articleId: string): void {
    // Check if this article needs orientation selection
    // Article ID "-999" or similar indicates orientation required
    if (articleId === '-999' || articleId.includes('SelectOrientation')) {
      event.preventDefault();
      this.loadOrientationOptions(articleId);
    }
  }

  private loadOrientationOptions(articleId: string): void {
    // In production this would call the Motor API to get orientations
    // For now, we'll show a placeholder
    // TODO: Implement Motor API call to /api/source/{}/vehicle/{}/article/{}/orientations

    const cs = this.contentSource();
    const vid = this.vehicleId();

    // Mock orientation options (this should come from API)
    this.orientationOptions.set([
      { id: 'P:539447705', displayName: '3.5L V6 DOHC', qualifier: '290 HP' },
      { id: 'P:539447706', displayName: '3.7L V6 Flexfuel', qualifier: '305 HP' },
      { id: 'P:539447707', displayName: '3.5L V6 EcoBoost', qualifier: '365 HP - Police Package' },
      { id: 'P:539447708', displayName: '2.0L I4 EcoBoost', qualifier: '240 HP' }
    ]);

    this.pendingArticleId.set(articleId);
    this.showOrientationModal.set(true);
  }

  onOrientationSelected(option: OrientationOption): void {
    this.showOrientationModal.set(false);

    // Navigate to the article with the selected orientation ID
    const cs = this.contentSource();
    const vid = this.vehicleId();
    this.router.navigate(['/vehicle', cs, vid, 'article', option.id]);
  }

  closeOrientationModal(): void {
    this.showOrientationModal.set(false);
    this.orientationOptions.set([]);
    this.pendingArticleId.set(null);
  }
}
