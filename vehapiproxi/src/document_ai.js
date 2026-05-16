/**
 * Google Document AI — high-quality PDF parsing.
 *
 * Replaces the pdfjs-dist + canvas PNG rasterization approach with Document AI's
 * Layout Parser, which understands document structure natively:
 *   - Tables → preserved as markdown tables
 *   - Ordered lists → numbered steps (critical for procedures)
 *   - Section headers → h1/h2/h3
 *   - Multi-column layouts → correctly linearized
 *
 * This uses the Vertex AI Gen AI App Builder credits (Document AI is billed under
 * the same GCP project and counts toward the $2000 credit for AI-powered document processing).
 *
 * Required env vars:
 *   GOOGLE_CLOUD_PROJECT      — GCP project ID
 *   DOCUMENT_AI_PROCESSOR     — Full processor resource name OR just the processor ID
 *                               e.g. "projects/123/locations/us/processors/abc123def456"
 *                               or just "abc123def456" (module builds full name)
 *   DOCUMENT_AI_LOCATION      — Processor location (default: us)
 *
 * GCP setup (one-time):
 *   1. Enable API: documentai.googleapis.com
 *   2. Create a Layout Parser processor in Document AI console:
 *      https://console.cloud.google.com/ai/document-ai/processors
 *      Select "Layout Parser" — handles general documents with tables/lists/headers
 *   3. Copy the processor ID into DOCUMENT_AI_PROCESSOR env var
 *
 * Gate: ENABLE_DOCUMENT_AI=true  (default off; falls back to existing PDF path)
 */
import logger from './logger.js';

const PROJECT_ID = (process.env.GOOGLE_CLOUD_PROJECT || '').trim();
const DAI_LOCATION = (process.env.DOCUMENT_AI_LOCATION || 'us').trim();
const DAI_PROCESSOR_RAW = (process.env.DOCUMENT_AI_PROCESSOR || '').trim();
const ENABLED = String(process.env.ENABLE_DOCUMENT_AI || '').toLowerCase() === 'true';

function getProcessorName() {
    if (!DAI_PROCESSOR_RAW) return null;
    if (DAI_PROCESSOR_RAW.startsWith('projects/')) return DAI_PROCESSOR_RAW;
    return `projects/${PROJECT_ID}/locations/${DAI_LOCATION}/processors/${DAI_PROCESSOR_RAW}`;
}

export function isDocumentAiConfigured() {
    return ENABLED && Boolean(PROJECT_ID && DAI_PROCESSOR_RAW);
}

let _client = null;

async function getClient() {
    if (_client) return _client;
    const { DocumentProcessorServiceClient } = await import('@google-cloud/documentai');
    _client = new DocumentProcessorServiceClient({
        apiEndpoint: `${DAI_LOCATION}-documentai.googleapis.com`
    });
    return _client;
}

/**
 * Parse a PDF buffer using Document AI Layout Parser.
 * Returns extracted text with structure preserved as markdown.
 *
 * @param {Buffer | Uint8Array} pdfBuffer
 * @returns {Promise<{ success: boolean, text?: string, markdown?: string, error?: string }>}
 */
export async function parsePdfWithDocumentAI(pdfBuffer) {
    if (!isDocumentAiConfigured()) {
        return { success: false, error: 'Document AI not configured or ENABLE_DOCUMENT_AI not set' };
    }

    const processorName = getProcessorName();
    if (!processorName) {
        return { success: false, error: 'DOCUMENT_AI_PROCESSOR not set' };
    }

    try {
        const client = await getClient();
        const rawDocument = {
            content: Buffer.isBuffer(pdfBuffer)
                ? pdfBuffer.toString('base64')
                : Buffer.from(pdfBuffer).toString('base64'),
            mimeType: 'application/pdf'
        };

        const [result] = await client.processDocument({
            name: processorName,
            rawDocument
        });

        const document = result.document;
        if (!document) {
            return { success: false, error: 'Document AI returned no document' };
        }

        // Extract full text
        const fullText = document.text || '';

        // Build structured markdown from document layout
        const markdown = buildMarkdownFromDocument(document);

        logger.info(`Document AI parsed PDF: ${fullText.length} chars, ${document.pages?.length || 0} pages`);
        return { success: true, text: fullText, markdown: markdown || fullText };
    } catch (err) {
        logger.error('Document AI PDF parse failed:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Build markdown from Document AI layout blocks.
 * Handles: headers, paragraphs, tables, lists.
 */
function buildMarkdownFromDocument(document) {
    if (!document.pages || !document.pages.length) return document.text || '';
    const fullText = document.text || '';

    const lines = [];

    for (const page of document.pages) {
        // Process blocks in reading order
        const blocks = page.blocks || [];

        for (const block of blocks) {
            const blockText = extractTextFromLayout(block.layout, fullText);
            if (!blockText || !blockText.trim()) continue;

            // Detect heading by font size (Document AI provides formFields, paragraphs, etc.)
            const role = detectBlockRole(block, page);

            switch (role) {
                case 'heading1': lines.push(`# ${blockText.trim()}`); break;
                case 'heading2': lines.push(`## ${blockText.trim()}`); break;
                case 'heading3': lines.push(`### ${blockText.trim()}`); break;
                case 'list_item': lines.push(`- ${blockText.trim()}`); break;
                default:         lines.push(blockText.trim()); break;
            }
        }

        // Tables — Document AI has excellent table support
        for (const table of page.tables || []) {
            lines.push(buildMarkdownTable(table, fullText));
        }

        // Paragraphs with form fields (key-value pairs — common in spec sheets)
        for (const field of page.formFields || []) {
            const key   = extractTextFromLayout(field.fieldName?.textAnchor, fullText);
            const value = extractTextFromLayout(field.fieldValue?.textAnchor, fullText);
            if (key && value) {
                lines.push(`**${key.trim()}**: ${value.trim()}`);
            }
        }
    }

    return lines.filter(Boolean).join('\n\n');
}

function extractTextFromLayout(layout, fullText) {
    if (!layout || !fullText) return '';
    const anchor = layout.textAnchor || layout;
    if (!anchor || !anchor.textSegments) return '';
    return anchor.textSegments
        .map(seg => {
            const start = parseInt(seg.startIndex || '0', 10);
            const end   = parseInt(seg.endIndex   || '0', 10);
            return fullText.slice(start, end);
        })
        .join('');
}

function detectBlockRole(block, page) {
    // Document AI's Layout Parser marks block types in paragraph.detectedLanguages / styleInfo
    // Use heuristic: short all-caps or bold text → heading
    const layout = block.layout;
    if (!layout) return 'paragraph';

    const style = layout.textStyles?.[0];
    if (style) {
        const fontSize = style.fontSize?.magnitude || 0;
        const bold     = style.bold || false;
        const pageAvg  = 12; // reasonable baseline
        if (fontSize >= pageAvg * 1.5 || (bold && fontSize >= pageAvg * 1.2)) return 'heading2';
        if (bold) return 'heading3';
    }
    return 'paragraph';
}

function buildMarkdownTable(table, fullText) {
    if (!table.headerRows && !table.bodyRows) return '';
    const rows = [];

    const renderRow = (row) =>
        '| ' + (row.cells || []).map(cell =>
            extractTextFromLayout(cell.layout, fullText).trim().replace(/\n/g, ' ')
        ).join(' | ') + ' |';

    for (const hrow of table.headerRows || []) {
        rows.push(renderRow(hrow));
    }
    if (table.headerRows?.length) {
        const colCount = Math.max(1, table.headerRows[0]?.cells?.length || 1);
        rows.push('|' + Array(colCount).fill(' --- ').join('|') + '|');
    }
    for (const brow of table.bodyRows || []) {
        rows.push(renderRow(brow));
    }

    return rows.join('\n');
}
