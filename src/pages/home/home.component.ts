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

type Suggestion =
  | { type: 'Year'; value: number; display: string }
  | { type: 'Make'; value: Make; display: string }
  | { type: 'Model'; value: Model; display: string }
  | { type: 'Engine'; value: { vehicleId: string; displayName: string }; display: string };

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, LogoComponent, RouterModule, LucideAngularModule, ThemeToggleComponent],
})
export class HomeComponent implements OnInit {
  readonly icons = { Search, X, ArrowRight, ArrowUpRight, ArrowLeft };
  private motorApi = inject(MotorApiService);
  private persistence = inject(VehiclePersistenceService);
  private dataSync = inject(DataSyncService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);

  constructor() { }

  @ViewChild('searchInputRef') searchInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('desktopSuggestionsContainer') desktopSuggestionsContainerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('searchContainer') searchContainerRef!: ElementRef<HTMLDivElement>;

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
  /** Ignore the next document click - prevents closing dropdown when same click triggers focus */
  private ignoreNextDocumentClick = false;
  viewportHeight = signal<number>(0);
  private baseViewportHeight = signal<number>(0);
  selectedSuggestionIndex = signal<number>(-1); // For keyboard navigation

  ngOnInit(): void {
    void this.loadYears();
    this.persistedVehicle.set(this.persistence.getVehicle());

    this.searchSubject.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef) // Prevents memory leak
    ).subscribe(term => {
      this.searchTerm.set(term);
    });

    // Track viewport height for mobile keyboard detection
    this.updateViewportHeight();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        this.updateViewportHeight();
        if (this.showSuggestions()) {
          this.calculateDropdownPosition();
        }
      });
      window.addEventListener('scroll', () => {
        if (this.showSuggestions()) {
          this.calculateDropdownPosition();
        }
      }, true);
      window.addEventListener('orientationchange', () => {
        setTimeout(() => {
          this.updateViewportHeight();
          if (this.showSuggestions()) {
            this.calculateDropdownPosition();
          }
        }, 100);
      });
      // Use visual viewport API if available (better for mobile keyboards)
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
          this.updateViewportHeight();
          if (this.showSuggestions()) {
            this.calculateDropdownPosition();
          }
        });
        window.visualViewport.addEventListener('scroll', () => {
          this.updateViewportHeight();
          if (this.showSuggestions()) {
            this.calculateDropdownPosition();
          }
        });
      }
    }
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
      console.error('Failed to load years:', error);
      console.error('Error details:', {
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



  // Determine if dropdown should appear above or below input
  dropdownPosition = signal<'above' | 'below'>('below');
  dropdownMaxHeight = signal<number | null>(null);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.ignoreNextDocumentClick) {
      this.ignoreNextDocumentClick = false;
      return;
    }
    if (this.showSuggestions()) {
      const clickedInsideInput = this.searchInputRef?.nativeElement?.contains(event.target as Node);
      const clickedInsideSuggestions = this.desktopSuggestionsContainerRef?.nativeElement?.contains(event.target as Node);
      const clickedInsideContainer = this.searchContainerRef?.nativeElement?.contains(event.target as Node);

      if (!clickedInsideInput && !clickedInsideSuggestions && !clickedInsideContainer) {
        this.showSuggestions.set(false);
      }
    }
  }

  searchStep = computed<'Year' | 'Make' | 'Model' | 'Engine'>(() => {
    if (!this.selectedYear()) return 'Year';
    if (!this.selectedMake()) return 'Make';
    if (!this.selectedModel()) return 'Model';
    // Only show Engine step if there are actually engines available
    // Check both the engines signal and the model's engines property
    const model = this.selectedModel();
    const hasEngines = (model?.engines && model.engines.length > 0) || this.engines().length > 0;
    if (hasEngines) return 'Engine';
    // If no engines, we're done - return Model to prevent showing engine step
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
      const yearsResponse = this.years();
      if (!yearsResponse || !yearsResponse.body) {
        return [];
      }
      const yearsData = yearsResponse.body.sort((a, b) => b - a);
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
        value: { vehicleId: e.id, displayName: `${this.selectedModel()?.model || 'Vehicle'} - ${e.name || 'Unknown Engine'}` },
        display: e.name || 'Unknown Engine'
      }));
    }

    return [];
  });

  onSearchInput(value: string): void {
    this.searchInput.set(value);
    this.searchSubject.next(value);

    // Show suggestions when user starts typing (if not already showing and conditions are met)
    if (!this.showSuggestions() && !this.selectedVehicle() && !this.isVin()) {
      this.showSuggestions.set(true);
    }

    // Recalculate position when typing
    if (this.showSuggestions()) {
      setTimeout(() => this.calculateDropdownPosition(), 50);
    }

    // Smart Input Handling: If input starts with Year + Space (e.g. "2011 Ford"), try to auto-parse
    if (this.searchStep() === 'Year' && /^\d{4}\s+/.test(value)) {
      this.processFullVehicleString(value);
    }
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
        this.showSuggestions.set(true); // Show all makes
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
          this.showSuggestions.set(true); // Show all models
          return;
        }

        // 5. Match Model
        const sortedModels = [...models].sort((a, b) => b.model.length - a.model.length);
        const matchedModel = sortedModels.find(m => remainingAfterMake.toLowerCase().startsWith(m.model.toLowerCase()));

        if (matchedModel) {
          this.selectedModel.set(matchedModel);

          // Check engines
          if (matchedModel.engines && matchedModel.engines.length > 0) {
            this.engines.set(matchedModel.engines);
            this.searchInput.set(''); // Clear input to show engines
            this.searchSubject.next('');
            this.showSuggestions.set(true);
          } else {
            // Done - Select Vehicle
            this.selectedVehicle.set({ vehicleId: matchedModel.id, displayName: matchedModel.model });
            this.searchInput.set('');
            this.searchSubject.next('');
            this.showSuggestions.set(false);
          }
        } else {
          // Make selected, passed string is likely a partial search term for model
          this.searchInput.set(remainingAfterMake);
          this.searchTerm.set(remainingAfterMake); // Trigger filter
          this.showSuggestions.set(true);
        }

      } else {
        // Year selected, passed string is likely a search term for Make
        this.searchInput.set(remainingAfterYear);
        this.searchTerm.set(remainingAfterYear);
        this.showSuggestions.set(true);
      }

    } catch (e) {
      console.error('Smart vehicle parsing failed', e);
      // Fallback: Just stay at whatever step we reached
    } finally {
      this.isLoading.set(false);
    }
  }

  onSearchFocus(): void {
    if (this.selectedVehicle()) return;
    this.errorMessage.set(null);
    this.ignoreNextDocumentClick = true; // Same click that focused will bubble to document - don't close
    this.showSuggestions.set(true);
    setTimeout(() => {
      this.updateViewportHeight();
      this.calculateDropdownPosition();
    }, 50);
  }

  private calculateDropdownPosition(): void {
    if (typeof window === 'undefined') return;

    const input = this.searchInputRef?.nativeElement;
    if (!input) return;

    const inputRect = input.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - inputRect.bottom;
    const spaceAbove = inputRect.top;
    const minSpaceNeeded = 300; // Minimum space for dropdown (adjust as needed)

    // Calculate max height based on available space
    if (spaceBelow >= minSpaceNeeded) {
      // Enough space below, position below
      this.dropdownPosition.set('below');
      this.dropdownMaxHeight.set(Math.min(spaceBelow - 16, 400)); // 16px for margin
    } else if (spaceAbove >= minSpaceNeeded) {
      // Not enough space below, but enough above, position above
      this.dropdownPosition.set('above');
      this.dropdownMaxHeight.set(Math.min(spaceAbove - 16, 400));
    } else {
      // Limited space, use available space (prefer below)
      this.dropdownPosition.set(spaceBelow > spaceAbove ? 'below' : 'above');
      const availableSpace = Math.max(spaceBelow, spaceAbove) - 16;
      this.dropdownMaxHeight.set(Math.max(availableSpace, 200)); // Minimum 200px
    }
  }

  handleEnterKey(): void {
    if (this.isVin() || this.selectedVehicle()) { this.submitSearch(); return; }
    const currentSuggestions = this.suggestions();
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
    if (!this.showSuggestions() || this.selectedVehicle() || this.isVin()) {
      return;
    }

    const currentSuggestions = this.suggestions();
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
        this.showSuggestions.set(false);
        this.selectedSuggestionIndex.set(-1);
        break;
    }
  }

  private scrollToSuggestion(index: number): void {
    // Scroll the selected suggestion into view
    const container = this.desktopSuggestionsContainerRef?.nativeElement;
    if (!container) return;

    // Find the scrollable container (might be nested)
    const scrollContainer = container.querySelector('.overflow-y-auto') || container;
    const buttons = scrollContainer.querySelectorAll('button');
    const targetButton = buttons[index];
    if (targetButton) {
      targetButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  handleSpacebar(event: Event): void {
    const currentSuggestions = this.suggestions();
    if (currentSuggestions.length === 1 && this.searchTerm().trim() !== '') {
      event.preventDefault();
      this.selectSuggestion(new MouseEvent('mousedown'), currentSuggestions[0]);
    }
  }

  selectSuggestion(event: MouseEvent, suggestion: Suggestion): void {
    event.preventDefault();
    event.stopPropagation();
    this.searchInput.set('');
    this.searchTerm.set('');
    this.selectedSuggestionIndex.set(-1); // Reset keyboard selection

    switch (suggestion.type) {
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
              this.showSuggestions.set(true);
            }
          },
          error: () => {
            this.isLoading.set(false);
            this.errorMessage.set('Could not load makes.');
            this.showSuggestions.set(false);
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
                this.showSuggestions.set(true);
              }
            },
            error: (err) => {
              console.error('Error loading models:', err);
              this.isLoading.set(false);
              this.errorMessage.set('Could not load models.');
              this.showSuggestions.set(false);
            }
          });
        }
        break;
      case 'Model':
        const model = suggestion.value as Model;
        this.selectedModel.set(model);

        // Check for engines
        if (model.engines && model.engines.length > 0) {
          this.engines.set(model.engines);
          // Show suggestions immediately since engines are already in the model
          this.showSuggestions.set(true);
        } else {
          // No engines, auto-select the model
          this.selectedVehicle.set({ vehicleId: model.id, displayName: model.model });
          this.showSuggestions.set(false);
          // Auto-advance if on mobile since there is no continue button in wizard
          if (this.isMobile()) {
            this.submitSearch();
          }
        }
        break;
      case 'Engine':
        const selectedEngine = suggestion.value as { vehicleId: string; displayName: string };
        this.selectedVehicle.set(selectedEngine);
        this.showSuggestions.set(false);
        // Force change detection to update UI immediately
        this.cdr.detectChanges();
        // Auto-advance if on mobile since there is no continue button in wizard
        if (this.isMobile()) {
          this.submitSearch();
        }
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

    // Show suggestions after clearing selection
    this.showSuggestions.set(true);
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
    this.showSuggestions.set(false);
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
      this.router.navigate(['/vehicle', this.currentContentSource(), vehicle.vehicleId]);
    } else {
      this.errorMessage.set('Please select a complete vehicle.');
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
      this.router.navigate(['/vehicle', vehicle.contentSource, vehicle.vehicleId]);
    }
  }

  startNewSearch(): void {
    this.persistence.clearVehicle();
    this.persistedVehicle.set(null);
  }
  onMobileSearchTrigger(): void {
    // Unconditionally show suggestions - removed isMobile() check
    this.showSuggestions.set(true);

    // CRITICAL FIX: Force Angular to detect the change
    // Signals should trigger change detection automatically, but seems to fail on mobile
    this.cdr.detectChanges();
  }

  closeMobileWizard(): void {
    // Go back one step in the selection hierarchy, or close wizard if at top level
    if (this.selectedModel()) {
      this.removeSelection(new MouseEvent('click'), 'Model');
    } else if (this.selectedMake()) {
      this.removeSelection(new MouseEvent('click'), 'Make');
    } else if (this.selectedYear()) {
      this.removeSelection(new MouseEvent('click'), 'Year');
    } else {
      this.showSuggestions.set(false);
    }
  }
}
