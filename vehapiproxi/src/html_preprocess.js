/**
 * Strip noisy HTML before LLM structured parse — reduces tokens and CoT-style confusion.
 * Cheerio removes scripts/styles; Turndown preserves tables/lists as Markdown.
 */
import { load } from 'cheerio';
import TurndownService from 'turndown';

const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-'
});

turndown.addRule('strikethrough', {
    filter: ['del', 's'],
    replacement: (c, n) => `~~${n}~~`
});

/**
 * @param {string} html Raw HTML (Motor article body)
 * @param {{ maxChars?: number }} [opts]
 * @returns {string} Markdown-ish text safe for Nemotron
 */
export function htmlToMarkdownForLlm(html, opts = {}) {
    if (!html || typeof html !== 'string') return '';
    const maxChars = opts.maxChars ?? 120000;

    let $;
    try {
        $ = load(html, { decodeEntities: true });
    } catch (e) {
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
    }

    $('script, style, noscript, iframe, svg, template, link[rel="stylesheet"]').remove();

    // Drop presentation-only attributes to shrink payload
    $('*').each(function () {
        const el = $(this);
        el.removeAttr('class');
        el.removeAttr('id');
        el.removeAttr('style');
        el.removeAttr('onclick');
    });

    let fragment = $('body').length ? $('body').html() : $.root().html();
    if (!fragment || !String(fragment).trim()) {
        fragment = $.html();
    }
    if (!fragment || !String(fragment).trim()) {
        return '';
    }

    let md = turndown.turndown(fragment);
    md = md
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+\n/g, '\n')
        .trim();

    if (md.length > maxChars) {
        md = `${md.slice(0, maxChars)}\n\n[…truncated for LLM context]`;
    }
    return md;
}

/**
 * Pull article HTML from Motor JSON envelope or pass through raw HTML string.
 * @param {string} rawData
 * @returns {{ html: string | null, envelopeJson: object | null }}
 */
export function extractArticleHtmlFromMotorPayload(rawData) {
    const s = typeof rawData === 'string' ? rawData.trim() : '';
    if (!s) return { html: null, envelopeJson: null };
    if (s.startsWith('<')) {
        return { html: s, envelopeJson: null };
    }
    try {
        const j = JSON.parse(rawData);
        const html = j?.body?.html || j?.html || null;
        return { html: typeof html === 'string' ? html : null, envelopeJson: j };
    } catch {
        return { html: null, envelopeJson: null };
    }
}
