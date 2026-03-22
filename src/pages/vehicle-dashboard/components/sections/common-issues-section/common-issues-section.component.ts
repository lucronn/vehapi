import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AiRewriteService } from '../../../../../services/ai-rewrite.service';
import { CommonIssue } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, Lightbulb, AlertCircle, CheckCircle2, Wrench, ArrowRight, Lock, Unlock, Sparkles } from 'lucide-angular';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { WindowManagerService } from '../../../../../services/window-manager.service';
import { ArticleViewerComponent } from '../../../../article-viewer/article-viewer.component';
import { CreditsService } from '../../../../../services/credits.service';

/**
 * Displays common vehicle issues with AI-generated solutions
 */
@Component({
    selector: 'app-common-issues-section',
    templateUrl: './common-issues-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, LoadingSkeletonComponent, LucideAngularModule],
    standalone: true
})
export class CommonIssuesSectionComponent implements OnInit {
    @Input({ required: true }) vehicleName!: string;
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;

    private aiRewrite = inject(AiRewriteService);
    private sanitizer = inject(DomSanitizer);
    private windowManager = inject(WindowManagerService);
    private router = inject(Router);
    protected creditsService = inject(CreditsService);

    commonIssues = signal<CommonIssue[]>([]);
    isLoading = signal(false);
    isSolutionLoading = signal<Set<string>>(new Set());
    solutions = signal<Map<string, SafeHtml>>(new Map());
    hasAttemptedLoad = false;
    isUnlocking = signal(false);

    // Pagination state
    displayLimit = signal(50);

    // Computed property to return only the items we should show right now
    // If locked, we only show a tiny preview slice to save DOM/GPU memory for the blur effect
    displayedCommonIssues = signal<CommonIssue[]>([]);

    readonly icons = { Lightbulb, AlertCircle, CheckCircle2, Wrench, ArrowRight, Lock, Unlock, Sparkles };

    ngOnInit() {
        this.loadIssues();
    }

    private loadIssues() {
        if (this.commonIssues().length > 0 || this.hasAttemptedLoad) return;
        this.hasAttemptedLoad = true;
        this.isLoading.set(true);

        // Fetch common issues via AI rewriting service
        this.aiRewrite.generateCommonIssues(this.vehicleName).subscribe({
            next: (issues) => {
                this.commonIssues.set(issues);
                this.updateDisplayedCommonIssues();
                this.isLoading.set(false);
            },
            error: (err) => {
                console.error('Failed to load common issues', err);
                this.isLoading.set(false);
            }
        });
    }

    private updateDisplayedCommonIssues() {
        const hasAccess = this.creditsService.hasAccess(this.vehicleId, 'common_issues');
        const limit = hasAccess ? this.displayLimit() : 8; // Only 8 items if locked (preview)
        this.displayedCommonIssues.set(this.commonIssues().slice(0, limit));
    }

    loadMore() {
        this.displayLimit.update(v => v + 50);
        this.updateDisplayedCommonIssues();
    }

    async unlockSection() {
        if (this.isUnlocking()) return;

        const cost = this.creditsService.COSTS.COMMON_ISSUES;
        if (this.creditsService.balance() < cost) {
            alert('Insufficient credits. Please purchase more.');
            return;
        }

        if (confirm(`Unlock Common Issues & AI Solutions for ${cost} credits?`)) {
            this.isUnlocking.set(true);
            const success = await this.creditsService.unlockModule(this.vehicleId, this.vehicleName, 'common_issues', cost);
            this.isUnlocking.set(false);

            if (!success) {
                alert('Unlock failed. Please try again.');
            } else {
                // Update display since we are now unlocked
                this.updateDisplayedCommonIssues();
            }
        }
    }

    generateSolution(issueTitle: string): void {
        if (!this.creditsService.hasAccess(this.vehicleId, 'common_issues')) {
            this.unlockSection();
            return;
        }

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

        if (this.windowManager.isDesktop()) {
            this.windowManager.openWindow(
                `Issue: ${issueTitle}`,
                ArticleViewerComponent,
                {
                    articleTitleInput: issueTitle,
                    htmlContentInput: htmlContent
                }
            );
        } else {
            // For mobile, navigate and pass content via history state
            this.router.navigate(['/vehicle', this.contentSource, this.vehicleId, 'article', 'issue-' + encodeURIComponent(issueTitle)], {
                state: {
                    title: issueTitle,
                    content: htmlContent
                }
            });
        }
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
