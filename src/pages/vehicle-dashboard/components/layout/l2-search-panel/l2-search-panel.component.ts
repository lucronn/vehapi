import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MotorApiService, L2SearchChunk, L2SearchResponse } from '../../../../../services/motor-api.service';
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
  /** Non-error explanation (e.g. no chunks indexed yet). */
  readonly emptyHint = signal<string | null>(null);
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
    this.emptyHint.set(null);
    this.loading.set(true);
    this.hasSearched.set(true);
    this.motorApi
      .l2Search(this.vehicleId(), q, 8)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          const body = err.error as { error?: string; code?: string } | undefined;
          const raw = body?.error || err.message || 'Search failed';
          const msg = typeof raw === 'string' ? raw : 'Search failed';
          const code = body?.code;
          let friendly = msg;
          if (code === 'L2_DISABLED') {
            friendly =
              'Knowledge search is disabled on the server. Operator: set ENABLE_L2_EMBEDDINGS=true plus EMBEDDING_MODEL (and NVIDIA API key) on vehapiproxi.';
          } else if (code === 'L2_UNLOCK_REQUIRED') {
            friendly = 'Unlock any module for this vehicle (credits), then try knowledge search again.';
          } else if (code === 'L2_EMBEDDING_CONFIG') {
            friendly = `${msg} Typical fix: set EMBEDDING_MODEL (e.g. nvidia/nv-embedqa-e5-v5) and NVIDIA_API_KEY on the proxy.`;
          } else if (code === 'L2_EMBEDDING_DIM_MISMATCH') {
            friendly = `${msg} The DB RPC uses vector(1024); set L2_EMBEDDING_DIMS to match your embedding model or adjust the migration.`;
          } else if (code === 'L2_RPC_OR_SCHEMA') {
            friendly = `${msg} Apply documentation/migrations/20260321_match_content_chunks_rpc.sql and L2 content_chunk pgvector migration in Supabase.`;
          }
          this.error.set(friendly);
          return of({ chunks: [] as L2SearchChunk[], code } satisfies L2SearchResponse);
        }),
        finalize(() => this.loading.set(false))
      )
      .subscribe((res: L2SearchResponse) => {
        this.results.set(res.chunks || []);
        if ((res.chunks?.length ?? 0) === 0 && res.hint) {
          this.emptyHint.set(res.hint);
        }
      });
  }
}
