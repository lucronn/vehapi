
import { ChangeDetectionStrategy, Component, computed, inject, signal, ElementRef, ViewChild, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { forkJoin, map, of, switchMap } from 'rxjs';

import { MotorApiService } from '../../services/motor-api.service';
import { GeminiService } from '../../services/gemini.service';
import { VehiclePersistenceService } from '../../services/vehicle-persistence.service';
import { LogoComponent } from '../../components/logo/logo.component';
import { Make, Model, PersistedVehicle, Article } from '../../models/motor.models';

type Suggestion = 
  | { type: 'Year'; value: number; display: string }
  | { type: 'Make'; value: Make; display: string }
  | { type: 'Model'; value: { vehicleId: string; displayName: string }; display: string }
  | { type: 'Unsure'; value: 'unsure'; display: string };

@Component({
  selector: 'app-home',
  template: `
<div class="flex flex-col items-center justify-center min-h-screen p-4 bg-black/50 text-gray-200">
  <header class="w-full max-w-4xl text-center mb-2">
    <div class="h-48 md:h-64 mx-auto">
      <app-logo></app-logo>
    </div>
    <h1 class="text-4xl md:text-6xl font-bold tracking-tighter text-cyan-400">
      TORQUE
    </h1>
    <p class="text-lg md:text-xl text-gray-400 mt-2">
      Your AI-Powered Automotive Repair Assistant
    </p>
  </header>

  <div class="w-full max-w-2xl mt-8">
    @if (persistedVehicle(); as vehicle) {
      <div class="bg-gray-900/50 backdrop-blur-sm p-6 rounded-2xl border border-gray-700 shadow-2xl shadow-cyan-500/10 text-center">
        <h2 class="text-2xl font-bold text-white mb-2">Welcome Back!</h2>
        <p class="text-gray-400 mb-6">Continue with your previously selected vehicle:</p>
        <div class="bg-gray-800 p-4 rounded-lg mb-6">
            <p class="font-semibold text-lg text-cyan-300">{{ vehicle.name }}</p>
        </div>
        <div class="flex flex-col sm:flex-row gap-4 justify-center">
            <button (click)="continueToVehicle()" class="px-6 py-3 bg-cyan-500 text-black font-bold rounded-lg hover:bg-cyan-400 transition-all duration-300">
                Continue
            </button>
            <button (click)="startNewSearch()" class="px-6 py-3 bg-gray-600 text-white font-bold rounded-lg hover:bg-gray-500 transition-all duration-300">
                Start New Search
            </button>
        </div>
      </div>
    } @else {
      <div class="bg-gray-900/50 backdrop-blur-sm p-6 rounded-2xl border border-gray-700 shadow-2xl shadow-cyan-500/10">
        
        <!-- Selection Pills -->
        <div class="flex flex-wrap items-center gap-2 mb-4 min-h-[32px]">
          @if (selectedYear(); as year) {
            <span class="flex items-center gap-2 bg-cyan-800/50 text-cyan-300 px-3 py-1 rounded-full text-sm">
              {{ year }}
              <button (mousedown)="removeSelection($event, 'Year')" class="text-cyan-400 hover:text-white text-lg leading-none">&times;</button>
            </span>
          }
          @if (selectedMake(); as make) {
            <span class="flex items-center gap-2 bg-cyan-800/50 text-cyan-300 px-3 py-1 rounded-full text-sm">
              {{ make.makeName }}
              <button (mousedown)="removeSelection($event, 'Make')" class="text-cyan-400 hover:text-white text-lg leading-none">&times;</button>
            </span>
          }
          @if (selectedVehicle(); as vehicle) {
            <span class="flex items-center gap-2 bg-cyan-700/50 text-cyan-200 px-3 py-1 rounded-full text-sm truncate">
              {{ vehicle.displayName }}
              <button (mousedown)="removeSelection($event, 'Model')" class="text-cyan-400 hover:text-white text-lg leading-none">&times;</button>
            </span>
          }
        </div>

        <!-- Omnibox Search -->
        <div class="relative">
          
          <!-- Suggestions Drop-up -->
          @if (showSuggestions() && !isVin() && !selectedVehicle() && !unsureModeActive()) {
            <div #suggestionsContainer class="absolute z-30 w-full bottom-full mb-2 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              @for (suggestion of suggestions(); track suggestion.display) {
                <div (mousedown)="selectSuggestion($event, suggestion)" 
                     [class.bg-yellow-500]="suggestion.type === 'Unsure'"
                     [class.text-black]="suggestion.type === 'Unsure'"
                     class="px-4 py-3 hover:bg-cyan-500 hover:text-black cursor-pointer transition-colors duration-150">
                  {{ suggestion.display }}
                </div>
              }
              @if(suggestions().length === 0 && !isLoading()) { <div class="px-4 py-3 text-gray-500">No results found.</div> }
              @if(isLoading()) { <div class="px-4 py-3 text-gray-500">Loading...</div> }
            </div>
          }

          @if (!unsureModeActive()) {
            <div class="flex flex-col sm:flex-row gap-3">
              <input #searchInput type="text" [placeholder]="currentPlaceholder()" class="flex-grow bg-gray-800 border-2 border-gray-600 rounded-lg p-3 text-lg focus:ring-cyan-500 focus:border-cyan-500 transition-all duration-300 placeholder-gray-500 disabled:opacity-50"
                [ngModel]="searchTerm()"
                (ngModelChange)="searchTerm.set($event)"
                (focus)="onSearchFocus()"
                (keydown.enter)="handleEnterKey()"
                (keydown.space)="handleSpacebar($event)"
                [disabled]="!!selectedVehicle()"
                autocomplete="off" />
              <button (click)="submitSearch()" [disabled]="isLoading() || (!isVin() && !selectedVehicle())" class="px-6 py-3 bg-cyan-500 text-black font-bold rounded-lg hover:bg-cyan-400 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all duration-300">
                @if (isLoading()) { <span>Loading...</span> } @else { <span>{{ isVin() ? 'Search' : 'Go' }}</span> }
              </button>
              @if (selectedVehicle() || selectedYear()) {
                 <button (click)="clearAllSelections()" class="px-4 py-3 bg-gray-600 text-white font-bold rounded-lg hover:bg-gray-500 transition-all duration-300">Clear</button>
              }
            </div>
          } @else {
            <!-- "Unsure" AI Search UI -->
            <div>
                <p class="text-sm text-yellow-300 mb-2">AI Assistant: What information are you looking for across all models?</p>
                <div class="flex flex-col sm:flex-row gap-3">
                    <input type="text" [placeholder]="currentPlaceholder()" class="flex-grow bg-gray-800 border-2 border-yellow-500/50 rounded-lg p-3 text-lg focus:ring-yellow-500 focus:border-yellow-500 transition-all duration-300 placeholder-gray-500"
                      [ngModel]="aiQuery()"
                      (ngModelChange)="aiQuery.set($event)"
                      (keydown.enter)="searchUnsure()"
                      autocomplete="off" />
                    <button (click)="searchUnsure()" [disabled]="isAiLoading()" class="px-6 py-3 bg-yellow-500 text-black font-bold rounded-lg hover:bg-yellow-400 disabled:bg-gray-600 transition-all">
                      @if (isAiLoading()) { <span>Thinking...</span> } @else { <span>Ask AI</span> }
                    </button>
                </div>
            </div>
          }
        </div>
        
        @if (errorMessage()) {
          <div class="bg-red-900/50 border border-red-700 text-red-300 text-center p-3 rounded-lg mt-4">{{ errorMessage() }}</div>
        }

        @if (aiResponse() && !isAiLoading()) {
            <div class="mt-6 border-t-2 border-cyan-700/50 pt-4">
                <h3 class="text-xl font-bold text-cyan-300 mb-2">AI Comparison</h3>
                <div class="prose prose-invert prose-sm max-w-none motor-content" [innerHTML]="aiResponse()"></div>
            </div>
        }
        @if (isAiLoading()) {
            <div class="mt-6 text-center text-gray-400">Generating comparison, please wait...</div>
        }
      </div>
    }
  </div>
</div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, LogoComponent],
  host: {
    '(document:click)': 'onDocumentClick($event)'
  }
})
export class HomeComponent implements OnInit {
  private motorApi = inject(MotorApiService);
  private geminiApi = inject(GeminiService);
  private persistence = inject(VehiclePersistenceService);
  private router = inject(Router);

  @ViewChild('searchInput') searchInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('suggestionsContainer') suggestionsContainerRef!: ElementRef<HTMLDivElement>;

  // Search State
  searchTerm = signal('');
  selectedYear = signal<number | null>(null);
  selectedMake = signal<Make | null>(null);
  selectedVehicle = signal<{ vehicleId: string; displayName: string } | null>(null);

  // Data
  private years = toSignal(this.motorApi.getYears(), { initialValue: null });
  private makes = signal<Make[]>([]);
  private models = signal<Model[]>([]);
  persistedVehicle = signal<PersistedVehicle | null>(null);

  // UI State
  isLoading = signal(false);
  errorMessage = signal<string | null>(null);
  showSuggestions = signal(false);

  // "Unsure" AI Mode State
  unsureModeActive = signal(false);
  aiQuery = signal('');
  aiResponse = signal('');
  isAiLoading = signal(false);

  ngOnInit(): void {
    this.persistedVehicle.set(this.persistence.getVehicle());
  }

  onDocumentClick(event: MouseEvent): void {
    if (this.showSuggestions()) {
      const clickedInsideInput = this.searchInputRef?.nativeElement.contains(event.target as Node);
      const clickedInsideSuggestions = this.suggestionsContainerRef?.nativeElement.contains(event.target as Node);
      if (!clickedInsideInput && !clickedInsideSuggestions) {
        this.showSuggestions.set(false);
      }
    }
  }

  searchStep = computed<'Year' | 'Make' | 'Model'>(() => {
    if (!this.selectedYear()) return 'Year';
    if (!this.selectedMake()) return 'Make';
    return 'Model';
  });
  
  isVin = computed(() => this.searchTerm().length > 10 && /^[A-HJ-NPR-Z0-9]{17}$/i.test(this.searchTerm()));

  currentPlaceholder = computed(() => {
    if (this.unsureModeActive()) return 'e.g., "brake pad part numbers" or "oil capacity"';
    if (this.isVin()) return 'Searching by VIN...';
    switch (this.searchStep()) {
      case 'Year': return 'Enter VIN or Year...';
      case 'Make': return 'Select Make...';
      case 'Model': return 'Select Model & Engine...';
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
      const allModels = modelsData.flatMap(model =>
        (model.engines || []).map(engine => ({ vehicleId: engine.id, displayName: `${model.model} - ${engine.name}` }))
      );
      
      let filtered = allModels;
      if (term) {
        filtered = allModels.filter(m => m.displayName.toLowerCase().includes(term));
      }

      const modelSuggestions: Suggestion[] = filtered.map(m => ({ type: 'Model', value: m, display: m.displayName }));
      // Add "Unsure" option if not searching
      if (!term) {
        modelSuggestions.unshift({ type: 'Unsure', value: 'unsure', display: 'Unsure of your exact model? Click here.' });
      }
      return modelSuggestions;
    }
    return [];
  });
  
  onSearchFocus(): void {
    if (this.unsureModeActive()) return;
    this.errorMessage.set(null);
    this.showSuggestions.set(true);
  }

  handleEnterKey(): void {
    if (this.isVin() || this.selectedVehicle()) { this.submitSearch(); return; }
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
    this.searchTerm.set('');
    
    if (suggestion.type === 'Unsure') {
        this.unsureModeActive.set(true);
        this.showSuggestions.set(false);
        return;
    }

    switch (suggestion.type) {
      case 'Year':
        this.selectedYear.set(suggestion.value);
        this.isLoading.set(true);
        this.motorApi.getMakes(suggestion.value).subscribe({
          next: (res) => { this.makes.set(res.body); this.isLoading.set(false); this.showSuggestions.set(true); },
          error: () => { this.isLoading.set(false); this.errorMessage.set('Could not load makes.'); this.showSuggestions.set(false); }
        });
        break;
      case 'Make':
        this.selectedMake.set(suggestion.value);
        this.isLoading.set(true);
        const year = this.selectedYear();
        if (year) {
          this.motorApi.getModels(year, suggestion.value.makeName).subscribe({
            next: (res) => { this.models.set(res.body.models); this.isLoading.set(false); this.showSuggestions.set(true); },
            error: () => { this.isLoading.set(false); this.errorMessage.set('Could not load models.'); this.showSuggestions.set(false); }
          });
        }
        break;
      case 'Model':
        this.selectedVehicle.set(suggestion.value);
        this.showSuggestions.set(false);
        break;
    }
  }

  removeSelection(event: MouseEvent, step: 'Year' | 'Make' | 'Model'): void {
    event.preventDefault();
    this.errorMessage.set(null);
    this.selectedVehicle.set(null);
    this.unsureModeActive.set(false);
    this.aiResponse.set('');

    if (step === 'Year') { this.selectedYear.set(null); this.selectedMake.set(null); this.makes.set([]); this.models.set([]); }
    if (step === 'Make') { this.selectedMake.set(null); this.models.set([]); }
    
    this.showSuggestions.set(true);
  }

  clearAllSelections(): void {
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
    this.aiResponse.set('');
    this.errorMessage.set(null);

    const vehicleName = `${year} ${make.makeName}`;
    const allPossibleVehicles = this.models().flatMap(m => (m.engines || []).map(e => ({ vehicleId: e.id, name: `${m.model} ${e.name}` })));
    
    // Fetch all articles for all possible models
    const articleRequests$ = allPossibleVehicles.map(v => 
      this.motorApi.searchArticles('MOTOR', v.vehicleId, query).pipe(
        map(response => ({ modelName: v.name, articles: response.body.articleDetails })),
        // switchMap(response => of({ modelName: v.name, articles: response.body.articleDetails }))
      )
    );

    forkJoin(articleRequests$).pipe(
      switchMap(results => {
        const articleMap = new Map<string, Article[]>();
        results.forEach(res => articleMap.set(res.modelName, res.articles));
        return this.geminiApi.generateModelComparison(query, vehicleName, this.models(), articleMap);
      })
    ).subscribe({
      next: (comparison) => {
        this.aiResponse.set(comparison);
        this.isAiLoading.set(false);
      },
      error: (err) => {
        console.error("AI comparison failed:", err);
        this.errorMessage.set("AI Assistant failed to generate a comparison.");
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
      this.router.navigate(['/vehicle', 'MOTOR', vehicle.vehicleId]);
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
