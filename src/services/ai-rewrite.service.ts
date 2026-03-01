import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, timeout } from 'rxjs';
import { TutorialStep } from '../models/motor.models';
import { MOTOR_API_BASE_URL } from '../utils/motor-api.constants';

/**
 * Service for AI-powered content rewriting and tutorial generation.
 * Calls the vehapiproxi endpoints /api/rewrite and /api/tutorials/generate.
 */
@Injectable({ providedIn: 'root' })
export class AiRewriteService {
    private http = inject(HttpClient);
    private readonly baseUrl = MOTOR_API_BASE_URL;

    /**
     * Rewrites article HTML text content using AI while preserving structure and media.
     * Falls back to the original HTML if the service is unavailable or rewriting fails.
     *
     * @param html - Raw article HTML from the Motor API
     * @param title - Article title used as context for the AI
     * @returns Observable that emits the rewritten HTML (or the original on failure)
     */
    rewriteArticleHtml(html: string, title = ''): Observable<string> {
        if (!html || !html.trim()) {
            return of(html);
        }
        return this.http.post<{ html: string }>(
            `${this.baseUrl}/api/rewrite`,
            { html, title }
        ).pipe(
            timeout(30_000),
            map(res => res?.html || html),
            catchError(() => of(html))
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
}
