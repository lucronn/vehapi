// FIX: import `signal` from `@angular/core` to create a new signal.
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, of, debounceTime, distinctUntilChanged, forkJoin, Subject, tap } from 'rxjs';

import { MotorApiService } from '../../services/motor-api.service';
import { VehiclePersistenceService } from '../../services/vehicle-persistence.service';
import { Article, ArticlesData, FilterTab } from '../../models/motor.models';

interface VehicleData {
  contentSource: string;
  vehicleId: string;
  vehicleName: string;
  articlesData: ArticlesData | null;
}

@Component({
  selector: 'app-vehicle-dashboard',
  template: `
<div class="min-h-screen bg-gray-900 text-gray-200 p-4 sm:p-6 lg:p-8">
  <div class="max-w-7xl mx-auto">
    
    <header class="mb-8">
       <a routerLink="/" class="text-cyan-400 hover:text-cyan-300 mb-4 inline-block">&larr; Back to Search</a>
       @if (!isLoading()) {
        <h1 class="text-3xl md:text-4xl font-bold tracking-tight text-white">{{ vehicleName() }}</h1>
       } @else {
        <div class="h-10 bg-gray-700 rounded-md animate-pulse w-3/4"></div>
       }
    </header>
    
    <div class="sticky top-0 z-20 bg-gray-900/80 backdrop-blur-md py-4 mb-6">
      <input 
        type="text" 
        placeholder="Search articles (e.g., 'brake caliper', 'P0300')" 
        (input)="onSearch($event)"
        class="w-full p-4 bg-gray-800 border-2 border-gray-700 rounded-lg text-lg focus:ring-cyan-500 focus:border-cyan-500 transition-colors"
      />
    </div>

    <!-- Content -->
    @if (!isLoading()) {
      <div class="mb-6">
        <div class="flex flex-wrap gap-2">
          @for (tab of filterTabs(); track tab.name) {
            <button (click)="setFilter(tab.name)" [class]="{'bg-cyan-500 text-black': activeFilter() === tab.name, 'bg-gray-700 hover:bg-gray-600': activeFilter() !== tab.name}" class="px-4 py-2 text-sm font-semibold rounded-full transition-colors">
              {{ tab.name }} ({{ tab.count }})
            </button>
          }
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        @for (article of filteredArticles(); track article.id) {
          <a [routerLink]="['/vehicle', contentSource(), vehicleId(), 'article', article.id]" class="bg-gray-800 border border-gray-700 rounded-xl hover:border-cyan-500 hover:scale-105 transform transition-all duration-300 group flex flex-col">
            
            @if(article.thumbnailHref) {
              <div class="w-full h-40 bg-gray-700 overflow-hidden rounded-t-xl">
                <img [src]="getGraphicUrl(article.thumbnailHref)" alt="Diagram thumbnail" class="w-full h-full object-cover group-hover:opacity-80 transition-all duration-300 group-hover:scale-110"/>
              </div>
            }

            <div class="p-4 flex flex-col flex-grow">
              <span class="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-2">{{ article.bucket }}</span>
              <h3 class="font-bold text-lg text-white mb-2 flex-grow">{{ article.title || article.code }}</h3>
              @if(article.description) { <p class="text-sm text-gray-400">{{ article.description }}</p> }
              @if(article.subtitle) { <p class="text-sm text-gray-400 mt-1 italic">{{ article.subtitle }}</p> }
              @if(article.bulletinNumber) { <p class="text-sm text-gray-500 mt-2">TSB: {{ article.bulletinNumber }}</p> }
            </div>
          </a>
        }
      </div>
       @if (filteredArticles().length === 0) {
        <div class="text-center py-16 text-gray-500"><p class="text-2xl">No results found.</p><p>Try adjusting your search or filter.</p></div>
      }
    } @else {
      <!-- Loading Skeleton -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-pulse">
        @for (_ of [1,2,3,4,5,6,7,8]; track _) { <div class="bg-gray-800 rounded-xl h-64"></div> }
      </div>
    }
  </div>
</div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule],
})
export class VehicleDashboardComponent {
  private route = inject(ActivatedRoute);
  private motorApi = inject(MotorApiService);
  private persistence = inject(VehiclePersistenceService);

  private searchTerm$: Subject<string>;
  readonly searchTerm: Signal<string>;
  private vehicleData: Signal<VehicleData | null>;
  
  // --- Derived Signals ---
  readonly contentSource: Signal<string>;
  readonly vehicleId: Signal<string>;
  readonly vehicleName: Signal<string>;
  readonly allArticles: Signal<Article[]>;
  readonly filterTabs: Signal<FilterTab[]>;
  readonly isLoading: Signal<boolean>;

  // --- UI State Signals ---
  readonly activeFilter = signal('All');
  readonly filteredArticles: Signal<Article[]>;

  constructor() {
    this.searchTerm$ = new Subject<string>();
    this.searchTerm = toSignal(this.searchTerm$.pipe(debounceTime(300), distinctUntilChanged()), { initialValue: '' });

    this.vehicleData = toSignal(
      this.route.paramMap.pipe(
        switchMap(params => {
          const contentSource = params.get('contentSource');
          const vehicleId = params.get('vehicleId');
          if (contentSource && vehicleId) {
            return forkJoin({
              name: this.motorApi.getVehicleName(contentSource, vehicleId),
              articles: this.motorApi.searchArticles(contentSource, vehicleId),
            }).pipe(
              map(({ name, articles }) => ({
                contentSource,
                vehicleId,
                vehicleName: name.body,
                articlesData: articles.body,
              } as VehicleData)),
              tap(data => {
                if (data) {
                  this.persistence.saveVehicle({ 
                    name: data.vehicleName, 
                    contentSource: data.contentSource, 
                    vehicleId: data.vehicleId 
                  });
                }
              })
            );
          }
          return of(null);
        })
      ), { initialValue: null }
    );
  
    this.contentSource = computed(() => this.vehicleData()?.contentSource ?? '');
    this.vehicleId = computed(() => this.vehicleData()?.vehicleId ?? '');
    this.vehicleName = computed(() => this.vehicleData()?.vehicleName ?? '');
    this.allArticles = computed(() => this.vehicleData()?.articlesData?.articleDetails ?? []);
    this.filterTabs = computed(() => this.vehicleData()?.articlesData?.filterTabs ?? []);
    this.isLoading = computed(() => this.vehicleData() === null);

    this.filteredArticles = computed(() => {
      const articles = this.allArticles();
      const filter = this.activeFilter();
      const search = this.searchTerm().toLowerCase();

      let categoryFiltered = articles;
      if (filter !== 'All') {
        categoryFiltered = articles.filter(a =>
          a.parentBucket === filter || a.bucket.includes(filter) ||
          (filter === 'Diagrams' && (a.bucket.includes('Wiring') || a.bucket.includes('Component Location'))) ||
          (filter === 'Service Bulletins' && a.id.startsWith('TSB')) ||
          (filter === 'Diagnostic Codes' && a.id.startsWith('DTC')) ||
          (filter === 'Specs' && a.bucket.includes('Specification'))
        );
      }

      if (!search) return categoryFiltered;
      return categoryFiltered.filter(article =>
        (article.title && article.title.toLowerCase().includes(search)) ||
        (article.description && article.description.toLowerCase().includes(search)) ||
        (article.code && article.code.toLowerCase().includes(search)) ||
        (article.bucket && article.bucket.toLowerCase().includes(search))
      );
    });
  }

  setFilter(filter: string): void { this.activeFilter.set(filter); }
  
  onSearch(event: Event): void { 
    this.searchTerm$.next((event.target as HTMLInputElement).value); 
  }
  
  getGraphicUrl(path: string | undefined): string { return path ? this.motorApi.getGraphicUrl(path) : 'https://picsum.photos/240/220'; }

}