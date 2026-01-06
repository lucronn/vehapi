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
import { ProcedureStepperComponent, ProcedureStep } from './components/procedure-stepper/procedure-stepper.component';
import { TutorialComponent } from '../../components/tutorial/tutorial.component';
import { TutorialStep } from '../../models/motor.models';

@Component({
  selector: 'app-article-viewer',
  templateUrl: './article-viewer.component.html',
  styleUrls: ['./article-viewer.component.css'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule, ProcedureStepperComponent, TutorialComponent],
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
  articleTitle = signal<string>('');
  documentHeader = signal<string>('');

  // Stepper Wizard State
  // Main Stepper State
  stepperMode = signal(false);

  // Legacy Regex Stepper
  procedureSteps = signal<ProcedureStep[]>([]);

  // AI Tutorial Stepper
  tutorialSteps = signal<TutorialStep[]>([]);
  isGeneratingTutorial = signal(false);

  private firebase = inject(FirebaseService);

  private articleData$ = this.route.paramMap.pipe(
    switchMap(params => {
      const contentSource = params.get('contentSource');
      const vehicleId = params.get('vehicleId');
      const articleId = params.get('articleId');

      if (contentSource && vehicleId && articleId) {
        // DIRECT API CALL
        return forkJoin({
          title: this.motorApi.getArticleTitle(contentSource, vehicleId, articleId).pipe(
            catchError(() => of({ body: articleId } as any))
          ),
          content: this.motorApi.getArticleContent(contentSource, vehicleId, articleId)
        }).pipe(
          switchMap(({ title, content }) => {
            const processed = this.extractDocumentHeader(content.body.html);
            // Use service method for processing if available, otherwise use our method
            const processedHtml = this.motorApi.processHtmlContent
              ? this.motorApi.processHtmlContent(processed.content, contentSource, vehicleId)
              : processed.content;
            const originalHtml = this.processAndSanitizeHtml(processedHtml);
            const titleText = title?.body || articleId || '';

            this.articleTitle.set(titleText);
            this.documentHeader.set(processed.header);
            this.originalContent.set(originalHtml);

            // AI Enhancement - only if enabled
            if (this.geminiApi.aiEnabled()) {
              this.isRewriting.set(true);
              this.showOriginal.set(false);

              return this.geminiApi.rewriteArticle(titleText, processed.content).pipe(
                map(rewrittenHtml => {
                  const processedRewritten = this.processAndSanitizeHtml(rewrittenHtml);
                  this.rewrittenContent.set(processedRewritten);
                  this.isRewriting.set(false);
                  return { original: originalHtml, rewritten: processedRewritten };
                }),
                catchError(err => {
                  console.error('AI rewrite failed:', err);
                  this.isRewriting.set(false);
                  this.showOriginal.set(true);
                  return of({ original: originalHtml, rewritten: originalHtml });
                })
              );
            } else {
              this.showOriginal.set(true);
              this.isRewriting.set(false);
              return of({ original: originalHtml, rewritten: '' });
            }
          })
        );
      }
      return of(null);
    })
  );

  articleData = toSignal(this.articleData$);

  displayContent = computed(() => {
    const content = this.showOriginal() ? this.originalContent() : this.rewrittenContent();
    // Extract steps when content is available and stepper mode might be used
    if (content && this.procedureSteps().length === 0) {
      // Use setTimeout to avoid updating during computation
      setTimeout(() => this.extractProcedureSteps(), 100);
    }
    return content;
  });

  toggleStepperMode() {
    this.stepperMode.update(mode => {
      const newMode = !mode;

      if (newMode) {
        // If we already have AI steps, just show them
        if (this.tutorialSteps().length > 0) return true;

        // If AI is enabled, try generating AI tutorial
        if (this.geminiApi.aiEnabled()) {
          this.isGeneratingTutorial.set(true);
          // Use the processed (potentially rewritten) content for generation
          // But ideally we use the original processed HTML so the AI has specific tags if needed?
          // Actually, `rewriteArticle` returns 'clean' HTML.
          // Let's use `processed.content` from existing article data if possible.
          // Accessing `articleData()` signal value.
          const data = this.articleData();
          if (data?.original) {
            this.geminiApi.generateTutorialFromArticle(typeof data.original === 'string' ? data.original : '')
              .subscribe({
                next: (steps) => {
                  this.tutorialSteps.set(steps);
                  this.isGeneratingTutorial.set(false);
                },
                error: (err) => {
                  console.error("Tutorial generation failed", err);
                  this.isGeneratingTutorial.set(false);
                  // Fallback to regex
                  this.extractProcedureSteps();
                }
              });
          }
        } else {
          // Fallback to legacy regex extraction
          if (this.procedureSteps().length === 0) {
            this.extractProcedureSteps();
          }
        }
      }
      return newMode;
    });
  }

  private extractProcedureSteps() {
    const content = this.displayContent();
    if (!content) return;

    // Convert SafeHtml to string for parsing
    const htmlString = typeof content === 'string' ? content : '';
    if (!htmlString) return;

    const steps: ProcedureStep[] = [];

    // Extract steps from ordered lists (ol > li)
    const olMatches = htmlString.matchAll(/<ol[^>]*>([\s\S]*?)<\/ol>/gi);
    for (const olMatch of olMatches) {
      const liMatches = olMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi);
      let stepNumber = 1;
      for (const liMatch of liMatches) {
        const stepContent = liMatch[1].trim();
        if (stepContent && stepContent.length > 10) { // Only include substantial steps
          steps.push({
            number: stepNumber++,
            content: stepContent,
            completed: false
          });
        }
      }
    }

    // Also extract from table rows that look like steps
    const tableMatches = htmlString.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi);
    for (const tableMatch of tableMatches) {
      const rowMatches = tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      let stepNumber = steps.length + 1;
      for (const rowMatch of rowMatches) {
        // Check if row contains step-like content
        const rowText = rowMatch[1].replace(/<[^>]*>/g, ' ').trim();
        if (rowText.match(/step\s*\d+/i) || rowText.length > 20) {
          steps.push({
            number: stepNumber++,
            content: rowMatch[1],
            completed: false
          });
        }
      }
    }

    // Only enable stepper if we found substantial steps (3+)
    if (steps.length >= 3) {
      this.procedureSteps.set(steps);
    } else {
      this.stepperMode.set(false);
    }
  }

  private extractDocumentHeader(html: string): { header: string; content: string } {
    if (!html) return { header: '', content: '' };

    // Extract h2.document-header element - handle various class attribute formats
    const headerMatch = html.match(/<h2[^>]*class\s*=\s*["'][^"']*document-header[^"']*["'][^>]*>(.*?)<\/h2>/is);
    let header = '';
    let content = html;

    if (headerMatch) {
      // Extract and clean text content (strip HTML tags)
      const headerHtml = headerMatch[1];
      header = headerHtml.replace(/<[^>]*>/g, '').trim();
      // Remove the h2 element from the content (handle multiline with 's' flag)
      content = html.replace(/<h2[^>]*class\s*=\s*["'][^"']*document-header[^"']*["'][^>]*>.*?<\/h2>/is, '');
    }

    return { header, content };
  }

  private processAndSanitizeHtml(html: string): SafeHtml {
    if (!html) return '';
    let processedHtml = html.replace(/src=["'](\/?api\/[^"']+)["']/g, (match, relativePath) => {
      const fullUrl = this.motorApi.getGraphicUrl(relativePath);
      return `src="${fullUrl}"`;
    });

    // Group content into section cards (must be before other processing)
    processedHtml = this.groupContentIntoCards(processedHtml);

    // Process tables for mobile-friendly card layout
    processedHtml = this.processTablesForMobile(processedHtml);

    // Wrap "Important" sections in styled containers
    processedHtml = this.processImportantSections(processedHtml);

    const sanitized = this.sanitizer.bypassSecurityTrustHtml(processedHtml);

    // Attach navigation handlers after a brief delay to ensure DOM is ready
    setTimeout(() => this.attachNavigationHandlers(), 100);

    return sanitized;
  }

  private groupContentIntoCards(html: string): string {
    if (!html) return html;

    // Step 1: Wrap existing warning/note/caution divs in cards
    // But check if they're already inside another section card first
    const noteWarningPattern = /<div[^>]*class\s*=\s*["'][^"']*(warning|caution|note)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
    const noteWarningMatches: Array<{ match: string; type: string; content: string; index: number }> = [];
    let noteMatch;

    // First, collect all matches with their positions
    while ((noteMatch = noteWarningPattern.exec(html)) !== null) {
      if (!noteMatch[0].includes('section-card')) {
        noteWarningMatches.push({
          match: noteMatch[0],
          type: noteMatch[1],
          content: noteMatch[2],
          index: noteMatch.index
        });
      }
    }

    // Process from end to start to maintain indices
    for (let i = noteWarningMatches.length - 1; i >= 0; i--) {
      const item = noteWarningMatches[i];

      // Check if this div is already inside a section card
      const beforeMatch = html.substring(0, item.index);
      const lastCardOpen = beforeMatch.lastIndexOf('<div class="section-card');
      const lastCardClose = beforeMatch.lastIndexOf('</div>');

      const config = this.getSectionConfig(item.type === 'warning' || item.type === 'caution' ? 'warning' : 'note');

      // If we're inside a section card, just add inline classes instead of creating a new card
      if (lastCardOpen > lastCardClose && lastCardOpen !== -1) {
        // Remove redundant labels from content
        let cleanedContent = item.content;
        const labelPatterns = [
          /^Note:\s*/i,
          /^Warning:\s*/i,
          /^Caution:\s*/i,
          /<strong[^>]*>.*?(?:Note|Warning|Caution):?\s*<\/strong>\s*/gi,
          /<p[^>]*>.*?<strong[^>]*>.*?(?:Note|Warning|Caution):?\s*<\/strong>\s*/gi
        ];

        labelPatterns.forEach(pattern => {
          cleanedContent = cleanedContent.replace(pattern, '');
        });

        // Replace the div with inline styling and cleaned content
        const inlineDiv = item.match.replace(
          /class\s*=\s*["']([^"']*)["']/,
          `class="$1 section-inline-${config.type}"`
        ).replace(/>([\s\S]*?)<\/div>/, `>${cleanedContent}</div>`);
        html = html.substring(0, item.index) + inlineDiv + html.substring(item.index + item.match.length);
      } else {
        // Remove redundant "Note:" or "Warning:" labels from content
        let cleanedContent = item.content;
        const labelPatterns = [
          /^Note:\s*/i,
          /^Warning:\s*/i,
          /^Caution:\s*/i,
          /<strong[^>]*>.*?(?:Note|Warning|Caution):?\s*<\/strong>\s*/gi,
          /<p[^>]*>.*?<strong[^>]*>.*?(?:Note|Warning|Caution):?\s*<\/strong>\s*/gi
        ];

        labelPatterns.forEach(pattern => {
          cleanedContent = cleanedContent.replace(pattern, '');
        });

        // Not inside a card, create a new section card (without header since we're hiding it)
        const newCard = `<div class="section-card section-card-${config.type}" data-section-type="${config.type}">
          <div class="section-card-header" style="display: none;">
            <span class="section-card-icon">${config.icon}</span>
            <h3 class="section-card-title">${config.title}</h3>
          </div>
          <div class="section-card-content">${cleanedContent}</div>
        </div>`;
        html = html.substring(0, item.index) + newCard + html.substring(item.index + item.match.length);
      }
    }

    // Step 2: Wrap standalone paragraphs/divs with procedure keywords (before heading processing)
    // This catches cases where procedures are mentioned in paragraphs or divs
    const standalonePatterns = [
      { pattern: /<p[^>]*>.*?<strong[^>]*>.*?(?:special\s+tool|required\s+tool).*?<\/strong>.*?<\/p>/gi, type: 'special-tools' },
      { pattern: /<p[^>]*>.*?<strong[^>]*>.*?(?:warning|caution|danger).*?<\/strong>.*?<\/p>/gi, type: 'warning' },
      { pattern: /<p[^>]*>.*?<strong[^>]*>.*?(?:removal\s+procedure|remove\s+procedure).*?<\/strong>.*?<\/p>/gi, type: 'removal' },
      { pattern: /<p[^>]*>.*?<strong[^>]*>.*?(?:installation\s+procedure|install\s+procedure).*?<\/strong>.*?<\/p>/gi, type: 'installation' },
      { pattern: /<p[^>]*>.*?<strong[^>]*>.*?(?:removal|remove).*?<\/strong>.*?<\/p>/gi, type: 'removal' },
      { pattern: /<p[^>]*>.*?<strong[^>]*>.*?(?:installation|install).*?<\/strong>.*?<\/p>/gi, type: 'installation' },
      { pattern: /<p[^>]*>.*?<strong[^>]*>.*?(?:important).*?<\/strong>.*?<\/p>/gi, type: 'important' },
    ];

    standalonePatterns.forEach(({ pattern, type }) => {
      html = html.replace(pattern, (match) => {
        if (match.includes('section-card')) return match;
        const config = this.getSectionConfig(type);

        // Remove redundant labels from content
        let cleanedMatch = match;
        if (type === 'warning') {
          cleanedMatch = cleanedMatch.replace(/(?:Warning|Caution):\s*/gi, '');
          cleanedMatch = cleanedMatch.replace(/<strong[^>]*>.*?(?:Warning|Caution):?\s*<\/strong>\s*/gi, '');
        } else if (type === 'note') {
          cleanedMatch = cleanedMatch.replace(/Note:\s*/gi, '');
          cleanedMatch = cleanedMatch.replace(/<strong[^>]*>.*?Note:?\s*<\/strong>\s*/gi, '');
        }

        return `<div class="section-card section-card-${config.type}" data-section-type="${config.type}">
          <div class="section-card-header" style="display: none;">
            <span class="section-card-icon">${config.icon}</span>
            <h3 class="section-card-title">${config.title}</h3>
          </div>
          <div class="section-card-content">${cleanedMatch}</div>
        </div>`;
      });
    });

    // Step 3: Process headings and group their content into cards
    // Use a more comprehensive approach that handles h1-h6 and also looks for procedure patterns
    const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
    const sections: Array<{ heading: string; level: number; text: string; startIndex: number; endIndex: number; fullMatch: string }> = [];
    let match;

    // Find all headings and their positions
    while ((match = headingRegex.exec(html)) !== null) {
      const headingText = match[2].replace(/<[^>]*>/g, '').trim();
      const startIndex = match.index;

      // Find the end of this section (next heading of same or higher level, or end of HTML)
      let endIndex = html.length;
      const currentLevel = parseInt(match[1]);
      const nextHeadingRegex = /<h([1-6])[^>]*>/gi;
      let nextMatch;
      nextHeadingRegex.lastIndex = startIndex + match[0].length;

      while ((nextMatch = nextHeadingRegex.exec(html)) !== null) {
        const nextLevel = parseInt(nextMatch[1]);
        if (nextLevel <= currentLevel) {
          endIndex = nextMatch.index;
          break;
        }
      }

      sections.push({
        heading: match[0],
        level: currentLevel,
        text: headingText,
        startIndex,
        endIndex,
        fullMatch: match[0]
      });
    }

    // Also look for procedure patterns that might not be in headings
    // Check for "Removal Procedure", "Installation Procedure" etc. as standalone text
    const procedurePatterns = [
      { pattern: /(Removal\s+Procedure|Remove\s+Procedure)/gi, type: 'removal' },
      { pattern: /(Installation\s+Procedure|Install\s+Procedure|Assembly\s+Procedure)/gi, type: 'installation' },
      { pattern: /(Special\s+Tools?|Required\s+Tools?)/gi, type: 'special-tools' },
      { pattern: /(Warning|Caution|Danger)/gi, type: 'warning' },
      { pattern: /(Torque\s+Specification|Tightening\s+Specification)/gi, type: 'torque' },
    ];

    // Process sections from end to start to maintain indices
    for (let i = sections.length - 1; i >= 0; i--) {
      const section = sections[i];

      // Check if already in a card by looking backwards from the heading
      const beforeHeading = html.substring(0, section.startIndex);
      const lastCardOpen = beforeHeading.lastIndexOf('<div class="section-card');
      const lastCardClose = beforeHeading.lastIndexOf('</div>');

      // If we're already inside a card, skip
      if (lastCardOpen > lastCardClose && lastCardOpen !== -1) {
        continue;
      }

      // Also check if the section content itself is already wrapped
      const sectionHtml = html.substring(section.startIndex, section.endIndex);
      if (sectionHtml.trim().startsWith('<div class="section-card')) continue;

      const config = this.detectSectionType(section.text);

      // Only wrap if it's not a general section, or if it's a procedure-related heading
      if (config.type === 'general') {
        // Check if it matches any procedure pattern
        let matchedType = null;
        for (const { pattern, type } of procedurePatterns) {
          if (pattern.test(section.text)) {
            matchedType = type;
            break;
          }
        }
        if (!matchedType) continue; // Skip general sections that don't match patterns
        const matchedConfig = this.getSectionConfig(matchedType);
        config.type = matchedConfig.type;
        config.icon = matchedConfig.icon;
        config.title = matchedConfig.title;
        config.color = matchedConfig.color;
      }

      // Extract the section content (everything after the heading until next section)
      // Exclude the heading itself since we're showing it in the card header
      const headingEndIndex = section.startIndex + section.fullMatch.length;
      const sectionContent = html.substring(headingEndIndex, section.endIndex).trim();

      // Only wrap if there's actual content (not just the heading)
      if (!sectionContent) continue;

      // Wrap in card
      const wrappedSection = `<div class="section-card section-card-${config.type}" data-section-type="${config.type}">
        <div class="section-card-header">
          <span class="section-card-icon">${config.icon}</span>
          <h${section.level} class="section-card-title">${config.title}</h${section.level}>
        </div>
        <div class="section-card-content">
          ${sectionContent}
        </div>
      </div>`;

      html = html.substring(0, section.startIndex) + wrappedSection + html.substring(section.endIndex);
    }

    // Step 4: Fallback - Look for procedure text patterns that might not be in headings
    // This catches cases where "Installation Procedure" etc. appear as plain text
    const procedureTextPatterns = [
      {
        pattern: /(?:<p[^>]*>|<div[^>]*>|<h[1-6][^>]*>).*?(?:Removal\s+Procedure|Remove\s+Procedure).*?(?:<\/p>|<\/div>|<\/h[1-6]>)/gi,
        type: 'removal',
        title: 'Removal Procedure'
      },
      {
        pattern: /(?:<p[^>]*>|<div[^>]*>|<h[1-6][^>]*>).*?(?:Installation\s+Procedure|Install\s+Procedure).*?(?:<\/p>|<\/div>|<\/h[1-6]>)/gi,
        type: 'installation',
        title: 'Installation Procedure'
      },
    ];

    // Process from end to start
    for (const { pattern, type, title } of procedureTextPatterns) {
      let match;
      const matches: Array<{ index: number; content: string }> = [];

      while ((match = pattern.exec(html)) !== null) {
        // Check if already in a card
        const beforeMatch = html.substring(0, match.index);
        const lastCardOpen = beforeMatch.lastIndexOf('<div class="section-card');
        const lastCardClose = beforeMatch.lastIndexOf('</div>');

        if (lastCardOpen <= lastCardClose || lastCardOpen === -1) {
          matches.push({ index: match.index, content: match[0] });
        }
      }

      // Process matches from end to start
      for (let i = matches.length - 1; i >= 0; i--) {
        const procMatch = matches[i];
        const startIndex = procMatch.index;

        // Find content until next procedure or next heading
        let endIndex = html.length;
        const nextProcedureRegex = /(?:Removal\s+Procedure|Installation\s+Procedure|Install\s+Procedure|Remove\s+Procedure)/gi;
        nextProcedureRegex.lastIndex = startIndex + procMatch.content.length;
        const nextProc = nextProcedureRegex.exec(html);
        if (nextProc && nextProc.index > startIndex) {
          endIndex = nextProc.index;
        } else {
          // Look for next heading
          const nextHeadingRegex = /<h[1-6][^>]*>/gi;
          nextHeadingRegex.lastIndex = startIndex + procMatch.content.length;
          const nextHeading = nextHeadingRegex.exec(html);
          if (nextHeading && nextHeading.index > startIndex) {
            endIndex = nextHeading.index;
          }
        }

        const sectionContent = html.substring(startIndex + procMatch.content.length, endIndex).trim();
        if (!sectionContent) continue;

        const config = this.getSectionConfig(type);
        const wrappedSection = `<div class="section-card section-card-${config.type}" data-section-type="${config.type}">
          <div class="section-card-header">
            <span class="section-card-icon">${config.icon}</span>
            <h3 class="section-card-title">${title}</h3>
          </div>
          <div class="section-card-content">
            ${procMatch.content}
            ${sectionContent}
          </div>
        </div>`;

        html = html.substring(0, startIndex) + wrappedSection + html.substring(endIndex);
      }
    }

    return html;
  }

  private detectSectionType(text: string): { type: string; icon: string; title: string; color: string } {
    const lowerText = text.toLowerCase();

    // More specific patterns first
    if (/\b(removal\s+procedure|remove\s+procedure|disassembly\s+procedure)\b/.test(lowerText)) {
      return this.getSectionConfig('removal');
    }
    if (/\b(installation\s+procedure|install\s+procedure|assembly\s+procedure|reassembly\s+procedure)\b/.test(lowerText)) {
      return this.getSectionConfig('installation');
    }
    if (/\b(special\s+tool|required\s+tool|special\s+equipment)\b/.test(lowerText)) {
      return this.getSectionConfig('special-tools');
    }
    if (/\b(torque\s+specification|tightening\s+specification)\b/.test(lowerText)) {
      return this.getSectionConfig('torque');
    }
    if (/\b(warning|caution|danger|safety\s+warning)\b/.test(lowerText)) {
      return this.getSectionConfig('warning');
    }
    if (/\b(removal|remove|disassembly|disassemble)\b/.test(lowerText)) {
      return this.getSectionConfig('removal');
    }
    if (/\b(installation|install|assembly|assemble|reassembly)\b/.test(lowerText)) {
      return this.getSectionConfig('installation');
    }
    if (/\b(note|notice|information)\b/.test(lowerText)) {
      return this.getSectionConfig('note');
    }
    if (/\b(prerequisite|before\s+you\s+begin|preparation|prepare)\b/.test(lowerText)) {
      return this.getSectionConfig('prerequisites');
    }
    if (/\bimportant\b/.test(lowerText)) {
      return this.getSectionConfig('important');
    }

    return this.getSectionConfig('general');
  }

  private getSectionConfig(type: string): { type: string; icon: string; title: string; color: string } {
    const configs: { [key: string]: { icon: string; color: string; title: string } } = {
      'special-tools': { icon: '🔧', color: 'cyan', title: 'Special Tools' },
      'warning': { icon: '⚠️', color: 'red', title: 'Warning' },
      'removal': { icon: '🔩', color: 'orange', title: 'Removal Procedure' },
      'installation': { icon: '⚙️', color: 'green', title: 'Installation Procedure' },
      'note': { icon: 'ℹ️', color: 'blue', title: 'Note' },
      'prerequisites': { icon: '📋', color: 'purple', title: 'Prerequisites' },
      'torque': { icon: '🔨', color: 'yellow', title: 'Torque Specifications' },
      'important': { icon: '⭐', color: 'amber', title: 'Important' },
      'general': { icon: '📄', color: 'gray', title: 'Section' }
    };

    const config = configs[type] || configs['general'];
    return { type, ...config };
  }

  private processImportantSections(html: string): string {
    // Wrap paragraphs or divs that start with "Important:" in a styled container
    return html.replace(
      /(<p[^>]*>|<div[^>]*>)\s*(<strong[^>]*>)?\s*Important:?\s*(<\/strong>)?/gi,
      (match, tag, strongOpen, strongClose) => {
        // Check if already wrapped
        if (tag.includes('class="important-section"') || tag.includes('section-card')) {
          return match;
        }
        // Add class to identify important sections
        const newTag = tag.replace(/>$/, ' class="important-section">');
        return newTag + (strongOpen || '') + 'Important' + (strongClose || '');
      }
    );
  }

  private attachNavigationHandlers() {
    const arrows = document.querySelectorAll('.step-nav-arrow');
    arrows.forEach(arrow => {
      const nextId = arrow.getAttribute('data-next-id');
      if (nextId) {
        arrow.addEventListener('click', (e) => {
          const nextElement = document.getElementById(nextId);
          if (nextElement) {
            nextElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            e.stopPropagation();
          }
        });
      }
    });
  }

  private processTablesForMobile(html: string): string {
    // Process each table to add data-label attributes for mobile card layout
    return html.replace(/<table([^>]*)>([\s\S]*?)<\/table>/gi, (match, tableAttrs, tableContent) => {
      // Extract headers from thead or first row
      const theadMatch = tableContent.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
      const firstRowMatch = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);

      let headers: string[] = [];
      const headerSource = theadMatch ? theadMatch[1] : (firstRowMatch ? firstRowMatch[1] : '');

      if (headerSource) {
        // Extract th or td elements from header row
        const cellMatches = headerSource.match(/<(th|td)[^>]*>(.*?)<\/\1>/gi);
        if (cellMatches) {
          headers = cellMatches.map(cell => {
            // Extract text content, removing nested tags but preserving text
            const text = cell.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            return text || '';
          });
        }
      }

      // Process table content to add data-label to td elements
      let processedContent = tableContent;
      let isFirstDataRow = !theadMatch; // If no thead, first row is headers
      let rowIndex = 0;
      const rowIds: string[] = [];

      if (headers.length > 0) {
        // Process each row
        processedContent = processedContent.replace(/<tr([^>]*)>([\s\S]*?)<\/tr>/gi, (rowMatch, rowAttrs, rowContent) => {
          // Skip header row if we're using thead
          if (theadMatch && rowContent.includes('<th')) {
            return rowMatch;
          }

          // Mark first data row as header row if no thead exists
          let newRowAttrs = rowAttrs;
          if (isFirstDataRow && !theadMatch) {
            newRowAttrs = (rowAttrs || '') + ' class="mobile-header-row"';
            isFirstDataRow = false;
            return rowMatch; // Skip this row
          }

          // Add ID to row for navigation
          const rowId = `table-row-${Date.now()}-${rowIndex++}`;
          rowIds.push(rowId);
          if (!newRowAttrs.includes('id=')) {
            newRowAttrs = (newRowAttrs || '') + ` id="${rowId}"`;
          }

          // Process each td in this row
          let cellIndex = 0;
          const processedRow = rowContent.replace(/<td([^>]*)>(.*?)<\/td>/gi, (tdMatch, tdAttrs, tdContent) => {
            let label = '';
            if (!tdAttrs.includes('data-label') && headers[cellIndex]) {
              label = headers[cellIndex].replace(/"/g, '&quot;');
            } else if (tdAttrs.includes('data-label=')) {
              // Extract existing label
              const labelMatch = tdAttrs.match(/data-label=["']([^"']+)["']/);
              if (labelMatch) label = labelMatch[1];
            }

            // Consolidate "STEP" labels with numbers and remove redundant labels
            let processedContent = tdContent.trim();
            const cleanLabel = label.toUpperCase().trim();

            // If label is "STEP" and content is just a number, combine them
            if (cleanLabel === 'STEP' || cleanLabel === 'STEP:') {
              const numberMatch = processedContent.match(/^\s*(\d+)\s*$/);
              if (numberMatch) {
                // Content is just a number - combine with STEP label
                processedContent = `<span class="step-number">${numberMatch[1]}</span>`;
                label = 'STEP';
              } else if (processedContent.match(/^(go\s+to\s+)?step\s*\d+/i) ||
                processedContent.match(/^step\s*\d+/i) ||
                processedContent.length === 0) {
                // Content already has step info or is empty - remove redundant label
                label = '';
              }
            }

            // Remove label if cell content is empty or just whitespace
            const textContent = processedContent.replace(/<[^>]*>/g, '').trim();
            if (!textContent || textContent.length === 0) {
              label = '';
              // Hide completely empty cells
              return `<td${tdAttrs} style="display: none;">${processedContent}</td>`;
            }

            // Only add data-label if we have one and it's not redundant
            if (label && !tdAttrs.includes('data-label')) {
              return `<td${tdAttrs} data-label="${label}">${processedContent}</td>`;
            } else if (label && tdAttrs.includes('data-label')) {
              // Update existing label
              const newAttrs = tdAttrs.replace(/data-label=["'][^"']+["']/, `data-label="${label}"`);
              return `<td${newAttrs}>${processedContent}</td>`;
            } else if (!label && tdAttrs.includes('data-label')) {
              // Remove label if redundant
              const newAttrs = tdAttrs.replace(/\s*data-label=["'][^"']+["']/, '');
              return `<td${newAttrs}>${processedContent}</td>`;
            }

            cellIndex++;
            return `<td${tdAttrs}>${processedContent}</td>`;
          });

          return `<tr${newRowAttrs}>${processedRow}</tr>`;
        });
      }

      // Add navigation arrows between rows (will be handled by CSS + JS after render)
      let finalContent = processedContent;
      for (let i = 0; i < rowIds.length - 1; i++) {
        const currentRowId = rowIds[i];
        const nextRowId = rowIds[i + 1];
        const arrowHtml = `<div class="step-nav-arrow" data-next-id="${nextRowId}">↓</div>`;
        finalContent = finalContent.replace(
          new RegExp(`(<tr[^>]*id="${currentRowId}"[^>]*>.*?</tr>)`, 'i'),
          `$1${arrowHtml}`
        );
      }

      return `<div class="table-wrapper-mobile"><table${tableAttrs}>${finalContent}</table></div>`;
    });
  }
}
