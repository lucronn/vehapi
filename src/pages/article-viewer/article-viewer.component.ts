import { ChangeDetectionStrategy, Component, computed, inject, signal, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, of, catchError } from 'rxjs';

import { MotorApiService } from '../../services/motor-api.service';
import { LucideAngularModule, ArrowLeft, Maximize2, List, X } from 'lucide-angular';

export interface TableOfContents {
  id: string;
  title: string;
  level: number;
}

import { ImageViewerModalComponent } from './components/image-viewer-modal/image-viewer-modal.component';

@Component({
  selector: 'app-article-viewer',
  templateUrl: './article-viewer.component.html',
  styleUrls: ['./article-viewer.component.css'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule, LucideAngularModule, ImageViewerModalComponent],
})
export class ArticleViewerComponent {
  private route = inject(ActivatedRoute);
  private motorApi = inject(MotorApiService);
  private sanitizer = inject(DomSanitizer);

  readonly icons = { ArrowLeft, Maximize2, List, X };

  params = toSignal(this.route.paramMap);
  contentSource = computed(() => this.params()?.get('contentSource') ?? '');
  vehicleId = computed(() => this.params()?.get('vehicleId') ?? '');
  articleId = computed(() => this.params()?.get('articleId') ?? '');

  articleTitle = signal<string>('');
  articleContent = signal<SafeHtml>('');
  sections = signal<TableOfContents[]>([]);
  isMobileTocOpen = signal(false);

  selectedImageUrl = signal<string | null>(null);

  private articleData$ = this.route.paramMap.pipe(
    switchMap(params => {
      const contentSource = params.get('contentSource');
      const vehicleId = params.get('vehicleId');
      const articleId = params.get('articleId');

      if (contentSource && vehicleId && articleId) {
        return this.motorApi.getArticleTitle(contentSource, vehicleId, articleId).pipe(
          catchError(() => of({ body: articleId } as any)),
          switchMap(title => {
            return this.motorApi.getArticleContent(contentSource, vehicleId, articleId).pipe(
              map(content => {
                const rawTitle = title?.body || articleId || '';
                const cleanTitle = this.cleanTitle(rawTitle);
                const { html: processedHtml, sections } = this.processHtml(content.body.html, contentSource, vehicleId);

                this.articleTitle.set(cleanTitle);
                this.articleContent.set(processedHtml);
                this.sections.set(sections);

                return { title: cleanTitle, content: processedHtml };
              })
            );
          })
        );
      }
      return of(null);
    })
  );

  articleData = toSignal(this.articleData$);

  private cleanTitle(rawTitle: string): string {
    if (!rawTitle) return '';
    const cleaned = rawTitle.replace(/ID:\s*[A-Z]:[\w\-:]+/i, '').trim();
    const veryShort = cleaned.replace(/Section\s+\d{3}-\d{2}[\sA-Za-z-]*$/i, '').trim();
    return veryShort || cleaned || rawTitle;
  }

  private processHtml(html: string, contentSource: string, vehicleId: string): { html: SafeHtml, sections: TableOfContents[] } {
    if (!html) return { html: '', sections: [] };

    let processed = this.motorApi.processHtmlContent(html, contentSource, vehicleId);

    processed = processed.replace(/\s(style|bgcolor|text|color|border|cellpadding|cellspacing|align|valign)=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    processed = processed.replace(/<font[^>]*>/gi, '').replace(/<\/font>/gi, '');
    processed = processed.replace(/<(table|tr|td|div|p|span)\s+[^>]*>/gi, (match) => {
      return match.replace(/\s(width|height)=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    });

    const sections: TableOfContents[] = [];
    let headerCount = 0;

    processed = processed.replace(/<(h[1-3])([^>]*)>(.*?)<\/\1>/gi, (match, tag, attrs, content) => {
      const plainTitle = content.replace(/<[^>]+>/g, '').trim();
      if (!plainTitle) return match;

      const level = parseInt(tag.charAt(1), 10);
      const id = `section-${headerCount++}`;
      sections.push({ id, title: plainTitle, level });

      let newAttrs = attrs;
      if (newAttrs.includes('class=')) {
        newAttrs = newAttrs.replace(/class=["']([^"']*)["']/, `class="$1 enhanced-${tag}" id="${id}"`);
      } else {
        newAttrs += ` class="enhanced-${tag}" id="${id}"`;
      }

      return `<${tag}${newAttrs}>${content}</${tag}>`;
    });

    return {
      html: this.sanitizer.bypassSecurityTrustHtml(processed),
      sections
    };
  }

  onContentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.tagName === 'IMG') {
      const img = target as HTMLImageElement;
      this.selectedImageUrl.set(img.src);
    }
  }

  closeImageViewer() {
    this.selectedImageUrl.set(null);
  }

  scrollToSection(id: string) {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this.isMobileTocOpen.set(false);
    }
  }

  toggleMobileToc() {
    this.isMobileTocOpen.update(v => !v);
  }
}
