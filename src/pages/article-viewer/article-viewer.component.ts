import { ChangeDetectionStrategy, Component, computed, inject, Input, signal, ViewEncapsulation, OnInit, OnChanges, SimpleChanges, SecurityContext } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, of, catchError, Subject, takeUntil, Observable } from 'rxjs';

import { MotorApiService } from '../../services/motor-api.service';
import { MotorHtmlProcessorService } from '../../services/motor-html-processor.service';
import { AiRewriteService } from '../../services/ai-rewrite.service';
import { LucideAngularModule, ArrowLeft, Maximize2, List, X, Sparkles, BookOpen, Lock, RefreshCw } from 'lucide-angular';
import { CreditsModalComponent } from '../../components/credits-modal/credits-modal.component';
import { ImageViewerModalComponent } from './components/image-viewer-modal/image-viewer-modal.component';
import { TutorialComponent } from '../../components/tutorial/tutorial.component';
import { TutorialStep } from '../../models/motor.models';
import { WindowManagerService } from '../../services/window-manager.service';
import { DataSyncService } from '../../services/data-sync.service';
import { CreditsService } from '../../services/credits.service';
import { Router } from '@angular/router';

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
  @Input() htmlContentInput?: string;
  @Input() windowId?: string;
  @Input() moduleType?: string;

  private route = inject(ActivatedRoute);
  private motorApi = inject(MotorApiService);
  private motorHtml = inject(MotorHtmlProcessorService);
  private aiRewrite = inject(AiRewriteService);
  private sanitizer = inject(DomSanitizer);
  private windowManager = inject(WindowManagerService);
  private dataSync = inject(DataSyncService);
  protected creditsService = inject(CreditsService);
  private router = inject(Router);

  readonly icons = { ArrowLeft, Maximize2, List, X, Sparkles, BookOpen, Lock, RefreshCw };

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
  isCached = signal<boolean>(false);

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

  /** Whether content is locked behind a credit paywall */
  isLocked = computed(() => {
    const mod = this.resolvedModuleType();
    const vid = this.vehicleIdSig();
    const aid = this.internalArticleId();
    if (!vid) return false;
    // When moduleType is missing (e.g. direct URL), treat as locked to prevent bypass
    if (!mod) return true;
    return !this.creditsService.hasAccess(vid, mod, aid ?? undefined);
  });

  resolvedModuleType = signal<string | null>(null);

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
        this.loadData();
      }
    }
  }

  ngOnInit() {
    if (this.moduleType) {
      this.resolvedModuleType.set(this.moduleType);
    }

    if (this.articleId) {
      this.internalArticleId.set(this.articleId);
    }

    const state = typeof window !== 'undefined' ? window.history.state : null;
    if (state && state.content) {
      this.htmlContentInput = state.content;
      if (state.title) this.articleTitleInput = state.title;
    }

    if (!this.contentSource || !this.vehicleId || !this.internalArticleId()) {
      this.route.paramMap.subscribe(params => {
        this.contentSource = params.get('contentSource') ?? '';
        this.vehicleId = params.get('vehicleId') ?? '';
        const aid = params.get('articleId') ?? '';
        this.internalArticleId.set(aid);

        this.route.queryParamMap.subscribe(qp => {
          const title = qp.get('title');
          if (title && !this.articleTitleInput) {
            this.articleTitleInput = title;
            this.articleTitle.set(this.cleanTitle(title));
          }
          const mod = qp.get('moduleType');
          if (mod && !this.resolvedModuleType()) {
            this.resolvedModuleType.set(mod);
          }
          this.loadData();
        });
      });
    } else {
      this.loadData();
    }

    // Resolve moduleType from metadata when missing (e.g. direct URL)
    if (!this.resolvedModuleType() && this.contentSource && this.vehicleId && this.internalArticleId()) {
      this.motorApi.getArticleMetadata(this.contentSource, this.vehicleId, this.internalArticleId()!).subscribe({
        next: (meta) => {
          if (meta.moduleType) {
            this.resolvedModuleType.set(meta.moduleType);
            this.loadData(); // Retry load now that we know moduleType
          }
        },
        error: () => { /* ignore */ }
      });
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
      const { sections } = this.processHtml(this.htmlContentInput, this.contentSource || '', this.vehicleId || '');
      this.sections.set(sections);
      return;
    }
    const aid = this.internalArticleId();
    if (!this.contentSource || !this.vehicleId || !aid) return;

    if (this.isLocked()) {
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    this.error.set(null);
    this.isCached.set(false);

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
    const contentRequest$: Observable<any> = String(aid).startsWith('L:')
      ? this.motorApi.getLaborDetails(this.contentSource, this.vehicleId, aid)
      : this.motorApi.getArticleContent(this.contentSource, this.vehicleId, aid);

    contentRequest$.subscribe({
      next: (content) => {
        const rawBody = (content?.body as any) || {};
        const rawHtml = rawBody.html || rawBody.content || '';
        if (!content || !content.body || !rawHtml) {
          console.error('[ArticleViewer] API returned empty content body or html');
        }

        this.isCached.set(content.header?.isCached || false);

        if (!this.articleTitleInput && rawBody?.title) {
          const cleaned = this.cleanTitle(String(rawBody.title));
          this.articleTitle.set(cleaned);
          if (this.windowId) {
            this.windowManager.updateTitle(this.windowId, cleaned);
          }
        }

        const pdfUri = rawBody?.pdfDataUri || null;

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
          // Show original content immediately
          this.articleContent.set(safeHtml);
          // Store for tutorial generation
          this.rawHtmlForTutorial = htmlString;
          // Save content to Supabase (passes pre-fetched HTML to avoid double-fetch)
          this.dataSync.syncSingleArticle(this.contentSource!, this.vehicleId!, {
            id: aid,
            title: rawBody?.title || this.articleTitle(),
            bucket: rawBody?.bucket || '',
            parentBucket: rawBody?.parentBucket || ''
          }, rawHtml);
          // Background AI rewrite
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
        const body = err?.error;

        // 403 with moduleType = access denied (not unlocked) — show lock overlay
        if (status === 403 && body?.moduleType) {
          this.resolvedModuleType.set(body.moduleType);
          this.error.set(null);
          this.isLoading.set(false);
          return;
        }

        if ((status === 401 || status === 403) && this.retryCount() < 3) {
          // Auth expired — proxy is re-authenticating, poll and retry
          this.isRetrying.set(true);
          this.retryCount.update(n => n + 1);
          this.pollAndRetry();
        } else {
          this.isRetrying.set(false);
          this.retryCount.set(0);
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
    let attempts = 0;
    const maxAttempts = 12;

    const poll = () => {
      if (attempts++ > maxAttempts) {
        this.isRetrying.set(false);
        this.error.set('Re-authentication timed out. Please refresh the page.');
        this.isLoading.set(false);
        return;
      }

      this.motorApi.getAuthStatus().subscribe({
        next: (status) => {
          const sessionValid = (status as any)?.sessionValid === true;
          if (status?.status === 'success' || sessionValid) {
            this.isRetrying.set(false);
            this.loadData();
          } else if (status?.status === 'authenticating') {
            // Keep polling while backend refreshes Motor session.
            setTimeout(poll, 800);
          } else {
            // Idle/error/unknown should back off to avoid request storms.
            const backoffMs = Math.min(2500, 800 + attempts * 200);
            setTimeout(poll, backoffMs);
          }
        },
        error: () => {
          const backoffMs = Math.min(3000, 1000 + attempts * 250);
          setTimeout(poll, backoffMs);
        }
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

  navigateToCredits() {
    this.windowManager.openWindow('Get Credits', CreditsModalComponent);
  }

  goBackToDashboard() {
    if (this.windowId) {
      this.windowManager.closeWindow(this.windowId);
    } else {
      this.router.navigate(['/vehicle', this.contentSourceSig(), this.vehicleIdSig()]);
    }
  }

  async refreshAndRetry() {
    await this.creditsService.refreshBalance();
    this.loadData();
  }

  async unlockThisArticle() {
    const vid = this.vehicleIdSig();
    const aid = this.internalArticleId();
    if (!vid || !aid) return;
    const ok = await this.creditsService.unlockArticle(vid, vid, aid);
    if (ok) this.loadData();
  }

  async unlockSection(moduleType: string) {
    const vid = this.vehicleIdSig();
    if (!vid) return;
    const cost = this.creditsService.getCostForModule(moduleType);
    const ok = await this.creditsService.unlockModule(vid, vid, moduleType, cost);
    if (ok) this.loadData();
  }

  /** Unlock all modules for this vehicle (backend stores `full` in unlocks). */
  async unlockFullVehicle() {
    const vid = this.vehicleIdSig();
    if (!vid || this.creditsService.hasFullVehicleUnlock(vid)) return;
    const name = this.articleTitle() || 'Vehicle';
    const ok = await this.creditsService.unlockModule(
      vid,
      name,
      'full',
      this.creditsService.COSTS.FULL_ACCESS
    );
    if (ok) this.loadData();
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
