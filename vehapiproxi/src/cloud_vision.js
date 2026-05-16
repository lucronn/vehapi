/**
 * Google Cloud Vision API — OCR for PDFs and images.
 *
 * Uses an API key from a separate GCP account (not the same project as Vertex AI).
 * Vision API's DOCUMENT_TEXT_DETECTION is purpose-built for dense text extraction:
 * better than Gemini vision for scanned PDFs, tables, diagrams with labels,
 * and image-heavy Motor service articles.
 *
 * Two surfaces:
 *   extractTextFromPdfWithVision(pdfBuffer)     — PDF → full text (all pages, no rasterization)
 *   extractTextFromImageWithVision(base64orUrl) — image → text (DOCUMENT_TEXT_DETECTION)
 *
 * Required env var:
 *   CLOUD_VISION_API_KEY — API key from the GCP account that has Cloud Vision API enabled.
 *                          Do NOT commit this value. Set via Secret Manager or env var injection.
 *
 * Rate limits (Vision API, per-key defaults):
 *   images:annotate    — 1800 req/min
 *   files:annotate     — 600 req/min (PDF)
 * Motor articles are low-volume; no extra throttling needed.
 */
import logger from './logger.js';

const API_KEY = (process.env.CLOUD_VISION_API_KEY || '').trim();
const VISION_BASE = 'https://vision.googleapis.com/v1';

export function isVisionConfigured() {
    return Boolean(API_KEY);
}

// ---------------------------------------------------------------------------
// PDF text extraction — Vision API processes PDFs natively, no rasterization
// ---------------------------------------------------------------------------

/**
 * Extract text from a PDF buffer using Cloud Vision DOCUMENT_TEXT_DETECTION.
 * Processes up to 5 pages synchronously (covers all Motor service PDFs).
 * For larger PDFs only the first 5 pages are sent.
 *
 * @param {Buffer | Uint8Array} pdfBuffer
 * @param {{ maxPages?: number }} [options]
 * @returns {Promise<{ success: boolean, text?: string, error?: string }>}
 */
export async function extractTextFromPdfWithVision(pdfBuffer, options = {}) {
    if (!isVisionConfigured()) {
        return { success: false, error: 'CLOUD_VISION_API_KEY not set' };
    }

    const maxPages = Math.min(options.maxPages ?? 5, 5); // sync endpoint max 5 pages
    const pageNumbers = Array.from({ length: maxPages }, (_, i) => i + 1);

    const b64 = Buffer.isBuffer(pdfBuffer)
        ? pdfBuffer.toString('base64')
        : Buffer.from(pdfBuffer).toString('base64');

    const body = {
        requests: [{
            inputConfig: {
                content: b64,
                mimeType: 'application/pdf'
            },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            pages: pageNumbers
        }]
    };

    try {
        const res = await fetch(`${VISION_BASE}/files:annotate?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const err = await res.text();
            logger.warn(`Cloud Vision PDF [${res.status}]: ${err.slice(0, 300)}`);
            return { success: false, error: `Vision API ${res.status}` };
        }

        const data = await res.json();
        const text = data.responses
            ?.flatMap(r => r.responses ?? [r])
            ?.map(r => r.fullTextAnnotation?.text || '')
            ?.join('\n\n')
            ?.trim() ?? '';

        if (!text) {
            return { success: false, error: 'Vision API returned no text' };
        }

        logger.info(`Cloud Vision PDF: ${text.length} chars extracted`);
        return { success: true, text };
    } catch (err) {
        logger.error('Cloud Vision PDF extraction failed:', err);
        return { success: false, error: err.message };
    }
}

// ---------------------------------------------------------------------------
// Image text extraction — inline images in HTML articles
// ---------------------------------------------------------------------------

/**
 * Extract text from an image (data URI or HTTPS URL) using DOCUMENT_TEXT_DETECTION.
 * Better than Gemini vision for pure OCR: reads dense labels, tables, part numbers.
 *
 * @param {string} imageDataUriOrUrl  data:image/...;base64,... or https://...
 * @returns {Promise<{ success: boolean, text?: string, error?: string }>}
 */
export async function extractTextFromImageWithVision(imageDataUriOrUrl) {
    if (!isVisionConfigured()) {
        return { success: false, error: 'CLOUD_VISION_API_KEY not set' };
    }

    let imagePayload;
    if (imageDataUriOrUrl.startsWith('data:')) {
        // Strip the data URI prefix — Vision API wants raw base64
        const base64 = imageDataUriOrUrl.replace(/^data:[^;]+;base64,/, '');
        imagePayload = { content: base64 };
    } else {
        imagePayload = { source: { imageUri: imageDataUriOrUrl } };
    }

    const body = {
        requests: [{
            image: imagePayload,
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
        }]
    };

    try {
        const res = await fetch(`${VISION_BASE}/images:annotate?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const err = await res.text();
            logger.warn(`Cloud Vision image [${res.status}]: ${err.slice(0, 300)}`);
            return { success: false, error: `Vision API ${res.status}` };
        }

        const data = await res.json();
        const text = data.responses?.[0]?.fullTextAnnotation?.text?.trim() ?? '';

        if (!text) {
            return { success: false, error: 'No text detected' };
        }

        return { success: true, text };
    } catch (err) {
        logger.error('Cloud Vision image extraction failed:', err);
        return { success: false, error: err.message };
    }
}
