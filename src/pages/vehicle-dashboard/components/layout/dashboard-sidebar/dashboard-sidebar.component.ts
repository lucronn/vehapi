import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideAngularModule, House, TriangleAlert, FileText, Package, LogOut, MapPin, Calendar, User, LogIn, CreditCard, Lightbulb, Wrench } from 'lucide-angular';

import { SectionAvailability } from '../../../../../services/vehicle-data.service';
import { AuthService } from '../../../../../services/auth.service';
import { CategoryTreeComponent } from '../../../../../components/category-tree/category-tree.component';

export type DashboardSection = 'overview' | 'dtcs' | 'tsbs' | 'diagrams' | 'component-locations' | 'procedures' | 'parts' | 'specs' | 'maintenance' | 'browse-all' | 'common-issues';

/**
 * Dashboard sidebar navigation component
 */
@Component({
    selector: 'app-dashboard-sidebar',
    templateUrl: './dashboard-sidebar.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RouterModule, LucideAngularModule, CategoryTreeComponent],
    standalone: true,
    host: { class: 'contents' }
})
export class DashboardSidebarComponent {
    @Input({ required: true }) vehicleName!: string;
    @Input({ required: true }) activeSection!: DashboardSection;
    @Input() availableSections: SectionAvailability | null = null;
    @Output() sectionChange = new EventEmitter<DashboardSection>();
    @Output() articleSelected = new EventEmitter<{ id: string; bucket?: string; parentBucket?: string }>();
    @Output() openAuthModal = new EventEmitter<void>();

    protected authService = inject(AuthService);

    readonly icons = { House, TriangleAlert, FileText, Package, LogOut, MapPin, Calendar, User, LogIn, CreditCard, Lightbulb, Wrench };

    onArticleFromTree(payload: { id: string; bucket?: string; parentBucket?: string }) {
        this.articleSelected.emit(payload);
        this.sectionChange.emit('browse-all');
    }

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
