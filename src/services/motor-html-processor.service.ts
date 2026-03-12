import { Injectable } from '@angular/core';
import { MOTOR_API_BASE_URL } from '../utils/motor-api.constants';

@Injectable({ providedIn: 'root' })
export class MotorHtmlProcessorService {
  private readonly baseUrl = MOTOR_API_BASE_URL;

  getGraphicUrl(graphicPath: string): string {
    if (!graphicPath) return '';
    // If already a full URL, return as is
    if (graphicPath.startsWith('http://') || graphicPath.startsWith('https://')) {
      return graphicPath;
    }
    // If it starts with /api/, use it directly
    if (graphicPath.startsWith('/api/') || graphicPath.startsWith('api/')) {
      const cleanPath = graphicPath.startsWith('/') ? graphicPath : `/${graphicPath}`;
      return `${this.baseUrl}${cleanPath}`;
    }
    // If it's an absolute path starting with /
    if (graphicPath.startsWith('/')) {
      return `${this.baseUrl}${graphicPath}`;
    }
    // Otherwise, treat as relative and prepend baseUrl with /
    return `${this.baseUrl}/${graphicPath}`;
  }

  // Combined regex with attribute grouping for HTML processing
  private readonly combinedRegex = /(<mtr-doc-link(?:\s+id=["']?([^"'>\s]+)["']?)?[^>]*>([^<]*)<\/mtr-doc-link>)|(<mtr-image\s+([^>]*)\/?>)|((src|data-src|href|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))|(background-image\s*:\s*url\(["']?([^"')]+)["']?\))/gi;

  /**
   * Process HTML content to fix relative URLs for images and links
   * Comprehensive URL processing for all image and asset paths
   * Also processes custom elements like mtr-doc-link
   */
  processHtmlContent(html: string, contentSource?: string, vehicleId?: string): string {
    if (!html) return '';

    // Helper function to normalize and process URLs
    const processUrl = (url: string, attrName: string = 'src'): string => {
      // Skip if already a full URL (http/https)
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }

      // Skip if already processed (contains baseUrl)
      if (url.includes(this.baseUrl)) {
        return url;
      }

      // Skip data URLs, anchors, and javascript
      if (url.startsWith('data:') || url.startsWith('#') || url.startsWith('javascript:')) {
        return url;
      }

      // Handle API paths - these should go through the proxy
      if (url.startsWith('/api/') || url.startsWith('api/')) {
        const cleanPath = url.startsWith('/') ? url : `/${url}`;
        return `${this.baseUrl}${cleanPath}`;
      }

      // Handle other absolute paths starting with /
      if (url.startsWith('/')) {
        return `${this.baseUrl}${url}`;
      }

      // Handle relative paths (like ../graphic/... or ./image.jpg)
      // Convert to absolute path through proxy
      if (url.startsWith('../') || url.startsWith('./')) {
        const cleanPath = url.replace(/^\.\.?\//, '');
        return `${this.baseUrl}/${cleanPath}`;
      }

      // Default: treat as relative path from proxy root
      return `${this.baseUrl}/${url}`;
    };

    return html.replace(this.combinedRegex, (match,
      docLinkFull, docLinkId, docLinkText,
      mtrImageFull, mtrImageAttrs,
      attrFull, attrName, attrQ1, attrQ2, attrNoQ,
      bgFull, bgUrl
    ) => {
      if (docLinkFull) {
        if (contentSource && vehicleId) {
          if (docLinkId) {
            const linkText = docLinkText.trim() || 'View Article';
            return `<a href="#/vehicle/${contentSource}/${vehicleId}/article/${docLinkId}" class="text-cyan-400 hover:text-cyan-300 underline">${linkText}</a>`;
          }
          return match;
        } else {
          return docLinkText;
        }
      }

      if (mtrImageFull) {
        const idMatch = mtrImageAttrs.match(/id\s*=\s*("|'|)?([^"'\s]+)\1/i);
        if (!idMatch) return match;
        const id = idMatch[2];
        const graphicUrl = contentSource
          ? `${this.baseUrl}/api/source/${contentSource}/graphic/${id}`
          : `${this.baseUrl}/graphic/${id}`;

        return `<img src="${graphicUrl}" class="article-image" ${mtrImageAttrs.replace(/id\s*=\s*(?:("|')[^"']*\1|[^"'\s]+)/i, '')}>`;
      }

      if (attrFull) {
        const name = attrName.toLowerCase();
        let url = attrQ1 || attrQ2 || attrNoQ;
        const originalQuote = attrQ1 ? '"' : (attrQ2 ? "'" : '"');

        if (name === 'srcset') {
          if (!url) return match;
          const processedSrcset = url.split(',').map((part: string) => {
            const trimmed = part.trim();
            const urlMatch = trimmed.match(/^([^\s]+)/);
            if (urlMatch) {
              const u = urlMatch[1];
              const descriptor = trimmed.substring(u.length).trim();
              const processedUrl = processUrl(u, 'srcset');
              return descriptor ? `${processedUrl} ${descriptor}` : processedUrl;
            }
            return trimmed;
          }).join(', ');
          return `${name}=${originalQuote}${processedSrcset}${originalQuote}`;
        }

        url = url.trim();
        if (!url) return match;

        if (name === 'href') {
          if (url.startsWith('#') || url.startsWith('javascript:') || url.startsWith('mailto:') || url.startsWith('tel:')) return match;
          if (url.startsWith('http://') || url.startsWith('https://')) {
            if (url.includes(this.baseUrl) && url.includes('#/')) {
              const hashPart = url.substring(url.indexOf('#/'));
              return `href=${originalQuote}${hashPart}${originalQuote}`;
            }
            return match;
          }
        }

        const processedUrl = processUrl(url, name);
        return `${name}="${processedUrl}"`;
      }

      if (bgFull) {
        const processedUrl = processUrl(bgUrl, 'background');
        const originalHadQuotes = /url\(["']/.test(match);
        return originalHadQuotes
          ? `background-image: url("${processedUrl}")`
          : `background-image: url(${processedUrl})`;
      }

      return match;
    });
  }
}
