import { ChangeDetectionStrategy, Component, computed, inject, Signal, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, of } from 'rxjs';

import { MotorApiService } from '../../services/motor-api.service';

interface ArticleViewData {
  contentSource: string;
  vehicleId: string;
  content: SafeHtml;
}

@Component({
  selector: 'app-article-viewer',
  template: `
<div class="min-h-screen bg-gray-900 text-gray-300 p-4 sm:p-6 lg:p-8">
  <div class="max-w-4xl mx-auto">
    <div class="flex justify-between items-center mb-6">
      <a [routerLink]="['/vehicle', contentSource(), vehicleId()]" class="text-cyan-400 hover:text-cyan-300 inline-block">&larr; Back to Dashboard</a>
    </div>
    
    <div class="bg-gray-800/50 border border-gray-700 rounded-xl p-6 sm:p-8 lg:p-10">
      @if (!isLoading()) {
        <div class="motor-content" [innerHTML]="displayContent()"></div>
      } @else {
        <!-- Loading Skeleton -->
        <div class="space-y-4 animate-pulse">
          <div class="text-center text-cyan-300 mb-4">Loading article...</div>
          <div class="h-8 bg-gray-700 rounded w-3/4"></div>
          <div class="h-4 bg-gray-700 rounded w-full"></div>
          <div class="h-4 bg-gray-700 rounded w-5/6"></div>
          <div class="h-4 bg-gray-700 rounded w-full"></div>
          <div class="h-8 bg-gray-700 rounded w-1/2 mt-8"></div>
          <div class="h-4 bg-gray-700 rounded w-full"></div>
          <div class="h-4 bg-gray-700 rounded w-full"></div>
        </div>
      }
    </div>
  </div>
</div>
  `,
  styles: [`
.motor-content h1, .motor-content h2, .motor-content h3 {
  color: #22d3ee; /* cyan-400 */
  border-bottom: 1px solid #4b5563; /* gray-600 */
  padding-bottom: 0.5rem;
  margin-top: 1.5rem;
  margin-bottom: 1rem;
}
.motor-content p {
  margin-bottom: 1rem;
  line-height: 1.75;
}
.motor-content ul, .motor-content ol {
  margin-left: 1.5rem;
  margin-bottom: 1rem;
  list-style-position: outside;
}
.motor-content li {
  margin-bottom: 0.5rem;
}
.motor-content a {
  color: #67e8f9; /* cyan-300 */
  text-decoration: underline;
}
.motor-content table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 1rem;
}
.motor-content th, .motor-content td {
  border: 1px solid #4b5563; /* gray-600 */
  padding: 0.75rem;
  text-align: left;
}
.motor-content th {
  background-color: #1f2937; /* gray-800 */
}
.motor-content img {
  max-width: 100%;
  height: auto;
  border-radius: 0.5rem;
  margin-top: 1rem;
  margin-bottom: 1rem;
  border: 1px solid #4b5563;
}
.motor-content .note, .motor-content .caution, .motor-content .warning {
  padding: 1rem;
  margin-bottom: 1rem;
  border-left-width: 4px;
  border-radius: 0.25rem;
}
.motor-content .note {
  background-color: #1e3a8a; /* blue-900 */
  border-color: #3b82f6; /* blue-500 */
  color: #bfdbfe; /* blue-200 */
}
.motor-content .caution, .motor-content .warning {
  background-color: #b91c1c; /* red-700 */
  border-color: #ef4444; /* red-500 */
  color: #fecaca; /* red-200 */
}
/* Prose styles for Gemini content */
.prose table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1rem;
}
.prose th, .prose td {
    border: 1px solid #4b5563;
    padding: 0.75rem;
    text-align: left;
}
.prose th {
    background-color: #1f2937;
}
.prose ul, .prose ol {
    margin-left: 1.5rem;
    margin-bottom: 1rem;
}
  `],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule],
})
export class ArticleViewerComponent {
  private route = inject(ActivatedRoute);
  private motorApi = inject(MotorApiService);
  private sanitizer = inject(DomSanitizer);

  // --- Data Signal from Route ---
  private viewData: Signal<ArticleViewData | null>;

  // --- Derived Signals for Template ---
  readonly contentSource: Signal<string>;
  readonly vehicleId: Signal<string>;
  readonly isLoading: Signal<boolean>;
  readonly displayContent: Signal<SafeHtml | string>;

  constructor() {
    this.viewData = toSignal(
      this.route.paramMap.pipe(
        switchMap(params => {
          const contentSource = params.get('contentSource');
          const vehicleId = params.get('vehicleId');
          const articleId = params.get('articleId');
    
          if (contentSource && vehicleId && articleId) {
            return this.motorApi.getArticleContent(contentSource, vehicleId, articleId).pipe(
              map(content => ({
                contentSource,
                vehicleId,
                content: this.processAndSanitizeHtml(content),
              } as ArticleViewData))
            );
          }
          return of(null);
        })
      ), { initialValue: null }
    );

    this.contentSource = computed(() => this.viewData()?.contentSource ?? '');
    this.vehicleId = computed(() => this.viewData()?.vehicleId ?? '');
    this.isLoading = computed(() => this.viewData() === null);
    this.displayContent = computed(() => this.viewData()?.content ?? '');
  }

  private processAndSanitizeHtml(html: string): SafeHtml {
    if (!html) return '';
    const processedHtml = html.replace(/src="(\/api\/[^"]+)"/g, (match, relativePath) => {
        const fullUrl = this.motorApi.getGraphicUrl(relativePath);
        return `src="${fullUrl}"`;
    });
    return this.sanitizer.bypassSecurityTrustHtml(processedHtml);
  }
}