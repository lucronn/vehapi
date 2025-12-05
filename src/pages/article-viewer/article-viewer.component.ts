// FIX: Import 'signal' from '@angular/core'
import { ChangeDetectionStrategy, Component, computed, inject, signal, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, of, forkJoin, tap } from 'rxjs';

import { MotorApiService } from '../../services/motor-api.service';
import { GeminiService } from '../../services/gemini.service';

@Component({
  selector: 'app-article-viewer',
  templateUrl: './article-viewer.component.html',
  styleUrls: ['./article-viewer.component.css'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule],
})
export class ArticleViewerComponent {
  private route = inject(ActivatedRoute);
  private motorApi = inject(MotorApiService);
  private geminiApi = inject(GeminiService);
  private sanitizer = inject(DomSanitizer);

  params = toSignal(this.route.paramMap);
  contentSource = computed(() => this.params()?.get('contentSource') ?? '');
  vehicleId = computed(() => this.params()?.get('vehicleId') ?? '');
  articleId = computed(() => this.params()?.get('articleId') ?? '');

  // AI State
  showOriginal = signal(false);
  isRewriting = signal(true);
  originalContent = signal<SafeHtml>('');
  rewrittenContent = signal<SafeHtml>('');

  private articleData$ = this.route.paramMap.pipe(
    switchMap(params => {
      const contentSource = params.get('contentSource');
      const vehicleId = params.get('vehicleId');
      const articleId = params.get('articleId');

      if (contentSource && vehicleId && articleId) {
        this.isRewriting.set(true);
        // Fetch title and content in parallel
        return forkJoin({
          title: this.motorApi.getArticleTitle(contentSource, vehicleId, articleId),
          content: this.motorApi.getArticleContent(contentSource, vehicleId, articleId)
        }).pipe(
          switchMap(({ title, content }) => {
            const originalHtml = this.processAndSanitizeHtml(content);
            this.originalContent.set(originalHtml);
            
            // Now, rewrite the original, unprocessed content
            return this.geminiApi.rewriteArticle(title.body, content).pipe(
              map(rewrittenHtml => {
                const processedRewrittenHtml = this.processAndSanitizeHtml(rewrittenHtml);
                this.rewrittenContent.set(processedRewrittenHtml);
                this.isRewriting.set(false);
                return { original: originalHtml, rewritten: processedRewrittenHtml };
              })
            );
          })
        );
      }
      return of(null);
    })
  );

  articleData = toSignal(this.articleData$);

  displayContent = computed(() => {
    return this.showOriginal() ? this.originalContent() : this.rewrittenContent();
  });

  private processAndSanitizeHtml(html: string): SafeHtml {
    if (!html) return '';
    const processedHtml = html.replace(/src="(\/api\/[^"]+)"/g, (match, relativePath) => {
        const fullUrl = this.motorApi.getGraphicUrl(relativePath);
        return `src="${fullUrl}"`;
    });
    return this.sanitizer.bypassSecurityTrustHtml(processedHtml);
  }
}
