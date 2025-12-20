// FIX: Import 'signal' from '@angular/core'
import { ChangeDetectionStrategy, Component, computed, inject, signal, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, of, forkJoin, tap, catchError, from } from 'rxjs';

import { MotorApiService } from '../../services/motor-api.service';
import { GeminiService } from '../../services/gemini.service';
import { FirebaseService } from '../../services/firebase.service';

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
  public geminiApi = inject(GeminiService); // Public for template access
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

  private firebase = inject(FirebaseService);

  private articleData$ = this.route.paramMap.pipe(
    switchMap(params => {
      const contentSource = params.get('contentSource');
      const vehicleId = params.get('vehicleId');
      const articleId = params.get('articleId');

      if (contentSource && vehicleId && articleId) {
        this.isRewriting.set(true);

        // 1. Check Cache First
        return from(this.firebase.getArticle(articleId)).pipe(
          switchMap(storedArticle => {
            if (storedArticle) {
              // CACHE HIT
              console.log('Cache Hit: Loading from Firebase');
              const processedOriginal = this.processAndSanitizeHtml(storedArticle.originalContent);
              const processedRewritten = this.processAndSanitizeHtml(storedArticle.enhancedContent);

              this.originalContent.set(processedOriginal);
              this.rewrittenContent.set(processedRewritten);
              this.isRewriting.set(false);
              return of({ original: processedOriginal, rewritten: processedRewritten });
            } else {
              // CACHE MISS - Fetch & Generate
              console.log('Cache Miss: Fetching from API');
              return forkJoin({
                title: this.motorApi.getArticleTitle(contentSource, vehicleId, articleId).pipe(
                  catchError(() => of({ body: articleId } as any))
                ),
                content: this.motorApi.getArticleContent(contentSource, vehicleId, articleId)
              }).pipe(
                map(({ title, content }) => {
                  const originalHtml = this.processAndSanitizeHtml(content.body.html);

                  // UPDATED LOGIC: Disable AI for now, Show Original Immediately & SAVE it
                  this.originalContent.set(originalHtml);
                  this.showOriginal.set(true);
                  this.isRewriting.set(false);

                  // SAVE TO FIREBASE (Build Database by Usage)
                  this.firebase.saveArticle({
                    id: articleId,
                    title: title.body,
                    originalContent: content.body.html,
                    enhancedContent: '', // Empty if not rewritten
                    vehicleId: vehicleId,
                    source: contentSource,
                    timestamp: Date.now()
                  });

                  return { original: originalHtml, rewritten: '' };
                })
              );
            }
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
    const processedHtml = html.replace(/src=["'](\/?api\/[^"']+)["']/g, (match, relativePath) => {
      const fullUrl = this.motorApi.getGraphicUrl(relativePath);
      return `src="${fullUrl}"`;
    });
    return this.sanitizer.bypassSecurityTrustHtml(processedHtml);
  }
}
