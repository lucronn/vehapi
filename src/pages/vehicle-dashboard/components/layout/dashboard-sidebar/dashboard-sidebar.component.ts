import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideAngularModule, House, TriangleAlert, FileText, Cable, Wrench, ClipboardList, Package, LogOut, MapPin, Calendar, User, LogIn, CreditCard, Settings, Box, Lightbulb, Lock } from 'lucide-angular';

import { SectionAvailability } from '../../../../../services/vehicle-data.service';
import { AuthService } from '../../../../../services/auth.service';
import { CreditsService } from '../../../../../services/credits.service';
import { LogoComponent } from '../../../../../components/logo/logo.component';

export type DashboardSection = 'overview' | 'dtcs' | 'tsbs' | 'diagrams' | 'component-locations' | 'procedures' | 'parts' | 'specs' | 'maintenance' | 'browse-all' | 'common-issues';

@Component({
    selector: 'app-dashboard-sidebar',
    templateUrl: './dashboard-sidebar.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RouterModule, LucideAngularModule, LogoComponent],
    standalone: true,
    host: { class: 'contents' }
})
export class DashboardSidebarComponent {
    @Input({ required: true }) vehicleName!: string;
    @Input({ required: true }) vehicleId!: string;
    @Input({ required: true }) activeSection!: DashboardSection;
    @Input() availableSections: SectionAvailability | null = null;
    @Output() sectionChange = new EventEmitter<DashboardSection>();
    @Output() openAuthModal = new EventEmitter<void>();

    protected authService = inject(AuthService);
    protected creditsService = inject(CreditsService);

    readonly icons = { House, TriangleAlert, FileText, Cable, Wrench, ClipboardList, Package, LogOut, MapPin, Calendar, User, LogIn, CreditCard, Settings, Box, Lightbulb, Lock };

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
