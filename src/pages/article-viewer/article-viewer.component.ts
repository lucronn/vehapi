import { ChangeDetectionStrategy, Component, computed, inject, Input, signal, ViewEncapsulation, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, of, catchError, Subject, takeUntil } from 'rxjs';

import { MotorApiService } from '../../services/motor-api.service';
import { LucideAngularModule, ArrowLeft, Maximize2, List, X } from 'lucide-angular';
import { ImageViewerModalComponent } from './components/image-viewer-modal/image-viewer-modal.component';

export interface TableOfContents {
  id: string;
  title: string;
  level: number;
}

@Component({
  selector: 'app-article-viewer',
  templateUrl: './article-viewer.component.html',
  styleUrls: ['./article-viewer.component.css'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule, LucideAngularModule, ImageViewerModalComponent],
  standalone: true
})
export class ArticleViewerComponent implements OnInit {
  // Inputs for Window Mode
  @Input() contentSource?: string;
  @Input() vehicleId?: string;
  @Input() articleId?: string;
  @Input() articleTitleInput?: string;
  @Input() htmlContentInput?: string; // New input for direct content

  private route = inject(ActivatedRoute);
  private motorApi = inject(MotorApiService);
  private sanitizer = inject(DomSanitizer);

  readonly icons = { ArrowLeft, Maximize2, List, X };

  // Use a Subject to trigger data loading when inputs change or on init
  private loadTrigger = new Subject<void>();

  // State
  articleTitle = signal<string>('');
  articleContent = signal<SafeHtml>('');
  sections = signal<TableOfContents[]>([]);
  isMobileTocOpen = signal(false);
  isLoading = signal(false);
  error = signal<string | null>(null);

  selectedImageUrl = signal<string | null>(null);

  ngOnInit() {
    // Check if we have inputs or need to read from route
    if (!this.contentSource || !this.vehicleId || !this.articleId) {
      this.route.paramMap.subscribe(params => {
        this.contentSource = params.get('contentSource') ?? '';
        this.vehicleId = params.get('vehicleId') ?? '';
        this.articleId = params.get('articleId') ?? '';
        this.loadData();
      });
    } else {
      this.loadData();
    }

    if (this.articleTitleInput) {
      this.articleTitle.set(this.articleTitleInput);
    }

    if (this.htmlContentInput) {
      this.articleContent.set(this.sanitizer.bypassSecurityTrustHtml(this.htmlContentInput));
      this.isLoading.set(false);
      return;
    }
  }

  loadData() {
    if (this.htmlContentInput) return; // Skip loading if we have direct content
    if (!this.contentSource || !this.vehicleId || !this.articleId) return;

    this.isLoading.set(true);
    this.error.set(null);

    // Fetch Title if not provided
    if (!this.articleTitleInput) {
      this.motorApi.getArticleTitle(this.contentSource, this.vehicleId, this.articleId).subscribe({
        next: (res) => {
          const rawTitle = res.body || this.articleId || '';
          this.articleTitle.set(this.cleanTitle(rawTitle));
        },
        error: () => this.articleTitle.set('Article')
      });
    }

    // Fetch Content
    this.motorApi.getArticleContent(this.contentSource, this.vehicleId, this.articleId).subscribe({
      next: (content) => {
        const { html: processedHtml, sections } = this.processHtml(content.body.html, this.contentSource!, this.vehicleId!);
        this.articleContent.set(processedHtml);
        this.sections.set(sections);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load article', err);
        this.error.set('Failed to load article content.');
        this.isLoading.set(false);
      }
    });
  }

  private cleanTitle(rawTitle: string): string {
    if (!rawTitle) return '';
    const cleaned = rawTitle.replace(/ID:\s*[A-Z]:[\w\-:]+/i, '').trim();
    const veryShort = cleaned.replace(/Section\s+\d{3}-\d{2}[\sA-Za-z-]*$/i, '').trim();
    return veryShort || cleaned || rawTitle;
  }

  private processHtml(html: string, contentSource: string, vehicleId: string): { html: SafeHtml, sections: TableOfContents[] } {
    if (!html) return { html: '', sections: [] };

    let processed = this.motorApi.processHtmlContent(html, contentSource, vehicleId);

    // Remove legacy attributes
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
