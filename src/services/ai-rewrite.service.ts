import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, timeout } from 'rxjs';
import { TutorialStep, CommonIssue } from '../models/motor.models';
import { getMotorProxyBaseUrl } from '../utils/motor-api.constants';

/** Result of {@link AiRewriteService.rewriteArticleHtml} */
export interface ArticleRewriteResult {
    html: string;
    /** True when the API explicitly reports AI unavailable (e.g. missing LLM env on Vercel). */
    aiUnavailable?: boolean;
}

/** Result of {@link AiRewriteService.generateCommonIssues} */
export interface CommonIssuesResult {
    issues: CommonIssue[];
    aiUnavailable?: boolean;
}

/**
 * Service for AI-powered content rewriting and tutorial generation.
 * Calls the vehapiproxi endpoints /api/rewrite and /api/tutorials/generate.
 */
@Injectable({ providedIn: 'root' })
export class AiRewriteService {
    private http = inject(HttpClient);
    private readonly baseUrl = getMotorProxyBaseUrl();

    /**
     * Rewrites article HTML text content using AI while preserving structure and media.
     * Falls back to the original HTML if the service is unavailable or rewriting fails.
     *
     * @param html - Raw article HTML from the Motor API
     * @param title - Article title used as context for the AI
     * @returns Observable that emits the rewritten HTML (or the original on failure)
     */
    rewriteArticleHtml(html: string, title = ''): Observable<ArticleRewriteResult> {
        if (!html || !html.trim()) {
            return of({ html });
        }
        return this.http.post<{ html: string }>(
            `${this.baseUrl}/api/rewrite`,
            { html, title }
        ).pipe(
            timeout(30_000),
            map((res): ArticleRewriteResult => ({ html: res?.html || html })),
            catchError((err: HttpErrorResponse): Observable<ArticleRewriteResult> => {
                const aiUnavailable = err?.status === 503;
                return of({ html, aiUnavailable });
            })
        );
    }

    /**
     * Generates interactive step-by-step tutorial steps from article HTML.
     * Returns an empty array if the service is unavailable or generation fails.
     *
     * @param html - Processed article HTML
     * @param title - Article title used as context for the AI
     * @returns Observable that emits an array of TutorialStep objects
     */
    generateTutorialSteps(html: string, title = ''): Observable<TutorialStep[]> {
        if (!html || !html.trim()) {
            return of([]);
        }
        return this.http.post<{ steps: TutorialStep[] }>(
            `${this.baseUrl}/api/tutorials/generate`,
            { html, title }
        ).pipe(
            timeout(60_000),
            map(res => res?.steps || []),
            catchError(() => of([]))
        );
    }

    /**
     * Generates common issues for a given vehicle using AI.
     * When vehicleId is provided, the backend queries Supabase for DTCs, TSBs,
     * procedures, specs, and maintenance to ground the LLM output in real data.
     */
    generateCommonIssues(vehicleName: string, vehicleId?: string): Observable<CommonIssuesResult> {
        if (!vehicleName || !vehicleName.trim()) {
            return of({ issues: [] });
        }
        return this.http.post<{ issues: CommonIssue[] }>(
            `${this.baseUrl}/api/common-issues/generate`,
            { vehicleMetadata: { vehicleName, vehicleId } }
        ).pipe(
            timeout(60_000),
            map((res): CommonIssuesResult => ({ issues: res?.issues || [] })),
            catchError((err: HttpErrorResponse): Observable<CommonIssuesResult> => {
                const aiUnavailable = err?.status === 503;
                if (!aiUnavailable) {
                    console.error('Failed to generate common issues:', err);
                }
                return of({ issues: [], aiUnavailable });
            })
        );
    }
}
