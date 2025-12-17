
import { ChangeDetectionStrategy, Component, computed, inject, signal, effect, Injector } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, of, debounceTime, distinctUntilChanged, forkJoin, Subject, tap, catchError, from } from 'rxjs';

import { MotorApiService } from '../../services/motor-api.service';
import { GeminiService } from '../../services/gemini.service';
import { VehiclePersistenceService } from '../../services/vehicle-persistence.service';
import { FirebaseService } from '../../services/firebase.service';
import { DataSyncService } from '../../services/data-sync.service';
import { Article, FilterTab, Dtc, Tsb, WiringDiagram, ComponentLocation, Procedure, Fluid, Spec } from '../../models/motor.models';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

type DashboardSection = 'overview' | 'dtcs' | 'tsbs' | 'diagrams' | 'procedures' | 'specs';

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
  private syncService = inject(DataSyncService);
  private firebase = inject(FirebaseService);
  private sanitizer = inject(DomSanitizer);

  // Sync UI State
  isSyncing = this.syncService.isSyncing;
  syncProgress = this.syncService.syncProgress;

  params = toSignal(this.route.paramMap, { injector: this.injector });
  contentSource = computed(() => this.params()?.get('contentSource') ?? '');
  vehicleId = computed(() => this.params()?.get('vehicleId') ?? '');

  vehicleName = signal('');
  activeSection = signal<DashboardSection>('overview');
  isMobileMenuOpen = signal(false);

  // Data Signals
  dtcs = signal<Dtc[]>([]);
  tsbs = signal<Tsb[]>([]);
  diagrams = signal<(WiringDiagram | ComponentLocation)[]>([]);
  procedures = signal<Procedure[]>([]);
  fluids = signal<Fluid[]>([]);
  specs = signal<Spec[]>([]);

  // Loading States
  isLoadingData = signal(false);

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
    debounceTime(600),
    distinctUntilChanged()
  ), { initialValue: '', injector: this.injector });

  // AI State
  isAiLoading = signal(false);
  aiSearchSummary = signal<SafeHtml | null>(null);
  isIssuesLoading = signal(false);
  commonIssues = signal<import('../../models/motor.models').CommonIssue[]>([]);
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
        // Load initial data
        this.findCommonIssues();
        this.loadSectionData('overview'); // Load default
      }
    });

    // AI search analysis on debounce
    effect(() => {
      const term = this.searchTerm();
      const articles = this.allArticles();
      const cs = this.contentSource();
      const vid = this.vehicleId();

      if (term.length > 5 && articles.length > 0 && cs && vid) {
        this.isAiLoading.set(true);

        // Fetch content of the top result to give AI context
        const topArticle = articles[0];
        this.motorApi.getArticleContent(cs, vid, topArticle.id).pipe(
          catchError(() => of({ body: { html: '' } })), // Silently fail if content load fails
          switchMap(contentRes => {
            const content = contentRes?.body?.html || '';
            return this.geminiApi.analyzeSearchTerm(term, articles, content);
          })
        ).subscribe(summary => {
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
    const search = this.searchTerm().toLowerCase();

    if (!search) return articles;
    return articles.filter(article =>
      (article.title && article.title.toLowerCase().includes(search)) ||
      (article.description && article.description.toLowerCase().includes(search)) ||
      (article.code && article.code.toLowerCase().includes(search)) ||
      (article.bucket && article.bucket.toLowerCase().includes(search))
    );
  });

  setSection(section: DashboardSection): void {
    this.activeSection.set(section);
    this.isMobileMenuOpen.set(false); // Close menu on selection
    this.loadSectionData(section);
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen.update(v => !v);
  }

  loadSectionData(section: DashboardSection) {
    const cs = this.contentSource();
    const vid = this.vehicleId();
    if (!cs || !vid) return;

    switch (section) {
      case 'dtcs':
        if (this.dtcs().length === 0) {
          this.isLoadingData.set(true);
          this.firebase.getDtcList(cs, vid).then(cached => {
            if (cached) {
              this.dtcs.set(cached);
              this.isLoadingData.set(false);
            } else {
              this.motorApi.getDtcs(cs, vid).subscribe(res => {
                this.dtcs.set(res.body.data);
                this.isLoadingData.set(false);
                this.firebase.saveDtcList(cs, vid, res.body.data);
              });
            }
          });
        }
        break;
      case 'tsbs':
        if (this.tsbs().length === 0) {
          this.isLoadingData.set(true);
          this.firebase.getTsbList(cs, vid).then(cached => {
            if (cached) {
              this.tsbs.set(cached);
              this.isLoadingData.set(false);
            } else {
              this.motorApi.getTsbs(cs, vid).subscribe(res => {
                this.tsbs.set(res.body.data);
                this.isLoadingData.set(false);
                this.firebase.saveTsbList(cs, vid, res.body.data);
              });
            }
          });
        }
        break;
      case 'diagrams':
        if (this.diagrams().length === 0) {
          this.isLoadingData.set(true);
          // Diagrams might be too heavy or complex to cache list easily? Let's just cache it anyway.
          // Wait, Motor API returns a list. It's fine.

          /* 
             NOTE: 'diagrams' endpoint actually returns a list of WiringDiagram | ComponentLocation.
             We can cache this list similarly. I'll need to add get/saveDiagramList to Firebase service if I want to cache this too.
             For now, let's leave diagrams as live fetch or implement if user requests.
             Wait, user said "build database by usage". I should probably do it. 
             But I didn't add it to FirebaseService yet. 
             Let's skip diagrams caching for this immediate step to stick to plan, OR add it briefly. 
             The plan didn't explicitly list 'diagrams' in FirebaseService changes, just DTC/TSB/Procedure. 
             I'll stick to the plan for DTC/TSB/Procedure.
          */
          this.motorApi.getAllDiagrams(cs, vid).subscribe(res => {
            this.diagrams.set(res.body.data);
            this.isLoadingData.set(false);
          });
        }
        break;
      case 'procedures':
        if (this.procedures().length === 0) {
          this.isLoadingData.set(true);
          this.firebase.getProcedureList(cs, vid).then(cached => {
            if (cached) {
              this.procedures.set(cached);
              this.isLoadingData.set(false);
            } else {
              this.motorApi.getProcedures(cs, vid).subscribe(res => {
                this.procedures.set(res.body.data);
                this.isLoadingData.set(false);
                this.firebase.saveProcedureList(cs, vid, res.body.data);
              });
            }
          });
        }
        break;
      case 'specs':
        if (this.fluids().length === 0 && this.specs().length === 0) {
          this.isLoadingData.set(true);

          // Load Fluids
          const fluidsPromise = this.firebase.getFluidList(cs, vid).then(cached => {
            if (cached) return of({ data: cached }); // Normalize to { data: Fluid[] }
            return this.motorApi.getFluids(cs, vid).pipe(
              tap(res => this.firebase.saveFluidList(cs, vid, res.body.data)),
              map(res => ({ data: res.body.data }))
            );
          });

          // Load Specs
          const specsPromise = this.firebase.getSpecList(cs, vid).then(cached => {
            if (cached) return of({ data: cached });
            return this.motorApi.getSpecs(cs, vid).pipe(
              tap(res => this.firebase.saveSpecList(cs, vid, res.body.data)),
              map(res => ({ data: res.body.data }))
            );
          });

          // Execute both
          forkJoin({
            fluids: from(fluidsPromise).pipe(switchMap(obs => obs)),
            specs: from(specsPromise).pipe(switchMap(obs => obs))
          }).subscribe({
            next: (results: any) => {
              this.fluids.set(results.fluids.data);
              this.specs.set(results.specs.data);
              this.isLoadingData.set(false);
            },
            error: (err) => {
              console.error('Failed to load specs/fluids', err);
              this.isLoadingData.set(false);
            }
          });
        }
        break;
      default:
        this.isLoadingData.set(false);
        return;
    }
  }

  onSearch(event: Event): void {
    this.searchTerm$.next((event.target as HTMLInputElement).value);
  }

  getGraphicUrl(path: string | undefined): string { return path ? this.motorApi.getGraphicUrl(path) : 'https://picsum.photos/240/220'; }

  findCommonIssues(): void {
    const name = this.vehicleName();
    const cs = this.contentSource();
    const vid = this.vehicleId();
    if (!name || !cs || !vid) return;

    this.isIssuesLoading.set(true);

    // 1. Check Firebase Cache
    this.firebase.getCommonIssues(cs, vid).then(cached => {
      if (cached && cached.length > 0) {
        console.log('Cache Hit: Common Issues');
        this.commonIssues.set(cached);
        this.isIssuesLoading.set(false);
      } else {
        // 2. Cache Miss -> Call Gemini
        console.log('Cache Miss: Generating Common Issues');
        this.geminiApi.findCommonIssues(name).subscribe(issues => {
          this.commonIssues.set(issues);
          this.isIssuesLoading.set(false);
          // 3. Save to Cache
          this.firebase.saveCommonIssues(cs, vid, issues);
        });
      }
    });
  }

  generateSolution(issue: string): void {
    const name = this.vehicleName();
    const cs = this.contentSource();
    const vid = this.vehicleId();
    if (!name || !cs || !vid) return;

    this.isSolutionLoading.update(set => {
      const newSet = new Set(set);
      newSet.add(issue);
      return newSet;
    });

    // RAG Flow: Search -> Fetch Content -> Generate
    this.motorApi.searchArticles(cs, vid, issue).pipe(
      // 1. Search for relevant article
      switchMap(searchRes => {
        const articles = searchRes.body.articleDetails || [];
        if (articles.length > 0) {
          // 2. Fetch content of top result
          return this.motorApi.getArticleContent(cs, vid, articles[0].id).pipe(
            map(contentRes => contentRes.body.html || ''),
            catchError(() => of('')) // Fallback to empty context if fetch fails
          );
        }
        return of(''); // No article found
      }),
      // 3. Generate Solution with Context
      switchMap(content => {
        return this.geminiApi.generateSolution(issue, name, content);
      })
    ).subscribe(solution => {
      this.solutions.update(map => {
        const newMap = new Map(map);
        newMap.set(issue, this.sanitizer.bypassSecurityTrustHtml(solution));
        return newMap;
      });

      this.isSolutionLoading.update(set => {
        const newSet = new Set(set);
        newSet.delete(issue);
        return newSet;
      });
    });
  }
}
