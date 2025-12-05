import { ChangeDetectionStrategy, Component, computed, inject, signal, ElementRef, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';

import { MotorApiService } from '../../services/motor-api.service';
import { LogoComponent } from '../../components/logo/logo.component';
import { Make, Model, Engine } from '../../models/motor.models';

type Suggestion = 
  | { type: 'Year'; value: number; display: string }
  | { type: 'Make'; value: Make; display: string }
  | { type: 'Model'; value: { vehicleId: string; displayName: string }; display: string };

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, LogoComponent],
})
export class HomeComponent {
  private motorApi = inject(MotorApiService);
  private router = inject(Router);
  private elementRef = inject(ElementRef);

  // Unified search term
  searchTerm = signal('');

  // Selections
  selectedYear = signal<number | null>(null);
  selectedMake = signal<Make | null>(null);
  selectedVehicle = signal<{ vehicleId: string; displayName: string } | null>(null);

  // Data from API
  private years = toSignal(this.motorApi.getYears(), { initialValue: null });
  private makes = signal<Make[]>([]);
  private models = signal<Model[]>([]);

  // UI State
  isLoading = signal(false);
  errorMessage = signal<string | null>(null);
  showSuggestions = signal(false);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.showSuggestions.set(false);
    }
  }

  // Search Flow State Machine
  searchStep = computed<'Year' | 'Make' | 'Model'>(() => {
    if (!this.selectedYear()) return 'Year';
    if (!this.selectedMake()) return 'Make';
    return 'Model';
  });
  
  isVin = computed(() => this.searchTerm().length > 10 && /^[A-HJ-NPR-Z0-9]{17}$/i.test(this.searchTerm()));

  currentPlaceholder = computed(() => {
    if (this.isVin()) return 'Searching by VIN...';
    switch (this.searchStep()) {
      case 'Year': return 'Enter VIN or Year...';
      case 'Make': return 'Select Make...';
      case 'Model': return 'Select Model & Engine...';
    }
  });

  suggestions = computed<Suggestion[]>(() => {
    const step = this.searchStep();
    const term = this.searchTerm().toLowerCase();

    if (step === 'Year') {
      const yearsData = this.years()?.body ?? [];
      if (!term) return yearsData.map(y => ({ type: 'Year', value: y, display: y.toString() }));
      return yearsData
        .filter(y => y.toString().includes(term))
        .map(y => ({ type: 'Year', value: y, display: y.toString() }));
    }

    if (step === 'Make') {
      const makesData = this.makes();
      if (!term) return makesData.map(m => ({ type: 'Make', value: m, display: m.makeName }));
      return makesData
        .filter(m => m.makeName.toLowerCase().includes(term))
        .map(m => ({ type: 'Make', value: m, display: m.makeName }));
    }

    if (step === 'Model') {
      const modelsData = this.models();
      const allModels = modelsData.flatMap(model =>
        model.engines.map(engine => ({
          vehicleId: engine.id,
          displayName: `${model.model} - ${engine.name}`
        }))
      );
      if (!term) return allModels.map(m => ({ type: 'Model', value: m, display: m.displayName }));
      return allModels
        .filter(m => m.displayName.toLowerCase().includes(term))
        .map(m => ({ type: 'Model', value: m, display: m.displayName }));
    }
    return [];
  });
  
  onSearchFocus(): void {
    this.errorMessage.set(null);
    this.showSuggestions.set(true);
  }

  selectSuggestion(event: MouseEvent, suggestion: Suggestion): void {
    event.preventDefault(); // Prevent input from losing focus
    this.searchTerm.set('');
    this.showSuggestions.set(false);

    switch (suggestion.type) {
      case 'Year':
        this.selectedYear.set(suggestion.value);
        this.isLoading.set(true);
        this.motorApi.getMakes(suggestion.value).subscribe({
          next: (res) => {
            this.makes.set(res.body);
            this.isLoading.set(false);
            this.showSuggestions.set(true);
          },
          error: () => {
            this.isLoading.set(false);
            this.errorMessage.set('Could not load makes for that year.');
            this.showSuggestions.set(false);
          }
        });
        break;
      case 'Make':
        this.selectedMake.set(suggestion.value);
        this.isLoading.set(true);
        const year = this.selectedYear();
        if (year) {
          this.motorApi.getModels(year, suggestion.value.makeName).subscribe({
            next: (res) => {
              this.models.set(res.body.models);
              this.isLoading.set(false);
              this.showSuggestions.set(true);
            },
            error: () => {
              this.isLoading.set(false);
              this.errorMessage.set('Could not load models for that make.');
              this.showSuggestions.set(false);
            }
          });
        }
        break;
      case 'Model':
        this.selectedVehicle.set(suggestion.value);
        break;
    }
  }

  removeSelection(event: MouseEvent, step: 'Year' | 'Make'): void {
    event.preventDefault(); // Prevent input from losing focus
    this.errorMessage.set(null);
    if (step === 'Year') {
      this.selectedYear.set(null);
      this.selectedMake.set(null);
      this.selectedVehicle.set(null);
      this.makes.set([]);
      this.models.set([]);
    }
    if (step === 'Make') {
      this.selectedMake.set(null);
      this.selectedVehicle.set(null);
      this.models.set([]);
    }
    this.showSuggestions.set(true);
  }

  submitSearch(): void {
    if (this.isVin()) {
      this.searchByVin();
    } else {
      this.selectVehicle();
    }
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
      error: () => {
        this.isLoading.set(false);
        this.errorMessage.set('Could not find a vehicle with that VIN.');
      }
    });
  }

  private selectVehicle(): void {
    const vehicle = this.selectedVehicle();
    const contentSource = this.models().length > 0 ? 'MOTOR' : ''; // Crude check
    if (vehicle && contentSource) {
      this.isLoading.set(true);
      this.router.navigate(['/vehicle', contentSource, vehicle.vehicleId]);
    } else {
      this.errorMessage.set('Please select a complete vehicle configuration.');
    }
  }
}
