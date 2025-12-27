import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { Subject, of } from 'rxjs';

// Models
import { Article } from '../../models/motor.models';

// Services
import { VehicleDataService } from '../../services/vehicle-data.service';
import { MotorApiService } from '../../services/motor-api.service';

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
import { LucideAngularModule, Menu, X } from 'lucide-angular';

export type DashboardSection = 'overview' | 'dtcs' | 'tsbs' | 'diagrams' | 'component-locations' | 'procedures' | 'parts' | 'specs' | 'maintenance';

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
    CommonIssuesSectionComponent
  ],
})
export class VehicleDashboardComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private motorApi = inject(MotorApiService);
  private vehicleData = inject(VehicleDataService);

  readonly icons = { Menu, X };

  // Route parameters
  params = toSignal(this.route.paramMap);
  contentSource = computed(() => this.params()?.get('contentSource') ?? '');
  vehicleId = computed(() => this.params()?.get('vehicleId') ?? '');
  motorVehicleId = computed(() => {
    const vid = this.vehicleId();
    if (vid && vid.includes(':')) {
      return vid.split(':')[1];
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
      const mvid = vid && vid.includes(':') ? vid.split(':')[1] : undefined;
      if (cs && vid) {
        return this.vehicleData.getAvailableSections(cs, vid, mvid);
      }
      return of(null);
    })
  );
  availableSections = toSignal(this.sections$, { initialValue: null });

  // UI State
  activeSection = signal<DashboardSection>('overview');
  isMobileMenuOpen = signal(false);

  // Search state
  searchTerm = signal('');
  private searchTerm$ = new Subject<string>();

  // Filtered articles for search
  allArticles = signal<Article[]>([]);

  private searchResults$ = this.searchTerm$.pipe(
    debounceTime(300),
    distinctUntilChanged(),
    switchMap(term => {
      if (!term || term.length < 2) return [];
      const cs = this.contentSource();
      const vid = this.vehicleId();
      if (!cs || !vid) return [];

      return this.motorApi.searchArticles(cs, vid, term).pipe(
        map(res => res.body.articleDetails || [])
      );
    })
  );

  searchResults = toSignal(this.searchResults$, { initialValue: [] });

  filteredArticles = computed(() => {
    const search = this.searchTerm().toLowerCase();
    const results = this.searchResults();

    if (!search || search.length < 2) return [];
    return results;
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
}
