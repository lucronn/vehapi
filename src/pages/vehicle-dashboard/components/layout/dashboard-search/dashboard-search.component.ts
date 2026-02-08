import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Search } from 'lucide-angular';

/**
 * Dashboard global search component
 */
@Component({
  selector: 'app-dashboard-search',
  template: `
    <div class="relative group">
      <!-- Glow Background -->
      <div class="absolute -inset-1 bg-gradient-to-r from-[hsl(var(--accent-cyan))] to-[hsl(var(--accent-violet))] rounded-2xl blur opacity-10 group-focus-within:opacity-25 transition duration-500"></div>
      
      <div class="relative glass-card overflow-hidden animate-scan">
        <div class="flex items-center px-6">
            <lucide-icon [img]="icons.Search" 
                class="w-5 h-5 text-[hsl(var(--text-muted))] group-focus-within:text-[hsl(var(--accent-cyan))] transition-colors">
            </lucide-icon>
            <input type="text" 
                placeholder="Global System Search (e.g. 'brake torque', 'P0300', 'fuse box')" 
                (input)="onSearchChange($event)"
                [value]="searchTerm"
                class="w-full bg-transparent border-none text-white placeholder-white/20 py-5 px-4 focus:ring-0 text-sm md:text-md outline-none font-medium" />
            
            <div class="hidden md:flex items-center gap-2">
                <span class="px-2 py-1 rounded bg-white/5 border border-white/10 text-[8px] uppercase tracking-widest text-[hsl(var(--text-muted))]">CMD</span>
                <span class="px-2 py-1 rounded bg-white/5 border border-white/10 text-[8px] uppercase tracking-widest text-[hsl(var(--text-muted))]">K</span>
            </div>
        </div>
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
