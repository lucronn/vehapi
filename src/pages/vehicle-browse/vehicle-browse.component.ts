import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { getMotorProxyBaseUrl } from '../../utils/motor-api.constants';
import { ApiResponse } from '../../models/motor.models';

interface BrowseVehicle {
  external_id: string;
  year: number;
  make: string;
  model: string;
  is_normalized: boolean;
  updated_at: string;
}

interface BrowseResponse {
  vehicles: BrowseVehicle[];
  totalNormalized: number;
  returned: number;
}

@Component({
  selector: 'app-vehicle-browse',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="browse">
      <header>
        <h1>Vehicle Catalog</h1>
        <p class="sub">
          Browsing <strong>{{ totalNormalized() }}</strong> vehicles with ingested article catalogs in Cloud SQL.
        </p>
      </header>

      <div class="filters">
        <input
          type="search"
          placeholder="Search make, model, or year:make:model…"
          [(ngModel)]="q"
          (ngModelChange)="onQueryChange()"
          autofocus
        />
        <select [(ngModel)]="yearFilter" (change)="load()">
          <option value="">All years</option>
          <option *ngFor="let y of years()" [value]="y">{{ y }}</option>
        </select>
        <select [(ngModel)]="makeFilter" (change)="load()">
          <option value="">All makes</option>
          <option *ngFor="let m of makes()" [value]="m">{{ m }}</option>
        </select>
      </div>

      <div *ngIf="loading()" class="status">Loading…</div>
      <div *ngIf="error()" class="status error">{{ error() }}</div>

      <div class="grid" *ngIf="!loading() && vehicles().length">
        <button
          *ngFor="let v of vehicles(); trackBy: trackId"
          class="card"
          [class.normalized]="v.is_normalized"
          (click)="open(v)"
        >
          <div class="ymm">{{ v.year }} {{ v.make }}</div>
          <div class="model">{{ v.model }}</div>
          <div class="meta">
            <span class="dot" [class.on]="v.is_normalized"></span>
            {{ v.is_normalized ? 'Catalog ingested' : 'Catalog not ingested' }}
          </div>
        </button>
      </div>

      <div *ngIf="!loading() && !vehicles().length && !error()" class="status">
        No vehicles match these filters.
      </div>

      <p class="footer" *ngIf="returned() === 1000">
        Showing first 1000 results — narrow your filters to see more.
      </p>
    </div>
  `,
  styles: [`
    .browse { max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem; }
    header h1 { margin: 0 0 0.25rem; }
    header .sub { color: var(--muted, #888); margin: 0 0 1.5rem; }
    .filters { display: flex; gap: 0.75rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    .filters input { flex: 1 1 280px; padding: 0.55rem 0.75rem; border-radius: 6px; border: 1px solid var(--border, #ccc); font-size: 0.95rem; }
    .filters select { padding: 0.55rem 0.75rem; border-radius: 6px; border: 1px solid var(--border, #ccc); background: var(--bg, #fff); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem; }
    .card { text-align: left; padding: 0.85rem 1rem; border: 1px solid var(--border, #ddd); border-radius: 8px; background: var(--bg, #fff); cursor: pointer; transition: border-color .15s, transform .15s; font: inherit; color: inherit; }
    .card:hover { border-color: var(--accent, #3b82f6); transform: translateY(-1px); }
    .card.normalized { border-left: 3px solid #22c55e; }
    .ymm { font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted, #888); }
    .model { font-size: 1rem; margin: 0.15rem 0 0.4rem; }
    .meta { font-size: 0.78rem; color: var(--muted, #888); display: flex; align-items: center; gap: 0.4rem; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #ccc; display: inline-block; }
    .dot.on { background: #22c55e; }
    .status { padding: 2rem; text-align: center; color: var(--muted, #888); }
    .status.error { color: #ef4444; }
    .footer { margin-top: 1.5rem; text-align: center; color: var(--muted, #888); font-size: 0.85rem; }
  `]
})
export class VehicleBrowseComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);
  private base = getMotorProxyBaseUrl();

  q = '';
  yearFilter = '';
  makeFilter = '';

  vehicles = signal<BrowseVehicle[]>([]);
  totalNormalized = signal(0);
  returned = signal(0);
  loading = signal(false);
  error = signal<string | null>(null);

  years = signal<number[]>([]);
  makes = computed(() => {
    const set = new Set<string>();
    for (const v of this.vehicles()) set.add(v.make);
    return Array.from(set).sort();
  });

  private debounce: any;

  async ngOnInit() {
    // Populate year dropdown from DB
    try {
      const r = await firstValueFrom(this.http.get<ApiResponse<number[]>>(`${this.base}/api/db/years`));
      this.years.set(r.body || []);
    } catch { /* fall through with empty years list */ }
    await this.load();
  }

  onQueryChange() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.load(), 250);
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const params: Record<string, string> = { limit: '1000' };
      if (this.q.trim()) params['q'] = this.q.trim();
      if (this.yearFilter) params['year'] = this.yearFilter;
      if (this.makeFilter) params['make'] = this.makeFilter;
      const qs = new URLSearchParams(params).toString();
      const r = await firstValueFrom(
        this.http.get<ApiResponse<BrowseResponse>>(`${this.base}/api/db/vehicles?${qs}`)
      );
      this.vehicles.set(r.body.vehicles);
      this.totalNormalized.set(r.body.totalNormalized);
      this.returned.set(r.body.returned);
    } catch (e: any) {
      this.error.set(e?.message || 'Failed to load vehicles');
    } finally {
      this.loading.set(false);
    }
  }

  open(v: BrowseVehicle) {
    // Vehicle dashboard uses contentSource + vehicleId; route via the external_id we have.
    this.router.navigate(['vehicle', 'MOTOR', v.external_id]);
  }

  trackId = (_: number, v: BrowseVehicle) => v.external_id;
}
