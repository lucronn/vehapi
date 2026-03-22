/**
 * NVIDIA Nemotron — multimodal (image / PDF page raster) text extraction.
 * Uses shared `nemotron_client.js` (NVIDIA_API_KEY / LLM_API_KEY, base URL).
 * @see docs/plans/2026-03-18-normalization-schema-design.md Appendix A
 */
import { Buffer } from 'node:buffer';
import { createCanvas } from 'canvas';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import logger from './logger.js';
import { getNemotronClient } from './nemotron_client.js';

/** Override via env; confirm ID in NVIDIA NIM / build catalog. */
const NEMOTRON_VISION_MODEL = (process.env.NEMOTRON_VISION_MODEL || 'nvidia/nemotron-nano-12b-v2-vl').trim();

const MAX_RETRIES = 3;

let _pdfWorkerConfigured = false;

function ensurePdfWorker(pdfjs) {
    if (_pdfWorkerConfigured) return;
    const here = dirname(fileURLToPath(import.meta.url));
    const workerPath = join(here, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    _pdfWorkerConfigured = true;
}

function stripJsonFences(fullContent) {
    let t = fullContent.trim();
    if (t.startsWith('```json')) t = t.replace(/^```json\n?/, '');
    else if (t.startsWith('```')) t = t.replace(/^```\n?/, '');
    if (t.endsWith('```')) t = t.replace(/\n?```$/, '');
    return t.trim();
}

/**
 * OpenAI-compatible multimodal chat (text + image_url data URIs or HTTPS URLs).
 *
 * @param {Array<{type:'text',text:string}|{type:'image_url',image_url:{url:string}}>} userContentParts
 * @param {object} [options]
 * @param {object|null} [options.schema] If set, first message part becomes JSON-schema instructions + your parts follow
 * @param {string|null} [options.model] Override vision model id
 * @param {number} [options.maxTokens]
 * @returns {Promise<string>} Model text (JSON string if schema was set)
 */
export async function callNemotronMultimodal(userContentParts, options = {}) {
    const { schema = null, model = null, maxTokens = 8192 } = options;
    const openai = getNemotronClient();
    if (!openai) {
        throw new Error('Nemotron unavailable — set NVIDIA_API_KEY, NVAPI_KEY, or LLM_API_KEY');
    }

    let content = userContentParts;
    if (schema) {
        const schemaInstruction =
            'CRITICAL: You MUST return ONLY valid JSON matching this exact schema (no markdown fences, no commentary):\n' +
            JSON.stringify(schema, null, 2);
        content = [{ type: 'text', text: schemaInstruction }, ...userContentParts];
    }

    const useModel = model || NEMOTRON_VISION_MODEL;
    const messages = [{ role: 'user', content }];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const completion = await openai.chat.completions.create({
                model: useModel,
                messages,
                max_tokens: maxTokens,
                temperature: 0.2,
                stream: false
            });

            let fullContent = completion.choices[0]?.message?.content || '';
            if (!fullContent) {
                throw new Error('Nemotron multimodal returned empty content');
            }
            if (schema) {
                fullContent = stripJsonFences(fullContent);
            }
            return fullContent;
        } catch (error) {
            logger.warn(`Nemotron multimodal API error (attempt ${attempt + 1}): ${error.message}`);
            if (attempt === MAX_RETRIES) throw error;
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
    }
}

/**
 * Rasterize one PDF page to a PNG data URI for vision models.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer} pdfBuffer
 * @param {number} [pageIndexZeroBased]
 * @param {number} [scale] Viewport scale (e.g. 1.5–2 for readability)
 * @returns {Promise<string>} `data:image/png;base64,...`
 */
export async function rasterizePdfPageToPngDataUri(pdfBuffer, pageIndexZeroBased = 0, scale = 1.75) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    ensurePdfWorker(pdfjs);

    // pdf.js rejects Node Buffer (even though it extends Uint8Array).
    let raw;
    if (Buffer.isBuffer(pdfBuffer)) {
        raw = new Uint8Array(pdfBuffer);
    } else if (pdfBuffer instanceof ArrayBuffer) {
        raw = new Uint8Array(pdfBuffer);
    } else if (pdfBuffer instanceof Uint8Array) {
        raw = pdfBuffer;
    } else {
        raw = new Uint8Array(pdfBuffer);
    }

    const pdf = await pdfjs.getDocument({ data: raw, useSystemFonts: true, verbosity: 0 }).promise;
    const pageNum = pageIndexZeroBased + 1;
    if (pageNum < 1 || pageNum > pdf.numPages) {
        throw new Error(`PDF page index ${pageIndexZeroBased} invalid (numPages=${pdf.numPages})`);
    }

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const w = Math.max(1, Math.floor(viewport.width));
    const h = Math.max(1, Math.floor(viewport.height));
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const buf = canvas.toBuffer('image/png');
    return `data:image/png;base64,${buf.toString('base64')}`;
}

const DEFAULT_IMAGE_INSTRUCTION =
    'You are extracting text from an automotive service document image (TSB, DTC, wiring diagram, component location, etc.). ' +
    'Transcribe ALL visible text in reading order. Use newlines between blocks. Do not invent content. ' +
    'If there is no readable text, respond exactly with: (no text visible)';

/**
 * Send one image (data URI or https URL) to Nemotron vision and return plain transcription.
 *
 * @param {string} imageDataUriOrUrl e.g. data:image/png;base64,... or https://...
 * @param {object} [options]
 * @param {string} [options.instruction]
 * @param {string} [options.model]
 */
export async function extractTextFromImageDataUri(imageDataUriOrUrl, options = {}) {
    const instruction = options.instruction || DEFAULT_IMAGE_INSTRUCTION;
    const parts = [
        { type: 'text', text: instruction },
        { type: 'image_url', image_url: { url: imageDataUriOrUrl } }
    ];
    return callNemotronMultimodal(parts, { schema: null, model: options.model || null });
}

/**
 * Rasterize a PDF page to PNG, then transcribe via Nemotron vision.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer} pdfBuffer
 * @param {number} [pageIndexZeroBased]
 * @param {object} [options] Passed to extractTextFromImageDataUri + optional scale
 */
export async function extractTextFromPdfPageViaNemotron(pdfBuffer, pageIndexZeroBased = 0, options = {}) {
    const { scale = 1.75, ...rest } = options;
    const dataUri = await rasterizePdfPageToPngDataUri(pdfBuffer, pageIndexZeroBased, scale);
    return extractTextFromImageDataUri(dataUri, rest);
}
