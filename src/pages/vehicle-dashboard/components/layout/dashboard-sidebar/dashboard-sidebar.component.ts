import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideAngularModule, House, TriangleAlert, FileText, Cable, Wrench, ClipboardList, Package, LogOut, MapPin, Calendar, User, LogIn, CreditCard } from 'lucide-angular';

import { SectionAvailability } from '../../../../../services/vehicle-data.service';
import { AuthService } from '../../../../../services/auth.service';

export type DashboardSection = 'overview' | 'dtcs' | 'tsbs' | 'diagrams' | 'component-locations' | 'procedures' | 'parts' | 'specs' | 'maintenance' | 'browse-all';

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
    /** Ask parent layout to open the global auth modal. */
    @Output() openAuthModal = new EventEmitter<void>();

    protected authService = inject(AuthService);

    readonly icons = { House, TriangleAlert, FileText, Cable, Wrench, ClipboardList, Package, LogOut, MapPin, Calendar, User, LogIn, CreditCard };

    onSectionClick(section: DashboardSection) {
        this.sectionChange.emit(section);
    }

    onOpenAuthClick() {
        this.openAuthModal.emit();
    }

    async signOut() {
        await this.authService.signOut();
    }
}
