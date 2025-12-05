import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, of } from 'rxjs';

import { MotorApiService } from '../../services/motor-api.service';

@Component({
  selector: 'app-article-viewer',
  templateUrl: './article-viewer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule],
})
export class ArticleViewerComponent {
  private route = inject(ActivatedRoute);
  private motorApi = inject(MotorApiService);
  private sanitizer = inject(DomSanitizer);

  params = toSignal(this.route.paramMap);
  contentSource = computed(() => this.params()?.get('contentSource') ?? '');
  vehicleId = computed(() => this.params()?.get('vehicleId') ?? '');
  articleId = computed(() => this.params()?.get('articleId') ?? '');

  private articleContent$ = this.route.paramMap.pipe(
    switchMap(params => {
      const contentSource = params.get('contentSource');
      const vehicleId = params.get('vehicleId');
      const articleId = params.get('articleId');
      if (contentSource && vehicleId && articleId) {
        return this.motorApi.getArticleContent(contentSource, vehicleId, articleId);
      }
      return of('');
    }),
    map(html => {
        if (!html) return '';
        // Find all relative image paths and replace them with absolute URLs
        const processedHtml = html.replace(/src="(\/api\/[^"]+)"/g, (match, relativePath) => {
            const fullUrl = this.motorApi.getGraphicUrl(relativePath.substring(1));
            return `src="${fullUrl}"`;
        });
        // Trust the processed HTML to be rendered correctly
        return this.sanitizer.bypassSecurityTrustHtml(processedHtml);
    })
  );

  articleContent = toSignal(this.articleContent$);
}
