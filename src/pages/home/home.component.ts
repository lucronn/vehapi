import { ChangeDetectionStrategy, Component, computed, inject, signal, ElementRef, HostListener, ViewChild, OnInit, DestroyRef, ChangeDetectorRef } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, firstValueFrom } from 'rxjs';

import { MotorApiService } from '../../services/motor-api.service';
import { VehiclePersistenceService } from '../../services/vehicle-persistence.service';
import { DataSyncService } from '../../services/data-sync.service';
import { LogoComponent } from '../../components/logo/logo.component';
import { Make, Model, Engine, PersistedVehicle } from '../../models/motor.models';
import { LucideAngularModule, Search, X, ArrowRight, ArrowUpRight, ArrowLeft } from 'lucide-angular';
import { ThemeToggleComponent } from '../../components/theme-toggle/theme-toggle.component';
import { PageTitleService } from '../../services/page-title.service';
import { LoggerService } from '../../services/logger.service';
import { CommandPaletteService, type CommandPaletteItem } from '../../services/command-palette.service';
import { FocusDepthDirective } from '../../directives/focus-depth.directive';
import { normalizeYearList } from '../../utils/year-list';

type Suggestion =
  | { type: 'Decade'; value: number; display: string }
  | { type: 'Year'; value: number; display: string }
  | { type: 'Make'; value: Make; display: string }
  | { type: 'Model'; value: Model; display: string }
  | { type: 'Engine'; value: { vehicleId: string; displayName: string }; display: string };

type WizardPhase = 'pick' | 'confirm';
type YearPickerMode = 'decade' | 'year';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, LogoComponent, RouterModule, LucideAngularModule, ThemeToggleComponent, FocusDepthDirective],
})
export class HomeComponent implements OnInit {
  readonly icons = { Search, X, ArrowRight, ArrowUpRight, ArrowLeft };
  private motorApi = inject(MotorApiService);
  private persistence = inject(VehiclePersistenceService);
  private dataSync = inject(DataSyncService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);
  private pageTitle = inject(PageTitleService);
  private logger = inject(LoggerService);
  private commandPalette = inject(CommandPaletteService);
  private motorVehicleMappingInFlight = false;

  constructor() { }

  @ViewChild('searchInputRef') searchInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('ymmePickerRef') ymmePickerRef!: ElementRef<HTMLDivElement>;

  // Search State
  searchInput = signal(''); // Immediate input value
  searchTerm = signal(''); // Debounced search term for logic
  private searchSubject = new Subject<string>();

  currentContentSource = signal<string>('MOTOR'); // Start with default, update dynamically
  selectedYear = signal<number | null>(null);
  selectedMake = signal<Make | null>(null);
  selectedModel = signal<Model | null>(null); // New Intermediate State
  selectedVehicle = signal<{ vehicleId: string; displayName: string } | null>(null);

  // Data
  private years = signal<any | null>(null);
  private makes = signal<Make[]>([]);
  private models = signal<Model[]>([]);
  private engines = signal<Engine[]>([]); // Available engines for selected model
  persistedVehicle = signal<PersistedVehicle | null>(null);

  // UI State
  isLoading = signal(false);
  errorMessage = signal<string | null>(null);
  showSuggestions = signal(false);
  private ignoreNextDocumentClick = false;
  wizardSlideBack = signal(false);
  wizardPhase = signal<WizardPhase>('pick');
  yearPickerMode = signal<YearPickerMode>('decade');
  selectedDecade = signal<number | null>(null);
  private readonly WIZARD_CHUNK = 8;
  /** How many wizard list rows to render (grows on “Show more”). */
  wizardListLimit = signal(8);
  viewportHeight = signal<number>(0);
  private baseViewportHeight = signal<number>(0);
  selectedSuggestionIndex = signal<number>(-1); // For keyboard navigation

  ngOnInit(): void {
    this.pageTitle.set();
    void this.loadYears();
    this.persistedVehicle.set(this.persistence.getVehicle());
    this.registerHomeCommands();

    this.searchSubject.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef) // Prevents memory leak
    ).subscribe(term => {
      this.searchTerm.set(term);
    });

    this.updateViewportHeight();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.updateViewportHeight());
    }

    this.destroyRef.onDestroy(() => {
      if (typeof document !== 'undefined') {
      }
    });
  }

  /** Max attempts (first load + retries after auth recovery) before giving up on `/api/years`. */
  private static readonly MAX_LOAD_YEARS_AUTH_RETRIES = 3;

  private async loadYears(attempt = 0): Promise<void> {
    try {
      const res = await firstValueFrom(this.motorApi.getYears());
      this.years.set(res);
      if (res?.body && Array.isArray(res.body) && res.header?.statusCode === 200) {
        await this.dataSync.cacheVehicleMetadata('/years', res);
      }
    } catch (error: any) {
      this.logger.error('Failed to load years:', error);
      this.logger.error('Error details:', {
        error,
        message: error?.message || error?.toString() || 'Unknown error',
        status: error?.status
      });

      const isAuthRefresh = (error?.status === 401 || error?.status === 403) &&
        (error?.error?.authStatus === 'authenticating' || error?.error?.authStatusUrl);

      if (isAuthRefresh) {
        const recovered = await this.waitForAuthRecovery();
        if (
          recovered &&
          attempt < HomeComponent.MAX_LOAD_YEARS_AUTH_RETRIES - 1
        ) {
          await this.loadYears(attempt + 1);
          return;
        }
      }

      this.years.set(null);
    }
  }

  private async waitForAuthRecovery(): Promise<boolean> {
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const status = await firstValueFrom(this.motorApi.getAuthStatus());
        const sessionValid = (status as any)?.sessionValid === true;
        if (status?.status === 'success' || sessionValid) {
          return true;
        }
      } catch {
        // Keep polling with backoff while re-authentication settles.
      }

      await new Promise(resolve => setTimeout(resolve, 800 + attempt * 200));
    }

    return false;
  }
  isMobile = signal(false);

  private updateViewportHeight(): void {
    if (typeof window === 'undefined') return;

    this.isMobile.set(window.innerWidth < 768);

    // Store base viewport height (without keyboard)
    if (this.baseViewportHeight() === 0) {
      this.baseViewportHeight.set(window.innerHeight);
    }

    // Use visual viewport height if available (accounts for mobile keyboard)
    const height = window.visualViewport?.height ?? window.innerHeight;
    this.viewportHeight.set(height);
  }



  wizardProgress = computed(() => {
    if (this.wizardPhase() === 'confirm') return 100;
    const step = this.searchStep();
    const idx = this.ymmeFlow.indexOf(step);
    return ((idx + 1) / this.ymmeFlow.length) * 100;
  });

  wizardStepLabel = computed(() => {
    if (this.wizardPhase() === 'confirm') return 'Does this look right?';
    if (this.searchStep() === 'Year' && this.yearPickerMode() === 'decade') {
      return 'Choose a decade';
    }
    switch (this.searchStep()) {
      case 'Year': return 'What year is your vehicle?';
      case 'Make': return 'Which make?';
      case 'Model': return 'Which model?';
      case 'Engine': return 'Which engine?';
    }
  });

  wizardFilterPlaceholder = computed(() => {
    switch (this.searchStep()) {
      case 'Year': return 'Filter years…';
      case 'Make': return 'Filter makes…';
      case 'Model': return 'Filter models…';
      case 'Engine': return 'Filter engines…';
    }
  });

  /** Full YMME line for the home launch card (year make model [· engine]). */
  ymmeSelectionLabel = computed(() => {
    const year = this.selectedYear();
    const makeName = this.selectedMake()?.makeName?.trim();
    const modelName = this.selectedModel()?.model?.trim();
    const vehicle = this.selectedVehicle();

    const segments: string[] = [];
    if (year != null) segments.push(String(year));
    if (makeName) segments.push(makeName);
    if (modelName) segments.push(modelName);

    if (segments.length === 0) return null;

    let label = segments.join(' ');

    if (vehicle?.displayName && modelName) {
      const display = vehicle.displayName.trim();
      if (display && display !== label && display !== modelName) {
        let enginePart = '';
        if (display.startsWith(modelName)) {
          enginePart = display.slice(modelName.length).replace(/^[\s\-–—]+/, '').trim();
        } else if (display.includes(' - ')) {
          const idx = display.indexOf(' - ');
          const prefix = display.slice(0, idx).trim();
          if (prefix === modelName || label.endsWith(prefix)) {
            enginePart = display.slice(idx + 3).trim();
          }
        }
        if (enginePart) {
          label = `${label} · ${enginePart}`;
        }
      }
    }

    return label;
  });

  ymmeSelectionHint = computed(() => {
    if (this.hasCompleteYmme()) return 'Tap to change';
    if (this.ymmeSelectionLabel()) return 'Continue selection';
    return 'Year · Make · Model';
  });

  hasCompleteYmme = computed(() => {
    return !!(
      this.selectedVehicle() ||
      (this.selectedYear() && this.selectedMake() && this.selectedModel())
    );
  });

  /** Normalized year list from the last `/api/db/years` or `/api/years` response. */
  yearsList = computed(() => normalizeYearList(this.years()?.body));

  yearsLoaded = computed(() => this.years() !== null);

  yearDecades = computed(() => {
    const decades = new Set<number>();
    for (const y of this.yearsList()) {
      decades.add(Math.floor(y / 10) * 10);
    }
    return [...decades].sort((a, b) => b - a);
  });

  yearsInSelectedDecade = computed(() => {
    const decade = this.selectedDecade();
    if (decade == null) return [];
    return this.yearsList().filter((y) => y >= decade && y < decade + 10);
  });

  /** Options shown in the wizard (decades, chunked lists, or filtered). */
  wizardListSuggestions = computed<Suggestion[]>(() => {
    const step = this.searchStep();
    const term = this.searchTerm().trim().toLowerCase();

    if (step === 'Year' && !term) {
      if (this.yearPickerMode() === 'decade') {
        return this.yearDecades().map((d) => ({
          type: 'Decade' as const,
          value: d,
          display: `${d}s`,
        }));
      }
      const years =
        this.selectedDecade() != null
          ? this.yearsInSelectedDecade()
          : this.yearsList();
      return years.map((y) => ({ type: 'Year' as const, value: y, display: String(y) }));
    }

    return this.suggestions();
  });

  wizardVisibleSuggestions = computed(() => {
    const all = this.wizardListSuggestions();
    const term = this.searchTerm().trim();
    if (term) return all;
    // Decades (≤15) and years-per-decade (≤10) are small — never truncate or 2010/2011 vanish.
    if (this.searchStep() === 'Year') return all;
    return all.slice(0, this.wizardListLimit());
  });

  wizardHiddenCount = computed(() => {
    const all = this.wizardListSuggestions();
    const term = this.searchTerm().trim();
    if (term) return 0;
    if (this.searchStep() === 'Year') return 0;
    return Math.max(0, all.length - this.wizardListLimit());
  });

  wizardShowDecadeGrid = computed(
    () => this.searchStep() === 'Year' && this.yearPickerMode() === 'decade' && !this.searchTerm().trim()
  );

  wizardShowYearGrid = computed(
    () => this.searchStep() === 'Year' && this.yearPickerMode() === 'year' && !this.searchTerm().trim()
  );

  readonly ymmeFlow: Array<'Year' | 'Make' | 'Model' | 'Engine'> = ['Year', 'Make', 'Model', 'Engine'];

  ymmeStepPills = computed(() => {
    const current = this.searchStep();
    const currentIdx = this.ymmeFlow.indexOf(current);
    return this.ymmeFlow.map((step, idx) => ({
      step,
      label: step,
      done: idx < currentIdx,
      active: step === current,
      upcoming: idx > currentIdx,
    }));
  });

  searchStep = computed<'Year' | 'Make' | 'Model' | 'Engine'>(() => {
    if (!this.selectedYear()) return 'Year';
    if (!this.selectedMake()) return 'Make';
    if (!this.selectedModel()) return 'Model';
    // Show Engine step only when there are 2+ engines to choose from.
    // For single-engine models we auto-select in selectSuggestion(); for 0
    // engines the model alone resolves the vehicle.
    const model = this.selectedModel();
    const modelEngineCount = model?.engines?.length ?? 0;
    const signalEngineCount = this.engines().length;
    const engineCount = Math.max(modelEngineCount, signalEngineCount);
    if (engineCount >= 2) return 'Engine';
    return 'Model';
  });

  isVin = computed(() => {
    const term = this.searchTerm().trim();
    return term.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/i.test(term);
  });

  isPartialVin = computed(() => {
    const term = this.searchTerm().trim();
    return term.length >= 10 && term.length < 17 && /^[A-HJ-NPR-Z0-9]+$/i.test(term);
  });

  currentPlaceholder = computed(() => {
    if (this.selectedVehicle()) return this.selectedVehicle()?.displayName;
    if (this.isVin()) return 'Searching by VIN...';
    switch (this.searchStep()) {
      case 'Year': return 'Enter VIN or Year...';
      case 'Make': return 'Select Make...';
      case 'Model': return 'Select Model...';
      case 'Engine': return 'Select Engine (Optional)...';
    }
  });

  suggestions = computed<Suggestion[]>(() => {
    const step = this.searchStep();
    const term = this.searchTerm().toLowerCase().trim();

    if (step === 'Year') {
      const yearsData = this.yearsList();
      if (!yearsData.length) return [];
      if (!term) return yearsData.map(y => ({ type: 'Year', value: y, display: y.toString() }));
      return yearsData.filter(y => y.toString().startsWith(term)).map(y => ({ type: 'Year', value: y, display: y.toString() }));
    }

    if (step === 'Make') {
      const makesData = this.makes();
      if (!Array.isArray(makesData)) return [];

      const sortedMakes = [...makesData].sort((a, b) => {
        const nameA = a?.makeName || '';
        const nameB = b?.makeName || '';
        return nameA.localeCompare(nameB);
      });

      if (!term) return sortedMakes.map(m => ({ type: 'Make', value: m, display: m.makeName || 'Unknown Make' }));
      return sortedMakes
        .filter(m => (m.makeName || '').toLowerCase().includes(term))
        .map(m => ({ type: 'Make', value: m, display: m.makeName || 'Unknown Make' }));
    }

    if (step === 'Model') {
      const modelsData = this.models();
      let filtered = modelsData;
      if (term) {
        filtered = modelsData.filter(m => m.model.toLowerCase().includes(term));
      }

      return filtered.map(m => ({
        type: 'Model',
        value: m,
        display: m.model
      }));
    }

    if (step === 'Engine') {
      const enginesData = this.engines();
      if (!Array.isArray(enginesData) || enginesData.length === 0) {
        return [];
      }
      let filtered = enginesData;
      if (term) {
        filtered = enginesData.filter(e => (e.name || '').toLowerCase().includes(term));
      }
      return filtered.map(e => ({
        type: 'Engine',
        value: {
          // Composite vehicleId: baseVehicleId:engineId — matches articles.vehicle_id format.
          // Must use baseVehicleId (globally unique), NOT model.id (unique only per year/make).
          vehicleId: String(e.id).includes(':') ? String(e.id) : `${this.modelRoutingId(this.selectedModel())}:${e.id}`,
          displayName: `${this.selectedModel()?.model || 'Vehicle'} - ${e.name || 'Unknown Engine'}`
        },
        display: e.name || 'Unknown Engine'
      }));
    }

    return [];
  });

  onVinInput(value: string): void {
    this.searchInput.set(value);
    this.searchSubject.next(value);
    if (this.showSuggestions()) {
      this.closeYmmeWizard();
    }
  }

  onWizardFilterInput(value: string): void {
    this.searchInput.set(value);
    this.searchSubject.next(value);
    this.resetWizardListLimit();
    if (this.searchStep() === 'Year' && value.trim()) {
      this.yearPickerMode.set('year');
    }
    if (this.searchStep() === 'Year' && /^\d{4}\s+/.test(value)) {
      this.processFullVehicleString(value);
    }
  }

  openYmmeWizard(): void {
    if (this.isVin()) return;
    this.errorMessage.set(null);
    this.wizardSlideBack.set(false);
    this.resetWizardListLimit();
    this.searchInput.set('');
    this.searchTerm.set('');
    this.searchSubject.next('');
    this.yearPickerMode.set(this.selectedYear() ? 'year' : 'decade');
    this.selectedDecade.set(null);
    this.wizardPhase.set(this.hasCompleteYmme() ? 'confirm' : 'pick');
    this.showSuggestions.set(true);
    if (!this.yearsLoaded()) {
      void this.loadYears();
    }
    this.lockBodyScroll(true);
    queueMicrotask(() => this.focusWizardInput());
  }

  confirmVehicleSelection(): void {
    this.closeYmmeWizard();
  }


  expandWizardList(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const total = this.wizardListSuggestions().length;
    this.wizardListLimit.set(total);
  }

  /** Stable @for track — display alone collides when names repeat in Motor data. */
  trackSuggestion(s: Suggestion): string {
    switch (s.type) {
      case 'Decade':
        return `decade-${s.value}`;
      case 'Year':
        return `year-${s.value}`;
      case 'Make':
        return `make-${(s.value as Make).makeId}`;
      case 'Model':
        return `model-${(s.value as Model).id}`;
      case 'Engine':
        return `engine-${(s.value as { vehicleId: string }).vehicleId}`;
    }
  }

  private resetWizardListLimit(): void {
    this.wizardListLimit.set(this.WIZARD_CHUNK);
  }

  editYmmeStep(step: 'Year' | 'Make' | 'Model' | 'Engine'): void {
    this.wizardPhase.set('pick');
    this.wizardSlideBack.set(false);
    this.resetWizardListLimit();
    this.searchInput.set('');
    this.searchTerm.set('');
    this.selectedSuggestionIndex.set(-1);

    if (step === 'Year') {
      this.clearYmmeFrom('Year');
      this.yearPickerMode.set('decade');
      this.selectedDecade.set(null);
    } else if (step === 'Make') {
      this.clearYmmeFrom('Make');
    } else if (step === 'Model') {
      this.clearYmmeFrom('Model');
    } else {
      this.selectedVehicle.set(null);
    }
    queueMicrotask(() => this.focusWizardInput());
  }

  private focusWizardInput(): void {
    if (this.wizardPhase() === 'confirm') return;
    this.ymmePickerRef?.nativeElement?.querySelector<HTMLInputElement>('.ymme-wizard-filter-input')?.focus();
  }

  private clearYmmeFrom(step: 'Year' | 'Make' | 'Model'): void {
    this.selectedVehicle.set(null);
    if (step === 'Year') {
      this.selectedYear.set(null);
      this.selectedMake.set(null);
      this.selectedModel.set(null);
      this.makes.set([]);
      this.models.set([]);
      this.engines.set([]);
      this.currentContentSource.set('MOTOR');
      return;
    }
    if (step === 'Make') {
      this.selectedMake.set(null);
      this.selectedModel.set(null);
      this.models.set([]);
      this.engines.set([]);
      this.currentContentSource.set('MOTOR');
      return;
    }
    this.selectedModel.set(null);
    this.engines.set([]);
  }

  closeYmmeWizard(): void {
    this.showSuggestions.set(false);
    this.selectedSuggestionIndex.set(-1);
    this.wizardPhase.set('pick');
    this.resetWizardListLimit();
    this.lockBodyScroll(false);
  }

  private lockBodyScroll(_lock: boolean): void {
    /* scroll lock handled globally via body.focus-depth-active */
  }

  private ensureWizardOpen(): void {
    this.showSuggestions.set(true);
    this.lockBodyScroll(true);
  }

  private async processFullVehicleString(fullString: string) {
    const parts = fullString.split(' ').filter(p => p.trim());
    if (parts.length < 1) return;

    const yearStr = parts[0];
    const year = parseInt(yearStr);
    const currentYear = new Date().getFullYear();

    // Relaxed validation: Just check if it looks like a valid year range (e.g. 1900 - Next Year)
    if (isNaN(year) || year < 1900 || year > currentYear + 2) return;

    // 1. Set Year
    this.selectedYear.set(year);
    this.isLoading.set(true);

    try {
      // 2. Fetch Makes
      const makesRes = await firstValueFrom(this.motorApi.getMakes(year));
      const makes = makesRes.body;
      this.makes.set(makes);

      // Check if we have more text to match
      const remainingAfterYear = fullString.substring(yearStr.length).trim();
      if (!remainingAfterYear) {
        this.searchInput.set('');
        this.searchSubject.next(''); // Clear subject to prevent race condition
        this.ensureWizardOpen();
        return;
      }

      // 3. Match Make
      // Sort makes by length desc to ensure "Aston Martin" matches before "Aston" if overlapping
      const sortedMakes = [...makes].sort((a, b) => b.makeName.length - a.makeName.length);
      const matchedMake = sortedMakes.find(m => remainingAfterYear.toLowerCase().startsWith(m.makeName.toLowerCase()));

      if (matchedMake) {
        this.selectedMake.set(matchedMake);

        // 4. Fetch Models
        const modelsRes = await firstValueFrom(this.motorApi.getModels(year, matchedMake.makeName));
        const models = modelsRes.body.models;
        this.models.set(models);

        if (modelsRes.body.contentSource) {
          this.currentContentSource.set(modelsRes.body.contentSource);
        }

        const remainingAfterMake = remainingAfterYear.substring(matchedMake.makeName.length).trim();
        if (!remainingAfterMake) {
          this.searchInput.set('');
          this.searchSubject.next('');
          this.ensureWizardOpen();
          return;
        }

        // 5. Match Model
        const sortedModels = [...models].sort((a, b) => b.model.length - a.model.length);
        const matchedModel = sortedModels.find(m => remainingAfterMake.toLowerCase().startsWith(m.model.toLowerCase()));

        if (matchedModel) {
          this.selectedModel.set(matchedModel);
          const mapped = await this.resolveMotorVehicleOptionsForModel(matchedModel);
          if (mapped) {
            this.searchInput.set('');
            this.searchSubject.next('');
            this.ensureWizardOpen();
            return;
          }
          this.searchInput.set('');
          this.searchSubject.next('');
          this.resolveEnginesOrAutoSelect(matchedModel);
        } else {
          // Make selected, passed string is likely a partial search term for model
          this.searchInput.set(remainingAfterMake);
          this.searchTerm.set(remainingAfterMake); // Trigger filter
          this.ensureWizardOpen();
        }

      } else {
        // Year selected, passed string is likely a search term for Make
        this.searchInput.set(remainingAfterYear);
        this.searchTerm.set(remainingAfterYear);
        this.ensureWizardOpen();
      }

    } catch (e) {
      this.logger.error('Smart vehicle parsing failed', e);
      // Fallback: Just stay at whatever step we reached
    } finally {
      this.isLoading.set(false);
    }
  }

  ymmePickerBack(): void {
    this.wizardSlideBack.set(true);
    this.resetWizardListLimit();
    this.searchInput.set('');
    this.searchTerm.set('');

    if (this.wizardPhase() === 'confirm') {
      this.wizardPhase.set('pick');
      return;
    }

    if (this.searchStep() === 'Year' && this.yearPickerMode() === 'year' && this.selectedDecade() != null) {
      this.yearPickerMode.set('decade');
      return;
    }

    if (this.selectedModel()) {
      this.clearYmmeFrom('Model');
    } else if (this.selectedMake()) {
      this.clearYmmeFrom('Make');
      this.yearPickerMode.set('year');
    } else if (this.selectedYear()) {
      this.clearYmmeFrom('Year');
      this.yearPickerMode.set('decade');
      this.selectedDecade.set(null);
    } else {
      this.closeYmmeWizard();
    }
  }

  handleEnterKey(): void {
    if (this.wizardPhase() === 'confirm') {
      this.confirmVehicleSelection();
      return;
    }
    if (this.isVin() || (this.selectedVehicle() && !this.showSuggestions())) {
      this.submitSearch();
      return;
    }
    const currentSuggestions = this.wizardVisibleSuggestions();
    const selectedIndex = this.selectedSuggestionIndex();

    // If a suggestion is highlighted via keyboard, select it
    if (selectedIndex >= 0 && selectedIndex < currentSuggestions.length) {
      this.selectSuggestion(new MouseEvent('mousedown'), currentSuggestions[selectedIndex]);
      this.selectedSuggestionIndex.set(-1);
      return;
    }

    // Otherwise, select first suggestion if available
    if (currentSuggestions.length > 0) {
      this.selectSuggestion(new MouseEvent('mousedown'), currentSuggestions[0]);
    }
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Only handle keyboard navigation when suggestions are visible and input is focused
    if (!this.showSuggestions() || this.isVin() || this.wizardPhase() === 'confirm') {
      return;
    }

    const currentSuggestions = this.wizardVisibleSuggestions();
    if (currentSuggestions.length === 0) return;

    let newIndex = this.selectedSuggestionIndex();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        newIndex = newIndex < currentSuggestions.length - 1 ? newIndex + 1 : 0;
        this.selectedSuggestionIndex.set(newIndex);
        this.scrollToSuggestion(newIndex);
        break;
      case 'ArrowUp':
        event.preventDefault();
        newIndex = newIndex > 0 ? newIndex - 1 : currentSuggestions.length - 1;
        this.selectedSuggestionIndex.set(newIndex);
        this.scrollToSuggestion(newIndex);
        break;
      case 'Escape':
        event.preventDefault();
        this.closeYmmeWizard();
        break;
    }
  }

  private scrollToSuggestion(index: number): void {
    // Scroll the selected suggestion into view
    const container = this.ymmePickerRef?.nativeElement;
    if (!container) return;

    const scrollContainer = container.querySelector('.ymme-picker-body') || container;
    const buttons = scrollContainer.querySelectorAll('button');
    const targetButton = buttons[index];
    if (targetButton) {
      targetButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  handleSpacebar(event: Event): void {
    const currentSuggestions = this.wizardListSuggestions();
    if (currentSuggestions.length === 1 && this.searchTerm().trim() !== '') {
      event.preventDefault();
      this.selectSuggestion(new MouseEvent('mousedown'), currentSuggestions[0]);
    }
  }

  selectSuggestion(event: MouseEvent, suggestion: Suggestion): void {
    event.preventDefault();
    event.stopPropagation();
    this.wizardSlideBack.set(false);
    this.searchInput.set('');
    this.searchTerm.set('');
    this.selectedSuggestionIndex.set(-1);

    this.resetWizardListLimit();

    switch (suggestion.type) {
      case 'Decade':
        this.selectedDecade.set(suggestion.value as number);
        this.yearPickerMode.set('year');
        this.wizardSlideBack.set(false);
        this.resetWizardListLimit();
        break;
      case 'Year':
        this.selectedYear.set(suggestion.value as number);
        this.isLoading.set(true);
        this.ignoreNextDocumentClick = true; // mousedown may trigger focus/blur - keep dropdown open
        this.motorApi.getMakes(suggestion.value as number).subscribe({
          next: (res) => {
            this.makes.set(res.body);
            if (res.header?.statusCode === 200) {
              void this.dataSync.cacheVehicleMetadata(`/year/${suggestion.value as number}/makes`, res);
            }
            this.isLoading.set(false);
            if (res.body && res.body.length > 0) {
              this.ensureWizardOpen();
            }
          },
          error: () => {
            this.isLoading.set(false);
            this.errorMessage.set('Could not load makes.');
            this.closeYmmeWizard();
          }
        });
        break;
      case 'Make':
        this.selectedMake.set(suggestion.value as Make);
        this.isLoading.set(true);
        const year = this.selectedYear();
        if (year) {
          this.motorApi.getModels(year, (suggestion.value as Make).makeName).subscribe({
            next: (res) => {
              this.models.set(res.body.models);
              if (res.header?.statusCode === 200) {
                const makeSeg = encodeURIComponent((suggestion.value as Make).makeName);
                void this.dataSync.cacheVehicleMetadata(`/year/${year}/make/${makeSeg}/models`, res);
              }
              // Capture the content source from the response
              if (res.body.contentSource) {
                this.currentContentSource.set(res.body.contentSource);
              }
              this.isLoading.set(false);
              // Show suggestions after models are loaded
              if (res.body.models && res.body.models.length > 0) {
                this.ensureWizardOpen();
              }
            },
            error: (err) => {
              this.logger.error('Error loading models:', err);
              this.isLoading.set(false);
              this.errorMessage.set('Could not load models.');
              this.closeYmmeWizard();
            }
          });
        }
        break;
      case 'Model':
        const model = suggestion.value as Model;
        this.selectedModel.set(model);
        this.resolveMotorVehicleOptionsForModel(model).then((mapped) => {
          if (mapped) {
            this.ensureWizardOpen();
            return;
          }
          this.resolveEnginesOrAutoSelect(model);
        }).catch(() => {
          this.resolveEnginesOrAutoSelect(model);
        });
        break;
      case 'Engine':
        const selectedEngine = suggestion.value as { vehicleId: string; displayName: string };
        this.selectedVehicle.set(selectedEngine);
        this.wizardPhase.set('confirm');
        this.ensureWizardOpen();
        this.cdr.detectChanges();
        break;
    }
  }

  removeSelection(event: MouseEvent, step: 'Year' | 'Make' | 'Model' | 'Engine'): void {
    event.preventDefault();
    event.stopPropagation();
    this.errorMessage.set(null);
    this.selectedVehicle.set(null);

    if (step === 'Year') {
      this.selectedYear.set(null);
      this.selectedMake.set(null);
      this.selectedModel.set(null);
      this.makes.set([]);
      this.models.set([]);
      this.engines.set([]);
      this.currentContentSource.set('MOTOR'); // Reset to default
    }
    if (step === 'Make') {
      this.selectedMake.set(null);
      this.selectedModel.set(null);
      this.models.set([]);
      this.engines.set([]);
      this.currentContentSource.set('MOTOR'); // Reset to default
    }
    if (step === 'Model') {
      this.selectedModel.set(null);
      this.engines.set([]);
    }
    // If step === 'Engine', we just cleared selectedVehicle (done above), so we stay at Model step with engines list open.

    if (this.showSuggestions()) {
      this.wizardSlideBack.set(true);
    }
  }

  clearAllSelections(): void {
    this.searchInput.set('');
    this.searchTerm.set('');
    this.selectedYear.set(null);
    this.selectedMake.set(null);
    this.selectedVehicle.set(null);
    this.makes.set([]);
    this.models.set([]);
    this.errorMessage.set(null);
    this.closeYmmeWizard();
  }

  submitSearch(): void {
    if (this.isVin()) this.searchByVin();
    else this.selectVehicle();
  }

  private searchByVin(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.motorApi.decodeVin(this.searchTerm()).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        // OpenAPI spec returns: { vin, vehicleId, contentSource?, year?, make?, model? }
        const { vehicleId, contentSource = 'MOTOR' } = res.body;
        this.prefetchVehicleReferenceData(contentSource, vehicleId, this.searchTerm().toUpperCase());
        this.router.navigate(['/vehicle', contentSource, vehicleId]);
      },
      error: () => { this.isLoading.set(false); this.errorMessage.set('Could not find a vehicle with that VIN.'); }
    });
  }

  private selectVehicle(): void {
    let vehicle = this.selectedVehicle();

    // If no vehicle selected but model is selected, use model as vehicle (implicit engine selection)
    if (!vehicle && this.selectedModel()) {
      const model = this.selectedModel()!;
      vehicle = { vehicleId: model.id, displayName: model.model };
    }

    if (vehicle) {
      const persisted = this.buildPersistedVehicle(vehicle);
      this.persistence.saveVehicle(persisted);
      this.persistedVehicle.set(persisted);
      this.isLoading.set(true);
      this.prefetchVehicleReferenceData(this.currentContentSource(), vehicle.vehicleId, vehicle.displayName);
      this.router.navigate(['/vehicle', this.currentContentSource(), vehicle.vehicleId]);
    } else {
      this.errorMessage.set('Please select a complete vehicle.');
    }
  }

  /**
   * Kick off catalog/specs/parts/maintenance sync the moment a vehicle is chosen,
   * so the dashboard renders against warm data instead of waiting for its own
   * effect to fire. Safe to call multiple times — DataSync guards against
   * duplicate work per vehicle.
   */
  private prefetchVehicleReferenceData(contentSource: string, vehicleId: string, vehicleName: string): void {
    void (async () => {
      try {
        await this.dataSync.ensureVehicleRecord(contentSource, vehicleId, vehicleName || 'Vehicle');
        await this.dataSync.eagerSyncVehicleReferenceData(contentSource, vehicleId);
      } catch (err) {
        this.logger.warn('[Home] Vehicle prefetch failed (non-fatal):', err);
      }
    })();
  }

  /**
   * Resolve OEM model id to MOTOR engine ids during YMME selection.
   * Prevents a second "orientation" modal after navigation.
   */
  /**
   * After a model is picked, decide whether to render the engine step.
   * Skipped entirely when the model has 0 or 1 engine — 86% of models have
   * a single engine, and forcing a dropdown there is pure friction.
   */
  private resolveEnginesOrAutoSelect(model: Model): void {
    const engines = model.engines || [];
    if (engines.length >= 2) {
      this.engines.set(engines);
      this.ensureWizardOpen();
      return;
    }
    const onlyEngine = engines[0];
    // Build composite vehicleId: baseVehicleId:engineId — matches articles.vehicle_id DB format.
    // Use baseVehicleId (globally unique), NOT model.id (unique only per year/make).
    const routingId = this.modelRoutingId(model);
    const vehicleId = onlyEngine
      ? (String(onlyEngine.id).includes(':') ? String(onlyEngine.id) : `${routingId}:${onlyEngine.id}`)
      : routingId;
    const displayName = onlyEngine
      ? `${model.model} - ${onlyEngine.name}`
      : model.model;
    this.engines.set([]);
    this.selectedVehicle.set({ vehicleId, displayName });
    this.wizardPhase.set('confirm');
    this.ensureWizardOpen();
  }

  /**
   * The id to use as the first segment of a composite route key. Motor's
   * globally-unique `baseVehicleId` when present; otherwise `model.id` (only
   * unique per year/make — last resort for sources that don't supply a base id).
   */
  private modelRoutingId(model: Model | null | undefined): string {
    const base = model?.baseVehicleId;
    if (base != null && String(base).trim() !== '') return String(base);
    return String(model?.id ?? '');
  }

  private async resolveMotorVehicleOptionsForModel(model: Model): Promise<boolean> {
    const source = this.currentContentSource();
    const isMotorSource = !source || source.toUpperCase() === 'MOTOR';
    // For MOTOR source: only call motorvehicles if model has no engines (DB cache may strip them).
    // Non-MOTOR sources always need motorvehicles to get the composite Motor vehicle ID.
    if (isMotorSource && (model.engines?.length ?? 0) > 0) {
      return false;
    }
    if (this.motorVehicleMappingInFlight) {
      return false;
    }
    this.motorVehicleMappingInFlight = true;
    this.isLoading.set(true);
    try {
      const lookupSource = isMotorSource ? 'MOTOR' : source;
      const res = await firstValueFrom(this.motorApi.getMotorVehicles(lookupSource, model.id));
      const mappings = Array.isArray(res?.body) ? res.body : [];
      const options: Engine[] = mappings.flatMap((mapping: any) =>
        Array.isArray(mapping?.engines)
          ? mapping.engines
            .filter((engine: any) => !!engine?.id)
            .map((engine: any) => ({
              id: String(engine.id),
              name: `${mapping?.model || model.model} - ${engine?.name || 'Engine'}`
            }))
          : []
      );
      if (options.length === 0) {
        return false;
      }
      this.currentContentSource.set('MOTOR');
      this.engines.set(options);
      return true;
    } catch (err) {
      this.logger.warn('[Home] MOTOR vehicle mapping failed during YMME, falling back to model engines', err);
      return false;
    } finally {
      this.motorVehicleMappingInFlight = false;
      this.isLoading.set(false);
    }
  }

  /** YMME + engine id for Motor Information API (`/fluids`) — see `vehapiproxi/MOTOR_INFORMATION_API.md`. */
  private buildPersistedVehicle(vehicle: { vehicleId: string; displayName: string }): PersistedVehicle {
    const year = this.selectedYear() ?? undefined;
    const make = this.selectedMake();
    const model = this.selectedModel();
    const motorEngineId = this.engines().find((e) => e.id === vehicle.vehicleId)?.id;
    return {
      vehicleId: vehicle.vehicleId,
      contentSource: this.currentContentSource(),
      name: vehicle.displayName,
      year,
      makeName: make?.makeName,
      modelName: model?.model,
      motorEngineId: motorEngineId ?? undefined
    };
  }

  // --- Persistence Methods ---
  continueToVehicle(): void {
    const vehicle = this.persistedVehicle();
    if (vehicle) {
      this.prefetchVehicleReferenceData(vehicle.contentSource, vehicle.vehicleId, vehicle.name);
      this.router.navigate(['/vehicle', vehicle.contentSource, vehicle.vehicleId]);
    }
  }

  startNewSearch(): void {
    this.persistence.clearVehicle();
    this.persistedVehicle.set(null);
  }
  closeMobileWizard(): void {
    this.ymmePickerBack();
  }

  private registerHomeCommands(): void {
    const persisted = this.persistedVehicle();
    const items: CommandPaletteItem[] = [
      {
        id: 'focus-search',
        label: 'Find a vehicle',
        group: 'Actions',
        keywords: 'year make model search ymme',
        run: () => this.openYmmeWizard(),
      },
      {
        id: 'credits',
        label: 'Account & credits',
        group: 'Navigate',
        run: () => void this.router.navigate(['/credits']),
      },
    ];

    if (persisted?.vehicleId) {
      items.unshift({
        id: 'continue-vehicle',
        label: `Continue with ${persisted.name}`,
        group: 'Vehicle',
        hint: persisted.vehicleId,
        run: () => this.continueToVehicle(),
      });
    }

    this.commandPalette.setItems(items, 'Search Torque…');
  }
}
