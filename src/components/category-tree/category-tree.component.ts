import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, FileText, ChevronRight, ChevronDown, FolderOpen, Folder, TriangleAlert, Cable, Wrench, Settings, MapPin, Calendar, Box, Lightbulb, ClipboardList } from 'lucide-angular';
import { CategoryTreeService, TreeNode } from '../../services/category-tree.service';

/**
 * Shared category tree for sidebar and mobile menu.
 * Shows article titles for selective purchase before unlock.
 */
@Component({
    selector: 'app-category-tree',
    templateUrl: './category-tree.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, LucideAngularModule],
    standalone: true,
})
export class CategoryTreeComponent {
    protected categoryTreeService = inject(CategoryTreeService);

    @Input() compact = false; // Use for mobile menu
    @Output() articleSelected = new EventEmitter<{ id: string; bucket?: string; parentBucket?: string }>();

    treeNodes = this.categoryTreeService.categoryTree;

    readonly icons = {
        FileText, ChevronRight, ChevronDown, FolderOpen, Folder,
        TriangleAlert, Cable, Wrench, Settings, MapPin, Calendar, Box, Lightbulb, ClipboardList
    };

    expandedNodes = signal<Set<string>>(new Set<string>());

    getIcon(node: TreeNode): any {
        const name = node.name.toLowerCase();
        if (name.includes('dtc') || name.includes('fault') || name.includes('trouble')) return TriangleAlert;
        if (name.includes('bulletin') || name.includes('tsb')) return FileText;
        if (name.includes('procedure') || name.includes('repair') || name.includes('labor') || name.includes('wrench')) return Wrench;
        if (name.includes('spec') || name.includes('fluid') || name.includes('setting')) return Settings;
        if (name.includes('location')) return MapPin;
        if (name.includes('maintenance') || name.includes('service') || name.includes('calendar')) return Calendar;
        if (name.includes('part') || name.includes('box')) return Box;
        if (name.includes('issue') || name.includes('bulb')) return Lightbulb;
        if (name.includes('diagram') || name.includes('cable')) return Cable;
        return ClipboardList;
    }

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

    onArticleClick(node: TreeNode) {
        const article = node.type === 'article' ? node.article : null;
        this.articleSelected.emit(article
            ? { id: article.id, bucket: article.bucket, parentBucket: article.parentBucket }
            : { id: node.id });
    }
}
