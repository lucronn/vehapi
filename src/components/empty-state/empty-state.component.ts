import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, AlertCircle, Info, Package } from 'lucide-angular';

export type EmptyStateIcon = 'alert' | 'info' | 'package';

/**
 * Reusable empty state component
 * Displays when no data is available or an error occurred
 */
@Component({
    selector: 'app-empty-state',
    template: `
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <div class="mb-4 text-gray-500">
        @if (icon === 'alert') {
          <lucide-icon [img]="icons.AlertCircle" class="w-16 h-16"></lucide-icon>
        } @else if (icon === 'package') {
          <lucide-icon [img]="icons.Package" class="w-16 h-16"></lucide-icon>
        } @else {
          <lucide-icon [img]="icons.Info" class="w-16 h-16"></lucide-icon>
        }
      </div>
      <p class="text-lg font-medium text-gray-400">{{ message }}</p>
      @if (submessage) {
        <p class="text-sm text-gray-500 mt-2">{{ submessage }}</p>
      }
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [LucideAngularModule],
    standalone: true
})
export class EmptyStateComponent {
    @Input() message: string = 'No data available';
    @Input() submessage?: string;
    @Input() icon: EmptyStateIcon = 'info';

    readonly icons = { AlertCircle, Info, Package };
}
