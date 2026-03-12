import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

export type SkeletonType = 'list' | 'card' | 'text' | 'grid';

/**
 * Reusable loading skeleton component
 * Displays animated placeholder UI while content is loading
 */
@Component({
  selector: 'app-loading-skeleton',
  template: `
    <div class="animate-pulse space-y-4">
      @if (type === 'list') {
        @for (item of items; track $index) {
          <div class="flex items-center space-x-4">
            <div class="h-10 w-10 rounded-full" style="background:var(--bg-muted)"></div>
            <div class="flex-1 space-y-2">
              <div class="h-4 rounded w-3/4" style="background:var(--bg-muted)"></div>
              <div class="h-3 rounded w-1/2" style="background:var(--bg-muted)"></div>
            </div>
          </div>
        }
      } @else if (type === 'card') {
        @for (item of items; track $index) {
          <div class="rounded-lg p-4 space-y-3" style="background:var(--bg-surface);border:1px solid var(--border)">
            <div class="h-6 rounded w-2/3" style="background:var(--bg-muted)"></div>
            <div class="h-4 rounded w-full" style="background:var(--bg-muted)"></div>
            <div class="h-4 rounded w-4/5" style="background:var(--bg-muted)"></div>
          </div>
        }
      } @else if (type === 'grid') {
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          @for (item of items; track $index) {
            <div class="rounded-lg p-4 space-y-3" style="background:var(--bg-surface);border:1px solid var(--border)">
              <div class="h-5 rounded w-3/4" style="background:var(--bg-muted)"></div>
              <div class="h-4 rounded w-full" style="background:var(--bg-muted)"></div>
            </div>
          }
        </div>
      } @else {
        <div class="space-y-2">
          <div class="h-4 rounded w-full" style="background:var(--bg-muted)"></div>
          <div class="h-4 rounded w-5/6" style="background:var(--bg-muted)"></div>
          <div class="h-4 rounded w-4/5" style="background:var(--bg-muted)"></div>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true
})
export class LoadingSkeletonComponent {
  @Input() type: SkeletonType = 'list';
  @Input() count: number = 3;

  get items(): number[] {
    return Array(this.count).fill(0);
  }
}
