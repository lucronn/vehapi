import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { LucideAngularModule, ArrowLeft } from 'lucide-angular';

import { L2SearchPanelComponent } from '../vehicle-dashboard/components/layout/l2-search-panel/l2-search-panel.component';

@Component({
  selector: 'app-knowledge-search',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule, LucideAngularModule, L2SearchPanelComponent],
  template: `
    <div class="min-h-screen" style="background:var(--bg);color:var(--text-primary)">
      <header class="sticky top-0 z-50"
        style="background:var(--bg-surface);border-bottom:1px solid var(--border);padding-top:env(safe-area-inset-top, 0px);padding-left:env(safe-area-inset-left, 0px);padding-right:env(safe-area-inset-right, 0px);">
        <div class="max-w-5xl xl:max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <a [routerLink]="['/vehicle', contentSource(), vehicleId()]"
            class="group flex items-center gap-2 text-xs font-medium transition-all" style="color:var(--text-muted)">
            <lucide-icon [img]="icons.ArrowLeft"
              class="w-4 h-4 group-hover:-translate-x-1 transition-transform"></lucide-icon>
            <span>Back</span>
          </a>
          <div class="text-xs font-mono uppercase tracking-[0.2em]" style="color:var(--text-muted)">Knowledge</div>
          <div class="w-10"></div>
        </div>
      </header>

      <main class="max-w-5xl xl:max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6"
        style="padding-bottom:calc(2rem + env(safe-area-inset-bottom, 0px));">
        <div class="mb-4">
          <h1 class="text-xl font-heading font-bold">Knowledge Search</h1>
          <p class="text-sm mt-1" style="color:var(--text-muted)">
            Semantic search over embedded article text for this vehicle.
          </p>
        </div>

        <app-l2-search-panel [contentSource]="contentSource()" [vehicleId]="vehicleId()"></app-l2-search-panel>
      </main>
    </div>
  `
})
export class KnowledgeSearchComponent {
  private route = inject(ActivatedRoute);
  private params = toSignal(this.route.paramMap);

  readonly contentSource = computed(() => this.params()?.get('contentSource') ?? '');
  readonly vehicleId = computed(() => this.params()?.get('vehicleId') ?? '');

  readonly icons = { ArrowLeft };
}

