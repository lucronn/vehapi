import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideAngularModule, House, TriangleAlert, FileText, Cable, Wrench, ClipboardList, Package, LogOut, MapPin, Calendar, User, LogIn, CreditCard, ChevronRight, ChevronDown, FolderOpen, Folder, Settings, Box, Lightbulb, Info } from 'lucide-angular';

import { SectionAvailability } from '../../../../../services/vehicle-data.service';
import { AuthService } from '../../../../../services/auth.service';
import { CategoryTreeService, TreeNode } from '../../../../../services/category-tree.service';

export type DashboardSection = 'overview' | 'dtcs' | 'tsbs' | 'diagrams' | 'component-locations' | 'procedures' | 'parts' | 'specs' | 'maintenance' | 'browse-all' | 'common-issues';

/**
 * Dashboard sidebar navigation component
 */
@Component({
    selector: 'app-dashboard-sidebar',
    templateUrl: './dashboard-sidebar.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RouterModule, LucideAngularModule],
    standalone: true,
    host: { class: 'contents' }
})
export class DashboardSidebarComponent {
    @Input({ required: true }) vehicleName!: string;
    @Input({ required: true }) activeSection!: DashboardSection;
    @Input() availableSections: SectionAvailability | null = null;
    @Output() sectionChange = new EventEmitter<DashboardSection>();
    @Output() articleSelected = new EventEmitter<string>(); // Emits article ID
    /** Ask parent layout to open the global auth modal. */
    @Output() openAuthModal = new EventEmitter<void>();

    protected authService = inject(AuthService);
    protected categoryTreeService = inject(CategoryTreeService);

    // Get the tree data
    treeNodes = this.categoryTreeService.categoryTree;

    readonly icons = { House, TriangleAlert, FileText, Cable, Wrench, ClipboardList, Package, LogOut, MapPin, Calendar, User, LogIn, CreditCard, ChevronRight, ChevronDown, FolderOpen, Folder, Settings, Box, Lightbulb, Info };

    getIcon(nodeOrName: TreeNode | string): any {
        const name = typeof nodeOrName === 'string' ? nodeOrName.toLowerCase() : nodeOrName.name.toLowerCase();
        
        if (name.includes('dtc') || name.includes('fault') || name.includes('trouble')) return TriangleAlert;
        if (name.includes('bulletin') || name.includes('tsb')) return FileText;
        if (name.includes('procedure') || name.includes('repair') || name.includes('labor') || name.includes('wrench')) return Wrench;
        if (name.includes('spec') || name.includes('fluid') || name.includes('setting')) return Settings;
        if (name.includes('location')) return MapPin;
        if (name.includes('maintenance') || name.includes('service') || name.includes('calendar')) return Calendar;
        if (name.includes('part') || name.includes('box')) return Box;
        if (name.includes('issue') || name.includes('bulb')) return Lightbulb;
        if (name.includes('diagram') || name.includes('cable')) return Cable;
        
        return ClipboardList; // Default icon
    }

    // Set to keep track of open nodes
    expandedNodes = signal<Set<string>>(new Set<string>());

    toggleNode(nodeId: string, event: Event) {
        event.stopPropagation();
        const current = new Set(this.expandedNodes());
        if (current.has(nodeId)) {
            current.delete(nodeId);
        } else {
            current.add(nodeId);
        }
        this.expandedNodes.set(current);
    }

    isNodeExpanded(nodeId: string): boolean {
        return this.expandedNodes().has(nodeId);
    }

    onArticleClick(articleId: string) {
        this.articleSelected.emit(articleId);
        this.sectionChange.emit('browse-all'); // Switch main view to browse-all or a dedicated article view
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
