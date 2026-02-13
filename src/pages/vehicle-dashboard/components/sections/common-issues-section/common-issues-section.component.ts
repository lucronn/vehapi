import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
// import { GeminiService } from '../../../../../services/gemini.service'; // Removed
import { FirebaseService } from '../../../../../services/firebase.service';
import { CommonIssue } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, Lightbulb, AlertCircle, CheckCircle2, Wrench, ArrowRight } from 'lucide-angular';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { WindowManagerService } from '../../../../../services/window-manager.service';
import { ArticleViewerComponent } from '../../../../article-viewer/article-viewer.component';

/**
 * Displays common vehicle issues with AI-generated solutions
 */
@Component({
    selector: 'app-common-issues-section',
    templateUrl: './common-issues-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, LoadingSkeletonComponent, EmptyStateComponent, LucideAngularModule],
    standalone: true
})
export class CommonIssuesSectionComponent implements OnInit {
    @Input({ required: true }) vehicleName!: string;
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;

    // private geminiApi = inject(GeminiService); // Removed
    private firebase = inject(FirebaseService);
    private sanitizer = inject(DomSanitizer);
    private windowManager = inject(WindowManagerService);

    commonIssues = signal<CommonIssue[]>([]);
    isLoading = signal(false);
    isSolutionLoading = signal<Set<string>>(new Set());
    solutions = signal<Map<string, SafeHtml>>(new Map());
    hasAttemptedLoad = false;

    readonly icons = { Lightbulb, AlertCircle, CheckCircle2, Wrench, ArrowRight };

    ngOnInit() {
        this.loadIssues();
    }

    private loadIssues() {
        if (this.commonIssues().length > 0 || this.hasAttemptedLoad) return;

        this.hasAttemptedLoad = true;
        this.isLoading.set(true);

        this.firebase.getCommonIssues(this.contentSource, this.vehicleId).then(cached => {
            if (cached && cached.length > 0) {
                console.log('[Cache Hit] Common Issues');
                this.commonIssues.set(cached);
                this.isLoading.set(false);
            } else {
                console.log('[Cache Miss] Common Issues (No Source)');
                this.isLoading.set(false);
                // AI fallback removed. User must rely on cache or manual entry if not in cache.
            }
        }).catch(err => {
            console.error('Failed to load common issues', err);
            this.isLoading.set(false);
        });
    }

    generateSolution(issueTitle: string): void {
        // For now, we simulate a solution or use the description.
        // In a real scenario, we might fetch this from the API or AI.
        const issue = this.commonIssues().find(i => i.title === issueTitle);
        const description = issue?.description || 'No description available.';
        const htmlContent = `
            <div class="p-4">
                <h3>${issueTitle}</h3>
                <p>${description}</p>
                <hr class="my-4"/>
                <p><strong>Suggested Action:</strong> Please consult the service manual or a certified technician for detailed diagnostic procedures related to this issue.</p>
            </div>
        `;

        this.windowManager.openWindow(
            `Issue: ${issueTitle}`,
            ArticleViewerComponent,
            {
                articleTitleInput: issueTitle,
                htmlContentInput: htmlContent
            }
        );
    }

    getSeverityColor(severity: string): string {
        const colors: Record<string, string> = {
            'High': 'text-red-500',
            'Medium': 'text-amber-500',
            'Low': 'text-green-500'
        };
        return colors[severity] || 'text-[hsl(var(--text-muted))]';
    }

    trackByTitle(index: number, issue: CommonIssue): string {
        return issue.title || index.toString();
    }
}
