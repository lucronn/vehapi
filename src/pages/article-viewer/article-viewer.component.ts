import { ChangeDetectionStrategy, Component, computed, inject, Input, signal, ViewEncapsulation, OnInit, OnChanges, SimpleChanges, SecurityContext } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, of, catchError, Subject, takeUntil } from 'rxjs';
import { HttpClient } from '@angular/common/http';

import { MotorApiService } from '../../services/motor-api.service';
import { MotorHtmlProcessorService } from '../../services/motor-html-processor.service';
import { AiRewriteService } from '../../services/ai-rewrite.service';
import { LucideAngularModule, ArrowLeft, Maximize2, List, X, Sparkles, BookOpen } from 'lucide-angular';
import { ImageViewerModalComponent } from './components/image-viewer-modal/image-viewer-modal.component';
import { TutorialComponent } from '../../components/tutorial/tutorial.component';
import { TutorialStep } from '../../models/motor.models';
import { WindowManagerService } from '../../services/window-manager.service';

export interface TableOfContents {
  id: string;
  title: string;
  level: number;
}

// Optimized Regex Constants
const LEGACY_ATTR_REGEX = /\s(?:style|text|align|valign|b(?:gcolor|order)|c(?:olor|ell(?:padding|spacing)))=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const FONT_TAG_REGEX = /<\/?font[^>]*>/gi;
const SPECIFIC_TAG_REGEX = /<(?:table|tr|td|div|p|span)\s+[^>]*>/gi;
const WIDTH_HEIGHT_REGEX = /\s(?:width|height)=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

// Helper to remove width/height from specific tags
function cleanSpecificTag(match: string): string {
  // Rely on regex replacement which is efficient and handles case-insensitivity correctly
  return match.replace(WIDTH_HEIGHT_REGEX, '');
}

@Component({
  selector: 'app-article-viewer',
  templateUrl: './article-viewer.component.html',
  styleUrls: ['./article-viewer.component.css'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule, LucideAngularModule, ImageViewerModalComponent, TutorialComponent],
  standalone: true
})
export class ArticleViewerComponent implements OnInit, OnChanges {
  // Inputs for Window Mode
  @Input() contentSource?: string;
  @Input() vehicleId?: string;
  @Input() articleId?: string;
  @Input() articleTitleInput?: string;
  @Input() htmlContentInput?: string; // New input for direct content
  @Input() windowId?: string; // ID of the window if in window mode

  private route = inject(ActivatedRoute);
  private motorApi = inject(MotorApiService);
  private motorHtml = inject(MotorHtmlProcessorService);
  private aiRewrite = inject(AiRewriteService);
  private sanitizer = inject(DomSanitizer);
  private windowManager = inject(WindowManagerService);

  readonly icons = { ArrowLeft, Maximize2, List, X, Sparkles, BookOpen };

  // Use a Subject to trigger data loading when inputs change or on init
  private loadTrigger = new Subject<void>();

  // State
  private internalArticleId = signal<string | null>(null);
  articleTitle = signal<string>('');
  articleContent = signal<string>('');
  sections = signal<TableOfContents[]>([]);
  isMobileTocOpen = signal(false);
  isLoading = signal(false);
  error = signal<string | null>(null);
  articleSubtitle = signal<string>('');

  selectedImageUrl = signal<string | null>(null);
  pdfDataUri = signal<SafeResourceUrl | null>(null); // Set when article is a PDF
  isRetrying = signal(false); // Re-auth in progress
  retryCount = signal(0);
  params = toSignal(this.route.paramMap);

  // AI rewriting & tutorial state
  isRewriting = signal(false);
  tutorialSteps = signal<TutorialStep[]>([]);
  isGeneratingTutorial = signal(false);
  showTutorial = signal(false);

  /** Raw processed HTML kept for tutorial generation */
  protected rawHtmlForTutorial = '';

  private http = inject(HttpClient);

  // Signal-safe accessors for template — fall back to route params when inputs are undefined
  contentSourceSig = computed(() => this.contentSource || this.params()?.get('contentSource') || '');
  vehicleIdSig = computed(() => this.vehicleId || this.params()?.get('vehicleId') || '');

  ngOnChanges(changes: SimpleChanges) {
    if (changes['articleId']) {
      this.internalArticleId.set(this.articleId!);
    }

    if (changes['articleId'] || changes['vehicleId'] || changes['contentSource']) {
      // If we have all required inputs, load data
      if (this.contentSource && this.vehicleId && this.internalArticleId()) {
        console.log('[ArticleViewer] Inputs changed, loading data:', {
          source: this.contentSource,
          vehicle: this.vehicleId,
          article: this.internalArticleId()
        });
        this.loadData();
      }
    }
  }

  ngOnInit() {
    // Check if we have inputs or need to read from route
    console.log('[ArticleViewer] Init with inputs:', {
      source: this.contentSource,
      vehicle: this.vehicleId,
      article: this.articleId
    });

    if (this.articleId) {
      this.internalArticleId.set(this.articleId);
    }

    // Check for passed state (from direct navigation on mobile)
    const state = typeof window !== 'undefined' ? window.history.state : null;
    if (state && state.content) {
      this.htmlContentInput = state.content;
      if (state.title) this.articleTitleInput = state.title;
      console.log('[ArticleViewer] Loaded content from history state');
    }

    if (!this.contentSource || !this.vehicleId || !this.internalArticleId()) {
      this.route.paramMap.subscribe(params => {
        this.contentSource = params.get('contentSource') ?? '';
        this.vehicleId = params.get('vehicleId') ?? '';
        const aid = params.get('articleId') ?? '';
        this.internalArticleId.set(aid);

        console.log('[ArticleViewer] Loaded params from route:', {
          source: this.contentSource,
          vehicle: this.vehicleId,
          article: aid
        });

        // Also check query params for title
        this.route.queryParamMap.subscribe(qp => {
          const title = qp.get('title');
          if (title && !this.articleTitleInput) {
            this.articleTitleInput = title;
            this.articleTitle.set(this.cleanTitle(title));
          }
          this.loadData();
        });
      });
    } else {
      this.loadData();
    }

    if (this.articleTitleInput) {
      this.articleTitle.set(this.cleanTitle(this.articleTitleInput));
    }

    if (this.htmlContentInput) {
      this.articleContent.set(this.sanitizer.sanitize(SecurityContext.HTML, this.htmlContentInput) || '');
      this.isLoading.set(false);
      return;
    }
  }

  loadData() {
    if (this.htmlContentInput) {
      // If we have content input, we might still need to parse sections
      const { sections } = this.processHtml(this.htmlContentInput, this.contentSource || '', this.vehicleId || '');
      this.sections.set(sections);
      return;
    }
    const aid = this.internalArticleId();
    if (!this.contentSource || !this.vehicleId || !aid) return;

    this.isLoading.set(true);
    this.error.set(null);

    // Fetch Title if not provided
    if (!this.articleTitleInput) {
      this.motorApi.getArticleTitle(this.contentSource, this.vehicleId, aid).subscribe({
        next: (res) => {
          const rawTitle = res.body || aid || '';
          const cleaned = this.cleanTitle(rawTitle);
          this.articleTitle.set(cleaned);
          if (this.windowId) {
            this.windowManager.updateTitle(this.windowId, cleaned);
          }
        },
        error: () => this.articleTitle.set('Article')
      });
    }

    // Fetch Content
    this.motorApi.getArticleContent(this.contentSource, this.vehicleId, aid).subscribe({
      next: (content) => {
        if (!content || !content.body || !(content.body as any).html) {
          console.error('[ArticleViewer] API returned empty content body or html');
        }

        const rawHtml = (content.body as any)?.html || '';
        const pdfUri = (content.body as any)?.pdfDataUri || null;

        if (pdfUri) {
          // PDF content — set safe URI for inline viewer, clear HTML
          this.pdfDataUri.set(this.sanitizer.bypassSecurityTrustResourceUrl(pdfUri));
          this.articleContent.set('');
          this.sections.set([]);
          this.isLoading.set(false);
          return;
        }

        this.pdfDataUri.set(null);
        const { htmlString, safeHtml, sections } = this.processHtml(rawHtml, this.contentSource!, this.vehicleId!);

        if (!htmlString || htmlString.trim() === '') {
          this.articleContent.set('');
        } else {
          // Show original content immediately (progressive enhancement)
          this.articleContent.set(safeHtml);
          // Store for tutorial generation
          this.rawHtmlForTutorial = htmlString;
          // Reset tutorial state when loading a new article
          this.tutorialSteps.set([]);
          this.showTutorial.set(false);
          // Trigger AI rewriting in the background
          this.triggerAiRewrite(htmlString);
        }

        this.sections.set(sections);
        this.isLoading.set(false);
        // Reset scroll position when loading new article content in modal
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { }
      },
      error: (err) => {
        console.error('[ArticleViewer] Failed to load article:', err);
        const status = err?.status;

        if ((status === 401 || status === 403) && this.retryCount() < 3) {
          // Auth expired — proxy is re-authenticating, poll and retry
          this.isRetrying.set(true);
          this.retryCount.update(n => n + 1);
          this.pollAndRetry();
        } else {
          this.isRetrying.set(false);
          this.retryCount.set(0);
          // Extract clean message without exposing proxy URLs
          let msg = 'Could not load this article.';
          if (status === 404) msg = 'Article not found.';
          else if (status === 401 || status === 403) msg = 'Session expired. Please refresh and try again.';
          else if (status === 500) msg = 'Server error — the data service is temporarily unavailable.';
          else if (status === 0) msg = 'Network error — check your connection and try again.';
          this.error.set(msg);
          this.isLoading.set(false);
        }
      }
    });
  }

  /** Poll /auth/status until ready, then re-attempt loadData */
  private pollAndRetry() {
    const baseUrl = this.motorApi.baseUrl;
    let attempts = 0;
    const maxAttempts = 20; // ~10s

    const poll = () => {
      if (attempts++ > maxAttempts) {
        this.isRetrying.set(false);
        this.error.set('Re-authentication timed out. Please refresh the page.');
        this.isLoading.set(false);
        return;
      }

      this.http.get<any>(`${baseUrl}/auth/status`).subscribe({
        next: (status) => {
          if (status?.status === 'success' || status?.sessionValid === true) {
            console.log('[ArticleViewer] Auth restored, retrying article load...');
            this.isRetrying.set(false);
            this.loadData();
          } else {
            // Not ready yet, poll again in 800ms
            setTimeout(poll, 800);
          }
        },
        error: () => setTimeout(poll, 1000)
      });
    };

    setTimeout(poll, 1000); // Give it 1s head start
  }

  /** Rewrites article HTML in the background and updates content when done */
  private triggerAiRewrite(htmlString: string) {
    if (!htmlString) return;
    this.isRewriting.set(true);
    this.aiRewrite.rewriteArticleHtml(htmlString, this.articleTitle()).subscribe({
      next: (rewritten) => {
        if (rewritten && rewritten !== htmlString) {
          const safe = this.sanitizer.sanitize(SecurityContext.HTML, rewritten) || '';
          if (safe) {
            this.articleContent.set(safe);
            this.rawHtmlForTutorial = rewritten;
          }
        }
        this.isRewriting.set(false);
      },
      error: () => this.isRewriting.set(false)
    });
  }

  /** Generates tutorial steps from the current article HTML */
  startTutorial() {
    if (this.isGeneratingTutorial()) return;
    const html = this.rawHtmlForTutorial;
    if (!html) return;
    this.isGeneratingTutorial.set(true);
    this.showTutorial.set(false);
    this.aiRewrite.generateTutorialSteps(html, this.articleTitle()).subscribe({
      next: (steps) => {
        this.tutorialSteps.set(steps);
        this.showTutorial.set(steps.length > 0);
        this.isGeneratingTutorial.set(false);
      },
      error: () => this.isGeneratingTutorial.set(false)
    });
  }

  closeTutorial() {
    this.showTutorial.set(false);
  }

  private cleanTitle(rawTitle: string): string {
    if (!rawTitle) return '';
    // Remove internal IDs like "ID: X:ABC-123"
    let cleaned = rawTitle.replace(/ID:\s*[A-Z]:[\w\-:]+/i, '').trim();
    // Remove section refs like "Section 303-01A"
    cleaned = cleaned.replace(/Section\s+\d{3}-\d{2}[\sA-Za-z-]*$/i, '').trim();

    // Handle pipe-delimited titles: "PART A | PART B; date range"
    if (cleaned.includes('|') || cleaned.includes(';')) {
      // Split on pipe first
      const pipeParts = cleaned.split('|').map(s => s.trim()).filter(Boolean);
      const primary = pipeParts[0] || cleaned;
      const rest = pipeParts.slice(1).join(' — ');

      // From the rest, strip date/year ranges like "2018 – 2020 MY Camry"
      const subtitleParts = rest
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !/^\d{4}\s*[–\-]\s*\d{4}/i.test(s));

      const subtitle = subtitleParts.join(' — ');
      this.articleSubtitle.set(subtitle);

      // Title-case the primary part: "AIR CONDITIONING SYSTEM" → "Air Conditioning System"
      return this.toTitleCase(primary);
    }

    this.articleSubtitle.set('');
    return cleaned || rawTitle;
  }

  private toTitleCase(str: string): string {
    if (!str) return '';
    // If it's all uppercase, convert to title case
    if (str === str.toUpperCase() && str.length > 3) {
      const minorWords = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
      return str.toLowerCase().split(/\s+/).map((word, i) => {
        if (i === 0 || !minorWords.has(word)) {
          return word.charAt(0).toUpperCase() + word.slice(1);
        }
        return word;
      }).join(' ');
    }
    return str;
  }

  private processHtml(html: string, contentSource: string, vehicleId: string): { htmlString: string, safeHtml: string, sections: TableOfContents[] } {
    if (!html) return { htmlString: '', safeHtml: '', sections: [] };

    let processed = this.motorHtml.processHtmlContent(html, contentSource, vehicleId);

    // Remove legacy attributes
    processed = processed.replace(LEGACY_ATTR_REGEX, '');
    processed = processed.replace(FONT_TAG_REGEX, '');
    processed = processed.replace(SPECIFIC_TAG_REGEX, cleanSpecificTag);

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
      htmlString: processed,
      safeHtml: this.sanitizer.sanitize(SecurityContext.HTML, processed) || '',
      sections
    };
  }

  onContentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;

    // Handle image clicks
    if (target.tagName === 'IMG') {
      const img = target as HTMLImageElement;
      this.selectedImageUrl.set(img.src);
      return;
    }

    // Handle link clicks (intercept for window mode)
    const anchor = target.closest('a');
    if (anchor) {
      const href = anchor.getAttribute('href');
      // Intercept if it's an internal article link (starts with #/vehicle/)
      if (href && href.startsWith('#/vehicle/') && href.includes('/article/')) {
        // If we have an articleId input, we are in a modal window
        if (this.articleId) {
          event.preventDefault();
          const parts = href.split('/article/');
          if (parts.length > 1) {
            const newArticleId = parts[1];
            console.log('[ArticleViewer] Intercepted link click in modal. Switching to article:', newArticleId);
            this.internalArticleId.set(newArticleId);
            this.articleTitleInput = undefined; // Clear existing title input to force reload
            this.loadData();
          }
        }
      }
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
