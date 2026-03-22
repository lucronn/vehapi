import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MotorApiService, L2SearchChunk } from '../../../../../services/motor-api.service';
import { siloCodeToModuleType } from '../../../../../utils/module-access.util';
import { catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';

@Component({
  selector: 'app-l2-search-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './l2-search-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class L2SearchPanelComponent {
  private motorApi = inject(MotorApiService);

  contentSource = input.required<string>();
  vehicleId = input.required<string>();

  query = '';
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly results = signal<L2SearchChunk[]>([]);
  readonly hasSearched = signal(false);

  moduleTypeForSilo(silo: string | null | undefined): string {
    return siloCodeToModuleType(silo);
  }

  search(): void {
    const q = this.query.trim();
    if (!q) {
      this.error.set('Enter a search query.');
      return;
    }
    this.error.set(null);
    this.loading.set(true);
    this.hasSearched.set(true);
    this.motorApi
      .l2Search(this.vehicleId(), q, 8)
      .pipe(
        catchError((err) => {
          const msg =
            err?.error?.error ||
            err?.message ||
            'Search failed';
          this.error.set(typeof msg === 'string' ? msg : 'Search failed');
          return of({ chunks: [] as L2SearchChunk[] });
        }),
        finalize(() => this.loading.set(false))
      )
      .subscribe((res) => {
        this.results.set(res.chunks || []);
      });
  }
}
