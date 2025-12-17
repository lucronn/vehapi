import { ChangeDetectionStrategy, Component, computed, inject, signal, ElementRef, HostListener, ViewChild, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { forkJoin, map, of, switchMap, Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import { MotorApiService } from '../../services/motor-api.service';
import { GeminiService } from '../../services/gemini.service';
import { VehiclePersistenceService } from '../../services/vehicle-persistence.service';
import { LogoComponent } from '../../components/logo/logo.component';
import { Make, Model, Engine, PersistedVehicle, Article, ComparisonResult } from '../../models/motor.models';

type Suggestion =
  | { type: 'Year'; value: number; display: string }
  | { type: 'Make'; value: Make; display: string }
  | { type: 'Model'; value: Model; display: string }
  | { type: 'Engine'; value: { vehicleId: string; displayName: string }; display: string }
  | { type: 'Unsure'; value: 'unsure'; display: string };

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, LogoComponent, RouterModule],
})
export class HomeComponent implements OnInit {
  private motorApi = inject(MotorApiService);
  private geminiApi = inject(GeminiService);
  private persistence = inject(VehiclePersistenceService);
  private router = inject(Router);

  @ViewChild('searchInputRef') searchInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('suggestionsContainer') suggestionsContainerRef!: ElementRef<HTMLDivElement>;

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
  private years = toSignal(this.motorApi.getYears(), { initialValue: null });
  private makes = signal<Make[]>([]);
  private models = signal<Model[]>([]);
  private engines = signal<Engine[]>([]); // Available engines for selected model
  persistedVehicle = signal<PersistedVehicle | null>(null);

  // UI State
  isLoading = signal(false);
  errorMessage = signal<string | null>(null);
  showSuggestions = signal(false);

  // "Unsure" AI Mode State
  unsureModeActive = signal(false);
  aiQuery = signal('');
  aiResponse = signal(''); // Keep for generic messages? Or deprecate?
  comparisonResults = signal<ComparisonResult[]>([]); // New structured results
  isAiLoading = signal(false);
  intentDescription = signal<string>(''); // To show user "Searching for: [Optimized Term]"

  ngOnInit(): void {
    this.persistedVehicle.set(this.persistence.getVehicle());

    this.searchSubject.pipe(
      debounceTime(500),
      distinctUntilChanged()
    ).subscribe(term => {
      this.searchTerm.set(term);
    });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.showSuggestions()) {
      const clickedInsideInput = this.searchInputRef?.nativeElement.contains(event.target as Node);
      const clickedInsideSuggestions = this.suggestionsContainerRef?.nativeElement.contains(event.target as Node);
      if (!clickedInsideInput && !clickedInsideSuggestions) {
        this.showSuggestions.set(false);
      }
    }
  }

  searchStep = computed<'Year' | 'Make' | 'Model' | 'Engine'>(() => {
    if (!this.selectedYear()) return 'Year';
    if (!this.selectedMake()) return 'Make';
    if (!this.selectedModel()) return 'Model';
    return 'Engine';
  });

  isVin = computed(() => this.searchTerm().length > 10 && /^[A-HJ-NPR-Z0-9]{17}$/i.test(this.searchTerm()));

  currentPlaceholder = computed(() => {
    if (this.unsureModeActive()) return 'e.g., "brake pad part numbers" or "oil capacity"';
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
      const yearsData = this.years()?.body.sort((a, b) => b - a) ?? [];
      if (!term) return yearsData.map(y => ({ type: 'Year', value: y, display: y.toString() }));
      return yearsData.filter(y => y.toString().startsWith(term)).map(y => ({ type: 'Year', value: y, display: y.toString() }));
    }

    if (step === 'Make') {
      const makesData = this.makes().sort((a, b) => a.makeName.localeCompare(b.makeName));
      if (!term) return makesData.map(m => ({ type: 'Make', value: m, display: m.makeName }));
      return makesData.filter(m => m.makeName.toLowerCase().includes(term)).map(m => ({ type: 'Make', value: m, display: m.makeName }));
    }

    if (step === 'Model') {
      const modelsData = this.models();
      let filtered = modelsData;
      if (term) {
        filtered = modelsData.filter(m => m.model.toLowerCase().includes(term));
      }

      const modelSuggestions: Suggestion[] = filtered.map(m => ({
        type: 'Model',
        value: m,
        display: m.model
      }));

      // Add "Unsure" option if not searching
      if (!term) {
        modelSuggestions.unshift({ type: 'Unsure', value: 'unsure', display: 'Unsure of your exact model? Click here.' });
      }
      return modelSuggestions;
    }

    if (step === 'Engine') {
      const enginesData = this.engines();
      let filtered = enginesData;
      if (term) {
        filtered = enginesData.filter(e => e.name.toLowerCase().includes(term));
      }
      return filtered.map(e => ({
        type: 'Engine',
        value: { vehicleId: e.id, displayName: `${this.selectedModel()?.model} - ${e.name}` },
        display: e.name
      }));
    }

    return [];
  });

  onSearchInput(value: string): void {
    this.searchInput.set(value);
    this.searchSubject.next(value);
  }

  onSearchFocus(): void {
    if (this.unsureModeActive()) return;
    this.errorMessage.set(null);
    this.showSuggestions.set(true);
  }

  handleEnterKey(): void {
    if (this.isVin() || this.selectedVehicle()) { this.submitSearch(); return; }
    // If we are at Engine step and user hits enter without selecting, maybe select the first one OR default to model base?
    // For now, let's select first suggestion if available.
    const currentSuggestions = this.suggestions();
    if (currentSuggestions.length > 0) { this.selectSuggestion(new MouseEvent('mousedown'), currentSuggestions[0]); }
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
    this.searchInput.set('');
    this.searchTerm.set('');

    if (suggestion.type === 'Unsure') {
      this.unsureModeActive.set(true);
      this.showSuggestions.set(false);
      return;
    }

    switch (suggestion.type) {
      case 'Year':
        this.selectedYear.set(suggestion.value as number);
        this.isLoading.set(true);
        this.motorApi.getMakes(suggestion.value as number).subscribe({
          next: (res) => { this.makes.set(res.body); this.isLoading.set(false); this.showSuggestions.set(true); },
          error: () => { this.isLoading.set(false); this.errorMessage.set('Could not load makes.'); this.showSuggestions.set(false); }
        });
        break;
      case 'Make':
        this.selectedMake.set(suggestion.value as Make);
        console.log('Selected Make:', suggestion.value);
        this.isLoading.set(true);
        const year = this.selectedYear();
        if (year) {
          console.log(`Fetching models for Year: ${year}, Make: ${(suggestion.value as Make).makeName}`);
          this.motorApi.getModels(year, (suggestion.value as Make).makeName).subscribe({
            next: (res) => {
              console.log('Models loaded:', res.body.models);
              this.models.set(res.body.models);
              // Capture the content source from the response
              if (res.body.contentSource) {
                this.currentContentSource.set(res.body.contentSource);
                console.log('Updated Content Source:', res.body.contentSource);
              }
              this.isLoading.set(false);
              this.showSuggestions.set(true);
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
          this.showSuggestions.set(true); // Show engines
        } else {
          // No engines, auto-select the model
          this.selectedVehicle.set({ vehicleId: model.id, displayName: model.model });
          this.showSuggestions.set(false);
        }
        break;
      case 'Engine':
        this.selectedVehicle.set(suggestion.value as { vehicleId: string; displayName: string });
        this.showSuggestions.set(false);
        break;
    }
  }

  removeSelection(event: MouseEvent, step: 'Year' | 'Make' | 'Model' | 'Engine'): void {
    event.preventDefault();
    this.errorMessage.set(null);
    this.selectedVehicle.set(null);
    this.unsureModeActive.set(false);
    this.aiResponse.set('');

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
    this.unsureModeActive.set(false);
    this.aiQuery.set('');
    this.aiResponse.set('');
  }

  submitSearch(): void {
    if (this.isVin()) this.searchByVin();
    else this.selectVehicle();
  }

  searchUnsure(): void {
    const year = this.selectedYear();
    const make = this.selectedMake();
    const query = this.aiQuery();
    if (!year || !make || !query) return;

    this.isAiLoading.set(true);
    this.comparisonResults.set([]);
    this.intentDescription.set('Analyzing request...');
    this.errorMessage.set(null);

    // 1. Identify distinct models
    const allModels = this.models();
    const distinctModels = new Map<string, { vehicleId: string; name: string }>();

    for (const model of allModels) {
      // ... (Same distinct model logic) ...
      if (!distinctModels.has(model.model)) {
        if (model.engines && model.engines.length > 0) {
          distinctModels.set(model.model, { vehicleId: model.engines[0].id, name: `${model.model} (${model.engines[0].name})` });
        } else {
          distinctModels.set(model.model, { vehicleId: model.id, name: model.model });
        }
      }
    }

    const vehiclesToCompare = Array.from(distinctModels.values());
    const modelNames = vehiclesToCompare.map(v => v.name).join(', ');

    // 2. Analyze Intent
    this.geminiApi.analyzeSearchIntent(query, modelNames).pipe(
      switchMap(intent => {
        console.log('Search Intent:', intent);
        this.intentDescription.set(`Searching for: "${intent.optimizedTerm}"`);

        // 3. Parallel Fetch for each distinct model
        const requests$ = vehiclesToCompare.map(v =>
          this.motorApi.searchArticles(this.currentContentSource(), v.vehicleId, intent.optimizedTerm).pipe(
            map(response => {
              const topArticle = response.body.articleDetails?.[0]; // Get the most relevant one
              return {
                modelName: v.name,
                vehicleId: v.vehicleId,
                foundArticle: topArticle,
                searchError: (!topArticle) ? 'No direct match found.' : undefined
              } as ComparisonResult;
            })
          )
        );
        return forkJoin(requests$);
      })
    ).subscribe({
      next: (results) => {
        this.comparisonResults.set(results);
        this.isAiLoading.set(false);
        this.intentDescription.set(''); // Clear "Searching..." status
      },
      error: (err) => {
        console.error('Intent search failed:', err);
        this.errorMessage.set('Search failed.');
        this.isAiLoading.set(false);
      }
    });
  }

  private searchByVin(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.motorApi.decodeVin(this.searchTerm()).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        const { contentSource, vehicleId } = res.body;
        this.router.navigate(['/vehicle', contentSource, vehicleId]);
      },
      error: () => { this.isLoading.set(false); this.errorMessage.set('Could not find a vehicle with that VIN.'); }
    });
  }

  private selectVehicle(): void {
    const vehicle = this.selectedVehicle();
    if (vehicle) {
      this.isLoading.set(true);
      this.router.navigate(['/vehicle', this.currentContentSource(), vehicle.vehicleId]);
    } else {
      this.errorMessage.set('Please select a complete vehicle.');
    }
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
}