import { LoggerService } from '@/src/services/logger.service';
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
import { DataSyncService } from '../../../../../services/data-sync.service';

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

  private logger = inject(LoggerService);
    @Input({ required: true }) vehicleName!: string;
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;

    private aiRewrite = inject(AiRewriteService);
    private dataSync = inject(DataSyncService);
    private sanitizer = inject(DomSanitizer);
    private windowManager = inject(WindowManagerService);
    private router = inject(Router);
    protected creditsService = inject(CreditsService);

    commonIssues = signal<CommonIssue[]>([]);
    /** Set when /api/common-issues/generate returns 503 (missing LLM env, etc.). */
    aiUnavailable = signal(false);
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

    private async loadIssues() {
        if (this.commonIssues().length > 0 || this.hasAttemptedLoad) return;
        this.hasAttemptedLoad = true;
        this.isLoading.set(true);

        try {
            const cached = await this.dataSync.getCachedCommonIssues(this.vehicleId);
            if (cached?.length) {
                this.commonIssues.set(cached);
                this.updateDisplayedCommonIssues();
                this.isLoading.set(false);
                return;
            }
        } catch { /* cache miss — generate below */ }

        this.aiRewrite.generateCommonIssues(this.vehicleName, this.vehicleId).subscribe({
            next: ({ issues, aiUnavailable }) => {
                this.commonIssues.set(issues);
                this.aiUnavailable.set(!!aiUnavailable);
                this.updateDisplayedCommonIssues();
                this.isLoading.set(false);
                if (issues.length) {
                    void this.dataSync.lazySyncCommonIssues(this.contentSource, this.vehicleId, this.vehicleName, issues);
                }
            },
            error: (err) => {
                this.logger.error('Failed to load common issues', err);
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
            return;
        }

        this.isUnlocking.set(true);
        const success = await this.creditsService.unlockModule(this.vehicleId, this.vehicleName, 'common_issues', cost);
        this.isUnlocking.set(false);

        if (success) {
            this.updateDisplayedCommonIssues();
        }
    }

    async generateSolution(issueTitle: string): Promise<void> {
        if (!this.creditsService.hasAccess(this.vehicleId, 'common_issues')) {
            this.unlockSection();
            return;
        }

        const issue = this.commonIssues().find(i => i.title === issueTitle);
        const description = issue?.description || 'No description available.';
        const action = issue?.suggestedAction || description;
        const relatedIds = issue?.relatedArticleIds || [];

        let relatedHtml = '';
        if (relatedIds.length) {
            const resolvedMap = await this.dataSync.resolveRelatedLinks(this.vehicleId, relatedIds);
            const links = relatedIds.map(id => {
                const articleId = resolvedMap[id];
                if (articleId) {
                    const href = `#/vehicle/${this.contentSource}/${this.vehicleId}/article/${encodeURIComponent(articleId)}`;
                    return `<li class="text-[hsl(var(--accent-primary))]"><a href="${href}" class="text-accent hover:text-accent-deep underline">${id}</a></li>`;
                }
                return `<li class="text-[hsl(var(--accent-primary))]">${id}</li>`;
            }).join('');
            relatedHtml = `<div class="mt-4"><strong>Related:</strong><ul class="list-disc ml-4 mt-1">${links}</ul></div>`;
        }

        const symptomsHtml = issue?.symptoms?.length
            ? `<ul class="list-disc ml-4 mt-2 mb-4">${issue.symptoms.map(s => `<li>${s}</li>`).join('')}</ul>`
            : '';

        const htmlContent = `
            <div class="p-4">
                <h3>${issueTitle}</h3>
                <p>${description}</p>
                ${symptomsHtml}
                <hr class="my-4"/>
                <p><strong>Suggested Action:</strong> ${action}</p>
                ${relatedHtml}
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
