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
        // Normalize relative paths - for now, treat as absolute from proxy root
        const cleanPath = url.replace(/^\.\.?\//, '');
        return `${this.baseUrl}/${cleanPath}`;
      }

      // Default: treat as relative path from proxy root
      return `${this.baseUrl}/${url}`;
    };

    // Process custom mtr-doc-link elements - convert to clickable links
    // Format: <mtr-doc-link id="2161655">Link Text</mtr-doc-link>
    // Convert to: <a href="#/vehicle/{contentSource}/{vehicleId}/article/{id}">Link Text</a>
    // Note: Using hash-based routing, so links start with #/
    if (contentSource && vehicleId) {
      html = html.replace(/<mtr-doc-link\s+id=["']?([^"'>\s]+)["']?[^>]*>([^<]*)<\/mtr-doc-link>/gi, (match, id, text) => {
        const linkText = text.trim() || 'View Article';
        // Use relative hash route (Angular uses hash location strategy)
        return `<a href="#/vehicle/${contentSource}/${vehicleId}/article/${id}" class="text-cyan-400 hover:text-cyan-300 underline">${linkText}</a>`;
      });
    } else {
      // If no context, just remove the custom tag and keep the text
      html = html.replace(/<mtr-doc-link[^>]*>([^<]*)<\/mtr-doc-link>/gi, '$1');
    }

    // Process custom mtr-image elements (Client-side handling)
    // Format: <mtr-image id='11033139'></mtr-image>
    html = html.replace(/<mtr-image\s+([^>]*)\/?>/gi, (match, attrs) => {
      const idMatch = attrs.match(/id\s*=\s*("|'|)?([^"'\s]+)\1/i);
      if (!idMatch) return match;
      const id = idMatch[2];
      // Use the proper API endpoint via the proxy
      // Use efficient graphic endpoint if possible, otherwise fallback to generic
      const graphicUrl = contentSource
        ? `${this.baseUrl}/api/source/${contentSource}/graphic/${id}`
        : `${this.baseUrl}/graphic/${id}`;

      // Fix: Correctly remove id attribute even if quoted
      return `<img src="${graphicUrl}" class="article-image" ${attrs.replace(/id\s*=\s*(?:("|')[^"']*\1|[^"'\s]+)/i, '')}>`;
    });

    // Process src attributes (images, iframes, videos, etc.)
    // Matches: src="..." or src='...' or src=... (handles quotes and unquoted)
    let processed = html.replace(/src\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (match, urlWithQuotes) => {
      // Check if quoted
      let url = urlWithQuotes;
      let quote = '';

      if (urlWithQuotes.startsWith('"') && urlWithQuotes.endsWith('"')) {
        url = urlWithQuotes.substring(1, urlWithQuotes.length - 1);
        quote = '"';
      } else if (urlWithQuotes.startsWith("'") && urlWithQuotes.endsWith("'")) {
        url = urlWithQuotes.substring(1, urlWithQuotes.length - 1);
        quote = "'";
      }

      // Trim whitespace from URL
      url = url.trim();
      // Skip if empty
      if (!url) return match;

      const processedUrl = processUrl(url, 'src');

      // If original was unquoted, we should probably quote it now to be safe, or return as is
      // Let's force double quotes for consistency
      return `src="${processedUrl}"`;
    });

    // Also handle img tags that might not follow standard format
    // Handle: <img ... data-src="..." /> (lazy loading patterns)
    processed = processed.replace(/data-src\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (match, urlWithQuotes) => {
      let url = urlWithQuotes;
      if (urlWithQuotes.startsWith('"') && urlWithQuotes.endsWith('"')) {
        url = urlWithQuotes.substring(1, urlWithQuotes.length - 1);
      } else if (urlWithQuotes.startsWith("'") && urlWithQuotes.endsWith("'")) {
        url = urlWithQuotes.substring(1, urlWithQuotes.length - 1);
      }

      url = url.trim();
      if (!url) return match;
      const processedUrl = processUrl(url, 'data-src');
      return `data-src="${processedUrl}"`;
    });

    // Process href attributes (links)
    processed = processed.replace(/href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (match, urlWithQuotes) => {
      let url = urlWithQuotes;
      let quote = '"'; // Default to double quote for output

      if (urlWithQuotes.startsWith('"') && urlWithQuotes.endsWith('"')) {
        url = urlWithQuotes.substring(1, urlWithQuotes.length - 1);
        quote = '"';
      } else if (urlWithQuotes.startsWith("'") && urlWithQuotes.endsWith("'")) {
        url = urlWithQuotes.substring(1, urlWithQuotes.length - 1);
        quote = "'";
      }

      url = url.trim();
      // Skip anchors, hash routes, javascript, mailto, tel
      if (url.startsWith('#') ||
        url.startsWith('javascript:') ||
        url.startsWith('mailto:') ||
        url.startsWith('tel:')) {
        return match;
      }

      // Skip if already a full URL (http/https) - these are external links
      if (url.startsWith('http://') || url.startsWith('https://')) {
        // But if it's pointing to our own baseUrl with a hash route, convert it
        if (url.includes(this.baseUrl) && url.includes('#/')) {
          const hashPart = url.substring(url.indexOf('#/'));
          return `href=${quote}${hashPart}${quote}`;
        }
        return match;
      }

      // Process internal relative URLs
      const processedUrl = processUrl(url, 'href');
      return `href="${processedUrl}"`;
    });

    // Process background-image URLs in style attributes
    processed = processed.replace(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
      const processedUrl = processUrl(url, 'background');
      // Remove quotes from url() if they were there
      const originalHadQuotes = /url\(["']/.test(match);
      return originalHadQuotes
        ? `background-image: url("${processedUrl}")`
        : `background-image: url(${processedUrl})`;
    });

    // Process srcset attributes (responsive images)
    processed = processed.replace(/srcset\s*=\s*["']([^"']+)["']/gi, (match, srcset) => {
      // srcset can have multiple URLs: "image1.jpg 1x, image2.jpg 2x"
      const processedSrcset = srcset.split(',').map(part => {
        const trimmed = part.trim();
        // Extract URL (before space or descriptor like "1x", "2x", "100w")
        const urlMatch = trimmed.match(/^([^\s]+)/);
        if (urlMatch) {
          const url = urlMatch[1];
          const descriptor = trimmed.substring(url.length).trim();
          const processedUrl = processUrl(url, 'srcset');
          return descriptor ? `${processedUrl} ${descriptor}` : processedUrl;
        }
        return trimmed;
      }).join(', ');

      const quote = match.includes("'") ? "'" : '"';
      return `srcset=${quote}${processedSrcset}${quote}`;
    });

    return processed;
  }
}
