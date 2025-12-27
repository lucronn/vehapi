import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideAngularModule, House, TriangleAlert, FileText, Cable, Wrench, ClipboardList, Package } from 'lucide-angular';

import { SectionAvailability } from '../../../../../services/vehicle-data.service';

export type DashboardSection = 'overview' | 'dtcs' | 'tsbs' | 'diagrams' | 'component-locations' | 'procedures' | 'parts' | 'specs' | 'maintenance';

/**
 * Dashboard sidebar navigation component
 */
@Component({
    selector: 'app-dashboard-sidebar',
    templateUrl: './dashboard-sidebar.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RouterModule, LucideAngularModule],
    standalone: true
})
export class DashboardSidebarComponent {
    @Input({ required: true }) vehicleName!: string;
    @Input({ required: true }) activeSection!: DashboardSection;
    @Input() availableSections: SectionAvailability | null = null;
    @Output() sectionChange = new EventEmitter<DashboardSection>();

    readonly icons = { House, TriangleAlert, FileText, Cable, Wrench, ClipboardList, Package };

    onSectionClick(section: DashboardSection) {
        this.sectionChange.emit(section);
    }
}
