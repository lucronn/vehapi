import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, of } from 'rxjs';

import { MotorApiService } from '../../services/motor-api.service';
import { Article, FilterTab } from '../../models/motor.models';

@Component({
  selector: 'app-vehicle-dashboard',
  templateUrl: './vehicle-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule],
})
export class VehicleDashboardComponent {
  private route = inject(ActivatedRoute);
  private motorApi = inject(MotorApiService);
  
  params = toSignal(this.route.paramMap);
  contentSource = computed(() => this.params()?.get('contentSource') ?? '');
  vehicleId = computed(() => this.params()?.get('vehicleId') ?? '');

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
  vehicleInfo = toSignal(this.vehicleInfo$);

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

  articlesData = toSignal(this.articlesData$);
  
  allArticles = computed(() => this.articlesData()?.body.articleDetails ?? []);
  filterTabs = computed(() => this.articlesData()?.body.filterTabs ?? []);

  searchTerm = signal('');
  activeFilter = signal('All');

  filteredArticles = computed(() => {
    const articles = this.allArticles();
    const filter = this.activeFilter();
    const search = this.searchTerm().toLowerCase();

    let categoryFiltered = articles;
    if (filter !== 'All') {
      const typeMapping: { [key: string]: string[] } = {
        'Procedures': ['Procedures'],
        'Diagrams': ['Diagrams'],
        'Service Bulletins': ['TSBs'],
        'Diagnostic Codes': ['DTCs'],
        'Specs': ['Specifications']
      };
      const filterType = typeMapping[filter]?.[0];
      if (filterType) {
        categoryFiltered = articles.filter(a =>
          a.parentBucket === filter || a.bucket.includes(filter) ||
          (filter === 'Diagrams' && (a.bucket.includes('Wiring') || a.bucket.includes('Component Location'))) ||
          (filter === 'Service Bulletins' && a.id.startsWith('TSB')) ||
          (filter === 'Diagnostic Codes' && a.id.startsWith('DTC')) ||
          (filter === 'Specs' && a.bucket.includes('Specification'))
        );
      }
    }

    if (!search) {
      return categoryFiltered;
    }

    return categoryFiltered.filter(article =>
      (article.title && article.title.toLowerCase().includes(search)) ||
      (article.description && article.description.toLowerCase().includes(search)) ||
      (article.code && article.code.toLowerCase().includes(search)) ||
      (article.bucket && article.bucket.toLowerCase().includes(search))
    );
  });

  setFilter(filter: string): void {
    this.activeFilter.set(filter);
  }

  onSearch(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  getGraphicUrl(path: string | undefined): string {
    return path ? this.motorApi.getGraphicUrl(path) : 'https://picsum.photos/240/220';
  }
}