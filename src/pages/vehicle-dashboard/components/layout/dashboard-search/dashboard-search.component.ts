import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Search } from 'lucide-angular';

/**
 * Dashboard global search component
 */
@Component({
    selector: 'app-dashboard-search',
    template: `
    <div class="max-w-5xl mx-auto mb-8">
      <div class="relative">
        <input type="text" 
          placeholder="Global Search (e.g., 'brake caliper', 'P0300')" 
          (input)="onSearchChange($event)"
          [value]="searchTerm"
          class="w-full p-4 pl-14 bg-black border-2 border-cyan-500/50 rounded-lg text-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all font-mono text-sm" />
        <lucide-icon [img]="icons.Search" 
          class="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-cyan-500">
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
