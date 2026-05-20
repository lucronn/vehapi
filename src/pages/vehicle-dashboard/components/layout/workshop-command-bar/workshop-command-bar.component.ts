import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Search, ChevronRight } from 'lucide-angular';
import type { DashboardSection } from '../../../vehicle-dashboard.component';

const SECTION_LABEL: Partial<Record<DashboardSection, string>> = {
  overview: 'Workshop hub',
  dtcs: 'Diagnostic codes',
  tsbs: 'Service bulletins',
  diagrams: 'Wiring diagrams',
  'component-locations': 'Component locations',
  procedures: 'Procedures',
  parts: 'Parts catalog',
  specs: 'Specifications',
  maintenance: 'Maintenance',
  'browse-all': 'Full catalog',
  'common-issues': 'Common issues',
};

@Component({
  selector: 'app-workshop-command-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div class="workshop-cmd-bar">
      <div class="workshop-cmd-bar-inner">
        <div class="workshop-cmd-bar-trail min-w-0">
          <span class="workshop-cmd-vehicle truncate">{{ vehicleName() || 'Vehicle' }}</span>
          <lucide-icon [img]="icons.ChevronRight" class="w-3.5 h-3.5 shrink-0 text-faint"></lucide-icon>
          <span class="workshop-cmd-section truncate">{{ sectionLabel() }}</span>
        </div>
        <button type="button" class="workshop-cmd-trigger" (click)="openCommands.emit()">
          <lucide-icon [img]="icons.Search" class="w-4 h-4 shrink-0"></lucide-icon>
          <span class="truncate">Search &amp; jump…</span>
          <kbd class="workshop-cmd-kbd">⌘K</kbd>
        </button>
      </div>
    </div>
  `,
})
export class WorkshopCommandBarComponent {
  readonly vehicleName = input('');
  readonly activeSection = input<DashboardSection>('overview');

  readonly openCommands = output<void>();

  readonly icons = { Search, ChevronRight };

  sectionLabel(): string {
    return SECTION_LABEL[this.activeSection()] ?? 'Workshop';
  }
}
