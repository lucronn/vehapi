import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Search } from 'lucide-angular';

/**
 * Dashboard global search component
 */
@Component({
    selector: 'app-dashboard-search',
    template: `
    <div class="app-container mb-6 sm:mb-8">
      <div class="relative app-surface-muted p-3">
        <input type="text" 
          placeholder="Global Search (e.g., 'brake caliper', 'P0300')" 
          (input)="onSearchChange($event)"
          [value]="searchTerm"
          class="app-input pl-12 text-base sm:text-lg" />
        <lucide-icon [img]="icons.Search" 
          class="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400">
        </lucide-icon>
      </div>
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, LucideAngularModule],
    standalone: true
})
export class DashboardSearchComponent {
    @Input() searchTerm: string = '';
    @Output() searchChange = new EventEmitter<string>();

    readonly icons = { Search };

    onSearchChange(event: Event) {
        const value = (event.target as HTMLInputElement).value;
        this.searchChange.emit(value);
    }
}
