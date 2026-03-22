import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Search } from 'lucide-angular';

/**
 * Dashboard global search component
 */
@Component({
  selector: 'app-dashboard-search',
  template: `
    <div class="card overflow-hidden">
      <div class="flex items-center px-4">
        <lucide-icon [img]="icons.Search"
          class="w-4 h-4 flex-shrink-0" style="color:var(--text-muted)">
        </lucide-icon>
        <input type="text"
          placeholder="Search articles, codes, procedures..."
          (input)="onSearchChange($event)"
          [value]="searchTerm"
          class="w-full bg-transparent border-none py-3.5 px-3 focus:ring-0 text-sm outline-none font-medium"
          style="color:var(--text-primary)" />
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
