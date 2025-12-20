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
            <div class="h-10 w-10 bg-gray-700 rounded-full"></div>
            <div class="flex-1 space-y-2">
              <div class="h-4 bg-gray-700 rounded w-3/4"></div>
              <div class="h-3 bg-gray-700 rounded w-1/2"></div>
            </div>
          </div>
        }
      } @else if (type === 'card') {
        @for (item of items; track $index) {
          <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
            <div class="h-6 bg-gray-700 rounded w-2/3"></div>
            <div class="h-4 bg-gray-700 rounded w-full"></div>
            <div class="h-4 bg-gray-700 rounded w-4/5"></div>
          </div>
        }
      } @else if (type === 'grid') {
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          @for (item of items; track $index) {
            <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
              <div class="h-5 bg-gray-700 rounded w-3/4"></div>
              <div class="h-4 bg-gray-700 rounded w-full"></div>
            </div>
          }
        </div>
      } @else {
        <div class="space-y-2">
          <div class="h-4 bg-gray-700 rounded w-full"></div>
          <div class="h-4 bg-gray-700 rounded w-5/6"></div>
          <div class="h-4 bg-gray-700 rounded w-4/5"></div>
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
