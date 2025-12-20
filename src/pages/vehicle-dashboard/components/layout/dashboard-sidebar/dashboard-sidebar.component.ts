import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideAngularModule, House, TriangleAlert, FileText, Cable, Wrench, ClipboardList } from 'lucide-angular';

export type DashboardSection = 'overview' | 'dtcs' | 'tsbs' | 'diagrams' | 'procedures' | 'specs';

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
    @Output() sectionChange = new EventEmitter<DashboardSection>();

    readonly icons = { House, TriangleAlert, FileText, Cable, Wrench, ClipboardList };

    onSectionClick(section: DashboardSection) {
        this.sectionChange.emit(section);
    }
}
