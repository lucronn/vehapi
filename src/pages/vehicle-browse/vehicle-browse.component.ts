import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
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
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="browse">
      <a routerLink="/" class="back">← Back</a>

      <header class="head">
        <p class="eyebrow">Catalog</p>
        <h1 class="display-lg">Vehicles</h1>
        <p class="sub">
          {{ totalNormalized().toLocaleString() }} vehicles indexed.
          @if (returned()) { Showing {{ returned() }}. }
        </p>
      </header>

      <div class="filters">
        <label class="search">
          <span class="eyebrow">Search</span>
          <input type="search" placeholder="make · model · year"
            [(ngModel)]="q" (ngModelChange)="onQueryChange()" autofocus />
        </label>
        <label class="select">
          <span class="eyebrow">Year</span>
          <select [(ngModel)]="yearFilter" (change)="load()">
            <option value="">All</option>
            <option *ngFor="let y of years()" [value]="y">{{ y }}</option>
          </select>
        </label>
        <label class="select">
          <span class="eyebrow">Make</span>
          <select [(ngModel)]="makeFilter" (change)="load()">
            <option value="">All</option>
            <option *ngFor="let m of makes()" [value]="m">{{ m }}</option>
          </select>
        </label>
      </div>

      @if (loading()) { <p class="status">Loading…</p> }
      @if (error()) { <p class="status status-error">{{ error() }}</p> }

      @if (!loading() && vehicles().length) {
      <ul class="grid">
        @for (v of vehicles(); track v.external_id) {
        <li>
          <button class="card" [class.normalized]="v.is_normalized" (click)="open(v)">
            <span class="ymm eyebrow">{{ v.year }} · {{ v.make }}</span>
            <span class="model">{{ v.model }}</span>
            <span class="meta">
              @if (v.is_normalized) {
                <span class="dot dot-on"></span> Indexed
              } @else {
                <span class="dot"></span> Pending
              }
            </span>
          </button>
        </li>
        }
      </ul>
      }

      @if (!loading() && !vehicles().length && !error()) {
      <p class="status">Nothing matches these filters.</p>
      }

      @if (returned() === 1000) {
      <p class="footer eyebrow">Showing first 1,000 — narrow filters to see more</p>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      color: var(--ink);
    }
    .browse {
      max-width: 1100px;
      margin: 0 auto;
      padding: 3rem 1.5rem 5rem;
    }
    .back {
      display: inline-block;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.625rem;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: var(--muted);
      text-decoration: none;
      margin-bottom: 3rem;
    }
    .back:hover { color: var(--ink); }
    .head {
      padding-bottom: 2.5rem;
      margin-bottom: 2.5rem;
      border-bottom: 1px solid var(--hairline);
    }
    .head .eyebrow { margin-bottom: 0.75rem; display: block; }
    .head h1 { margin: 0 0 1rem; color: var(--ink); }
    .head .sub {
      font-size: 0.875rem;
      color: var(--muted);
      max-width: 32rem;
    }
    .filters {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1.25rem;
      margin-bottom: 2.5rem;
    }
    @media (min-width: 720px) {
      .filters { grid-template-columns: 2fr 1fr 1fr; }
    }
    .filters label { display: flex; flex-direction: column; gap: 0.5rem; }
    .filters input,
    .filters select {
      background: transparent;
      border: none;
      border-bottom: 1px solid var(--hairline);
      padding: 0.5rem 0;
      font: inherit;
      font-size: 1rem;
      color: var(--ink);
      outline: none;
      transition: border-color 0.2s ease;
      font-family: inherit;
      appearance: none;
      cursor: text;
    }
    .filters select { cursor: pointer; }
    .filters input:focus,
    .filters select:focus {
      border-color: var(--accent);
    }
    .filters input::placeholder { color: var(--faint); }

    .grid {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 1px;
      background: var(--hairline);
      border: 1px solid var(--hairline);
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      width: 100%;
      text-align: left;
      padding: 1.25rem 1.25rem 1.25rem 1.25rem;
      background: var(--surface);
      border: none;
      cursor: pointer;
      font: inherit;
      color: var(--ink);
      transition: background-color 0.2s ease;
    }
    .card:hover { background: var(--paper-edge); }
    .card.normalized { box-shadow: inset 3px 0 0 var(--accent); }
    .ymm { color: var(--faint); }
    .model {
      font-family: 'Literata', serif;
      font-variation-settings: 'opsz' 32;
      font-weight: 450;
      font-size: 1.05rem;
      letter-spacing: -0.01em;
      line-height: 1.2;
      color: var(--ink);
    }
    .meta {
      margin-top: auto;
      padding-top: 0.5rem;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.625rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--faint);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--hairline);
      display: inline-block;
    }
    .dot-on { background: var(--accent); }
    .status {
      padding: 3rem 1rem;
      text-align: center;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .status-error { color: var(--danger); }
    .footer {
      margin-top: 2rem;
      text-align: center;
    }
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
