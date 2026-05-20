import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { getMotorProxyBaseUrl } from '../utils/motor-api.constants';
import { Observable, Subject } from 'rxjs';
import { TutorialStep } from '../models/motor.models';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class DiyChatService {
  private auth = inject(AuthService);
  private baseUrl = getMotorProxyBaseUrl();

  /**
   * Streams responses from POST /api/ai/vehicle/:vehicleId/tutorial.
   * Utilizes fetch + ReadableStream to support Firebase Bearer Auth headers and POST bodies.
   */
  streamTutorial(vehicleId: string, query: string): Observable<{ text?: string; done?: boolean; error?: string }> {
    const subject = new Subject<{ text?: string; done?: boolean; error?: string }>();

    (async () => {
      try {
        const token = await this.auth.getIdToken();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${this.baseUrl}/api/ai/vehicle/${encodeURIComponent(vehicleId)}/tutorial`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, matchCount: 8 })
        });

        if (!response.ok) {
          const text = await response.text();
          let errMessage = 'Failed to generate answer';
          try {
            const parsed = JSON.parse(text);
            errMessage = parsed.error || errMessage;
          } catch {
            errMessage = text || errMessage;
          }
          subject.next({ error: errMessage, done: true });
          subject.complete();
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          subject.next({ error: 'Response stream is not readable.', done: true });
          subject.complete();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Hold partial line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('data: ')) {
              const dataStr = trimmed.substring(6);
              try {
                const data = JSON.parse(dataStr);
                if (data.error) {
                  subject.next({ error: data.error, done: true });
                } else if (data.done) {
                  subject.next({ done: true });
                } else if (data.text) {
                  subject.next({ text: data.text });
                }
              } catch {
                // Ignore parsing errors for incomplete lines
              }
            }
          }
        }

        // Process final line in buffer if exists
        if (buffer && buffer.trim().startsWith('data: ')) {
          const dataStr = buffer.trim().substring(6);
          try {
            const data = JSON.parse(dataStr);
            if (data.text) subject.next({ text: data.text });
          } catch {}
        }

        subject.next({ done: true });
        subject.complete();

      } catch (err: any) {
        subject.next({ error: err.message || 'Connection to chat service failed.', done: true });
        subject.complete();
      }
    })();

    return subject.asObservable();
  }

  /**
   * Client-side markdown procedure parser.
   * Parses markdown step formats from generated responses to feed <app-tutorial-stepper>.
   */
  parseMarkdownSteps(text: string): TutorialStep[] {
    const steps: TutorialStep[] = [];
    if (!text) return steps;

    // Pattern A: Split by headings starting with "### Step" or standard "### "
    const headingMatches = [...text.matchAll(/(?:^|\n)###\s*(?:Step\s*\d+[:.]?\s*)?([^\n]+)/gi)];
    if (headingMatches.length > 0) {
      for (let i = 0; i < headingMatches.length; i++) {
        const currentMatch = headingMatches[i];
        const title = currentMatch[1].trim();
        const startIdx = currentMatch.index! + currentMatch[0].length;
        const endIdx = i < headingMatches.length - 1 ? headingMatches[i + 1].index! : text.length;
        const sectionContent = text.substring(startIdx, endIdx).trim();

        // Extract warning/tools metadata
        const warningMatch = sectionContent.match(/(?:warning|caution|safety|danger)\s*:\s*([^\n]+)/i);
        const toolMatch = sectionContent.match(/(?:tools?|equipment|required)\s*:\s*([^\n]+)/i);

        let content = sectionContent
          .replace(/(?:warning|caution|safety|danger)\s*:\s*[^\n]+/gi, '')
          .replace(/(?:tools?|equipment|required)\s*:\s*[^\n]+/gi, '')
          .trim();

        content = this.formatMarkdownToHtml(content);

        steps.push({
          title,
          content,
          warning: warningMatch ? warningMatch[1].trim() : undefined,
          tool: toolMatch ? toolMatch[1].trim() : undefined
        });
      }
    }

    // Pattern B: Numbered Lists (e.g. "1. **Remove Spark Plug**: Use...")
    if (steps.length === 0) {
      const listMatches = [...text.matchAll(/(?:^|\n)(\d+)\.\s*([^\n]+)/g)];
      for (let i = 0; i < listMatches.length; i++) {
        const currentMatch = listMatches[i];
        const line = currentMatch[2].trim();
        const startIdx = currentMatch.index! + currentMatch[0].length;
        const endIdx = i < listMatches.length - 1 ? listMatches[i + 1].index! : text.length;
        
        let title = '';
        let content = '';

        const boldTitleMatch = line.match(/^\*\*([^*:]+)\*\*(?:\s*:\s*|\s+)?(.*)/);
        if (boldTitleMatch) {
          title = boldTitleMatch[1].trim();
          content = boldTitleMatch[2].trim();
        } else {
          title = line.length > 40 ? line.substring(0, 37) + '...' : line;
          content = line;
        }

        const blockText = text.substring(startIdx, endIdx).trim();
        if (blockText) {
          content += '\n' + blockText;
        }

        const warningMatch = content.match(/(?:warning|caution|safety|danger)\s*:\s*([^\n]+)/i);
        const toolMatch = content.match(/(?:tools?|equipment|required)\s*:\s*([^\n]+)/i);

        content = content
          .replace(/(?:warning|caution|safety|danger)\s*:\s*[^\n]+/gi, '')
          .replace(/(?:tools?|equipment|required)\s*:\s*[^\n]+/gi, '')
          .trim();

        content = this.formatMarkdownToHtml(content);

        steps.push({
          title: `Step ${currentMatch[1]}: ${title}`,
          content,
          warning: warningMatch ? warningMatch[1].trim() : undefined,
          tool: toolMatch ? toolMatch[1].trim() : undefined
        });
      }
    }

    return steps;
  }

  private formatMarkdownToHtml(markdown: string): string {
    if (!markdown) return '';
    let html = markdown
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br/>');

    return `<p>${html}</p>`;
  }
}
