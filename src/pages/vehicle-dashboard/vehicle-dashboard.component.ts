
import { ChangeDetectionStrategy, Component, computed, inject, signal, effect, Injector } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, of, debounceTime, distinctUntilChanged, forkJoin, Subject } from 'rxjs';

import { MotorApiService } from '../../services/motor-api.service';
import { GeminiService } from '../../services/gemini.service';
import { VehiclePersistenceService } from '../../services/vehicle-persistence.service';
import { Article, FilterTab } from '../../models/motor.models';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-vehicle-dashboard',
  templateUrl: './vehicle-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule],
})
export class VehicleDashboardComponent {
  private injector = inject(Injector);
  private route = inject(ActivatedRoute);
  private motorApi = inject(MotorApiService);
  private geminiApi = inject(GeminiService);
  private persistence = inject(VehiclePersistenceService);
  private sanitizer = inject(DomSanitizer);
  
  params = toSignal(this.route.paramMap, { injector: this.injector });
  contentSource = computed(() => this.params()?.get('contentSource') ?? '');
  vehicleId = computed(() => this.params()?.get('vehicleId') ?? '');

  vehicleName = signal('');
  
  private vehicleInfo$ = this.route.paramMap.pipe(
    switchMap(params => {
      const contentSource = params.get('contentSource');
      const vehicleId = params.get('vehicleId');
      if (contentSource && vehicleId) {
        return this.motorApi.getVehicleName(contentSource, vehicleId);
      }
      return of(null);
    })
  );

  // Use explicit injector to prevent NG0203 errors
  private vehicleInfo = toSignal(this.vehicleInfo$, { injector: this.injector });

  private articlesData$ = this.route.paramMap.pipe(
    switchMap(params => {
      const contentSource = params.get('contentSource');
      const vehicleId = params.get('vehicleId');
      if (contentSource && vehicleId) {
        return this.motorApi.searchArticles(contentSource, vehicleId);
      }
      return of(null);
    })
  );
  articlesData = toSignal(this.articlesData$, { injector: this.injector });
  
  allArticles = computed(() => this.articlesData()?.body.articleDetails ?? []);
  filterTabs = computed(() => this.articlesData()?.body.filterTabs ?? []);

  // Search Debounce Implementation
  private searchTerm$ = new Subject<string>();
  searchTerm = toSignal(this.searchTerm$.pipe(
    debounceTime(300),
    distinctUntilChanged()
  ), { initialValue: '', injector: this.injector });

  activeFilter = signal('All');

  // AI State
  isAiLoading = signal(false);
  aiSearchSummary = signal<SafeHtml | null>(null);
  isIssuesLoading = signal(false);
  commonIssues = signal<{ text: string, citations: any[] } | null>(null);
  solutions = signal<Map<string, SafeHtml>>(new Map());
  isSolutionLoading = signal<Set<string>>(new Set());

  constructor() {
    // Save vehicle when dashboard is viewed
    effect(() => {
      const vehicleInfo = this.vehicleInfo(); // Read from the property signal
      const cs = this.contentSource();
      const vid = this.vehicleId();
      if (vehicleInfo?.body && cs && vid) {
        this.vehicleName.set(vehicleInfo.body);
        this.persistence.saveVehicle({ name: vehicleInfo.body, contentSource: cs, vehicleId: vid });
        this.findCommonIssues();
      }
    });

    // AI search analysis on debounce
    effect(() => {
        const term = this.searchTerm();
        const articles = this.allArticles();
        if (term.length > 5 && articles.length > 0) {
            this.isAiLoading.set(true);
            this.geminiApi.analyzeSearchTerm(term, articles).subscribe(summary => {
                this.aiSearchSummary.set(this.sanitizer.bypassSecurityTrustHtml(summary));
                this.isAiLoading.set(false);
            });
        } else {
            this.aiSearchSummary.set(null);
        }
    });
  }

  filteredArticles = computed(() => {
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

  setFilter(filter: string): void { this.activeFilter.set(filter); }
  
  onSearch(event: Event): void { 
    this.searchTerm$.next((event.target as HTMLInputElement).value); 
  }
  
  getGraphicUrl(path: string | undefined): string { return path ? this.motorApi.getGraphicUrl(path) : 'https://picsum.photos/240/220'; }

  findCommonIssues(): void {
    const name = this.vehicleName();
    if (!name) return;
    this.isIssuesLoading.set(true);
    this.geminiApi.findCommonIssues(name).subscribe(issues => {
        this.commonIssues.set(issues);
        this.isIssuesLoading.set(false);
    });
  }

  generateSolution(issue: string): void {
    const name = this.vehicleName();
    if (!name) return;
    
    this.isSolutionLoading.update(set => set.add(issue));
    this.geminiApi.generateSolution(issue, name).subscribe(solution => {
      this.solutions.update(map => map.set(issue, this.sanitizer.bypassSecurityTrustHtml(solution)));
      this.isSolutionLoading.update(set => { set.delete(issue); return set; });
    });
  }
}
