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
      <div class="mb-4" style="color:var(--text-muted)">
        @if (icon === 'alert') {
          <lucide-icon [img]="icons.AlertCircle" class="w-12 h-12"></lucide-icon>
        } @else if (icon === 'package') {
          <lucide-icon [img]="icons.Package" class="w-12 h-12"></lucide-icon>
        } @else {
          <lucide-icon [img]="icons.Info" class="w-12 h-12"></lucide-icon>
        }
      </div>
      <p class="text-base font-medium" style="color:var(--text-secondary)">{{ message }}</p>
      @if (submessage) {
        <p class="text-sm mt-2" style="color:var(--text-muted)">{{ submessage }}</p>
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
