import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from '../../../../../services/gemini.service';
import { FirebaseService } from '../../../../../services/firebase.service';
import { CommonIssue } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, Lightbulb, AlertCircle, CheckCircle2 } from 'lucide-angular';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

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

    private geminiApi = inject(GeminiService);
    private firebase = inject(FirebaseService);
    private sanitizer = inject(DomSanitizer);

    commonIssues = signal<CommonIssue[]>([]);
    isLoading = signal(false);
    isSolutionLoading = signal<Set<string>>(new Set());
    solutions = signal<Map<string, SafeHtml>>(new Map());
    hasAttemptedLoad = false;

    readonly icons = { Lightbulb, AlertCircle, CheckCircle2 };

    ngOnInit() {
        this.loadIssues();
    }

    private loadIssues() {
        // TEMPORARILY DISABLED: Common Issues feature requires AI (Gemini API)
        // Skipping this feature when AI is disabled

        // if (this.commonIssues().length > 0 || this.hasAttemptedLoad) return;

        // this.hasAttemptedLoad = true;
        // this.isLoading.set(true);

        // this.firebase.getCommonIssues(this.contentSource, this.vehicleId).then(cached => {
        //   if (cached && cached.length > 0) {
        //     console.log('[Cache Hit] Common Issues');
        //     this.commonIssues.set(cached);
        //     this.isLoading.set(false);
        //   } else {
        //     console.log('[Cache Miss] Common Issues (AI)');
        //     this.geminiApi.findCommonIssues(this.vehicleName).subscribe({
        //       next: (issues) => {
        //         this.commonIssues.set(issues);
        //         this.isLoading.set(false);
        //         if (issues.length > 0) {
        //           this.firebase.saveCommonIssues(this.contentSource, this.vehicleId, issues);
        //         }
        //       },
        //       error: (err) => {
        //         console.error('Failed to load common issues', err);
        //         this.isLoading.set(false);
        //       }
        //     });
        //   }
        // });

        // Set loading to false immediately
        this.isLoading.set(false);
    }

    generateSolution(issueTitle: string): void {
        // TEMPORARILY DISABLED: Solution generation requires AI (Gemini API)
        // if (this.solutions().has(issueTitle)) return;

        // this.isSolutionLoading.update(set => {
        //   const newSet = new Set(set);
        //   newSet.add(issueTitle);
        //   return newSet;
        // });

        // this.geminiApi.generateSolution(issueTitle, this.vehicleName).subscribe({
        //   next: (solution) => {
        //     this.solutions().update(map => {
        //       const newMap = new Map(map);
        //       newMap.set(issueTitle, this.sanitizer.bypassSecurityTrustHtml(solution));
        //       return newMap;
        //     });

        //     this.isSolutionLoading.update(set => {
        //       const newSet = new Set(set);
        //       newSet.delete(issueTitle);
        //       return newSet;
        //     });
        //   },
        //   error: (err) => {
        //     console.error('Failed to generate solution', err);
        //     this.isSolutionLoading.update(set => {
        //       const newSet = new Set(set);
        //       newSet.delete(issueTitle);
        //       return newSet;
        //     });
        //   }
        // });
    }

    getSeverityColor(severity: string): string {
        const colors: Record<string, string> = {
            'High': 'text-red-500',
            'Medium': 'text-amber-500',
            'Low': 'text-green-500'
        };
        return colors[severity] || 'text-gray-500';
    }

    trackByTitle(index: number, issue: CommonIssue): string {
        return issue.title || index.toString();
    }
}
