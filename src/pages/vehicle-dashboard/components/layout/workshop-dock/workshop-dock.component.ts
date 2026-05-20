import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, House, TriangleAlert, Wrench, Package, Command } from 'lucide-angular';
import type { DashboardSection } from '../../../vehicle-dashboard.component';

@Component({
  selector: 'app-workshop-dock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <nav class="workshop-dock" aria-label="Workshop quick navigation">
      <button type="button" class="workshop-dock-btn" [class.active]="activeSection() === 'overview'"
        (click)="sectionChange.emit('overview')">
        <lucide-icon [img]="icons.House" class="w-5 h-5"></lucide-icon>
        <span>Hub</span>
      </button>

      @if (showDtcs()) {
      <button type="button" class="workshop-dock-btn" [class.active]="activeSection() === 'dtcs'"
        (click)="sectionChange.emit('dtcs')">
        <lucide-icon [img]="icons.TriangleAlert" class="w-5 h-5"></lucide-icon>
        <span>Codes</span>
      </button>
      }

      @if (showService()) {
      <button type="button" class="workshop-dock-btn"
        [class.active]="activeSection() === serviceSection()"
        (click)="sectionChange.emit(serviceSection())">
        <lucide-icon [img]="icons.Wrench" class="w-5 h-5"></lucide-icon>
        <span>Service</span>
      </button>
      }

      <button type="button" class="workshop-dock-cmd" (click)="openCommands.emit()"
        aria-label="Open command palette">
        <lucide-icon [img]="icons.Command" class="w-5 h-5"></lucide-icon>
      </button>
    </nav>
  `,
})
export class WorkshopDockComponent {
  readonly activeSection = input.required<DashboardSection>();
  readonly showDtcs = input(true);
  readonly showService = input(true);
  readonly serviceSection = input<DashboardSection>('procedures');

  readonly sectionChange = output<DashboardSection>();
  readonly openCommands = output<void>();

  readonly icons = { House, TriangleAlert, Wrench, Package, Command };
}
