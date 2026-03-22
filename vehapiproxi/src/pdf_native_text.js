/**
 * Extract embedded text from PDF bytes (no OCR). Uses pdf.js legacy build.
 * Prefer this before Nemotron multimodal when text layers exist.
 */
import { Buffer } from 'node:buffer';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

let _pdfWorkerConfigured = false;

function ensurePdfWorker(pdfjs) {
    if (_pdfWorkerConfigured) return;
    const here = dirname(fileURLToPath(import.meta.url));
    const workerPath = join(here, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    _pdfWorkerConfigured = true;
}

function toUint8Array(pdfBuffer) {
    if (Buffer.isBuffer(pdfBuffer)) {
        return new Uint8Array(pdfBuffer);
    }
    if (pdfBuffer instanceof ArrayBuffer) {
        return new Uint8Array(pdfBuffer);
    }
    if (pdfBuffer instanceof Uint8Array) {
        return pdfBuffer;
    }
    return new Uint8Array(pdfBuffer);
}

/**
 * @param {Buffer|Uint8Array|ArrayBuffer} pdfBuffer
 * @param {{ maxPages?: number }} [options] default maxPages 50
 * @returns {Promise<string>} Concatenated text per page
 */
export async function extractTextFromPdfBuffer(pdfBuffer, options = {}) {
    const maxPages = options.maxPages ?? 50;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    ensurePdfWorker(pdfjs);

    const data = toUint8Array(pdfBuffer);
    const pdf = await pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
    const n = Math.min(pdf.numPages, maxPages);
    const parts = [];

    for (let i = 1; i <= n; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        const line = tc.items.map((it) => ('str' in it ? it.str : '')).join(' ');
        if (line.trim()) {
            parts.push(line.trim());
        }
    }

    return parts.join('\n\n').trim();
}

/**
 * @param {string} base64Pdf Raw base64 (no data: prefix) or full data URI
 */
export async function extractTextFromPdfBase64(base64Pdf, options = {}) {
    if (!base64Pdf || typeof base64Pdf !== 'string') {
        return '';
    }
    let b64 = base64Pdf.trim();
    const dataUri = /^data:application\/pdf;base64,/i.exec(b64);
    if (dataUri) {
        b64 = b64.slice(dataUri[0].length);
    }
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) {
        return '';
    }
    return extractTextFromPdfBuffer(buf, options);
}
