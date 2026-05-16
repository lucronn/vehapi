/**
 * L2: chunk + embed + write `content_chunk` (opt-in via ENABLE_L2_EMBEDDINGS).
 *
 * Chunking strategy: always prefer cleaned HTML prose (via htmlToMarkdownForLlm) over
 * JSON-stringified parsed data. Prose contains full narrative context (descriptions,
 * warnings, notes) which is richer for semantic retrieval than structured JSON.
 * Structured data (specs, part numbers, exact values) is kept in DB tables for exact lookups.
 */
import logger from './logger.js';
import { htmlToMarkdownForLlm } from './html_preprocess.js';
import { chunkTextForEmbedding } from './text_chunk.js';
import { embedTextsBatch } from './embedding_client.js';
import {
    fetchContentItemId,
    replaceContentChunksForContentItem
} from './supabase.js';

const EXPECTED_DIMS = Number.parseInt(process.env.L2_EMBEDDING_DIMS || '768', 10);
const BATCH = Math.max(1, Number.parseInt(process.env.L2_EMBED_BATCH_SIZE || '200', 10));

/**
 * Build the text to chunk and embed.
 * Priority: HTML prose markdown > structured JSON fallback.
 * Prose is far richer for semantic search; JSON is last resort for spec-only articles.
 */
function buildRagSourceText(targetSchema, htmlContent, parsedData) {
    // Primary: HTML prose — best semantic signal
    if (typeof htmlContent === 'string' && htmlContent.trim().length > 80) {
        const md = htmlToMarkdownForLlm(htmlContent, { maxChars: 200000 });
        if (md && md.trim().length > 80) {
            return `kind:${targetSchema}\n\n${md}`;
        }
    }

    // Fallback for specs/dtcs where the structured data is the full content:
    // Render a human-readable summary rather than raw JSON
    if (parsedData) {
        try {
            const text = renderParsedDataAsText(targetSchema, parsedData);
            if (text && text.length > 40) return `kind:${targetSchema}\n\n${text}`;
        } catch {
            /* ignore */
        }
    }
    return '';
}

/**
 * Render structured parsed data as readable prose for chunking.
 * Better than JSON.stringify for semantic search.
 */
function renderParsedDataAsText(targetSchema, parsedData) {
    const rows = Array.isArray(parsedData) ? parsedData : [parsedData];

    if (targetSchema === 'dtcs') {
        return rows.map(d => {
            const parts = [`DTC ${d.code}: ${d.description || ''}`];
            if (d.possible_causes?.length) parts.push(`Causes: ${d.possible_causes.join('; ')}`);
            if (d.symptoms?.length) parts.push(`Symptoms: ${d.symptoms.join('; ')}`);
            if (d.monitor_strategy) parts.push(`Monitor: ${d.monitor_strategy}`);
            if (d.diagnostic_steps?.length) {
                parts.push('Diagnostic steps: ' + d.diagnostic_steps.map(s => `${s.order + 1}. ${s.test}`).join(' '));
            }
            return parts.join('\n');
        }).join('\n\n');
    }

    if (targetSchema === 'tsbs') {
        return rows.map(t => {
            const parts = [`TSB ${t.bulletin_number}: ${t.title || ''}`];
            if (t.summary) parts.push(t.summary);
            if (t.content) parts.push(t.content.slice(0, 2000));
            if (t.affected_components?.length) parts.push(`Affects: ${t.affected_components.join(', ')}`);
            return parts.join('\n');
        }).join('\n\n');
    }

    if (targetSchema === 'specifications') {
        return rows.map(s =>
            `${s.category} — ${s.name}: ${s.value}${s.unit ? ' ' + s.unit : ''}${s.display_text ? ' (' + s.display_text + ')' : ''}`
        ).join('\n');
    }

    if (targetSchema === 'procedures') {
        const p = Array.isArray(parsedData) ? parsedData[0] : parsedData;
        if (!p) return '';
        const parts = [p.title || 'Procedure', p.description || ''];
        if (p.steps?.length) parts.push(p.steps.map((s, i) => `${i + 1}. ${s.text}`).join('\n'));
        if (p.tools_required?.length) parts.push(`Tools: ${p.tools_required.join(', ')}`);
        return parts.filter(Boolean).join('\n\n');
    }

    return JSON.stringify(parsedData).slice(0, 4000);
}

/**
 * @param {{ taskId: string, vehicleExternalId: string, motorArticleId: string, contentSource: string, targetSchema: string, htmlContent: string | null, parsedData: unknown }} ctx
 */
export async function ingestL2ContentChunksIfEnabled(ctx) {
    const enabled = String(process.env.ENABLE_L2_EMBEDDINGS || '').toLowerCase() === 'true';
    if (!enabled) return;

    const { taskId, vehicleExternalId, motorArticleId, contentSource, targetSchema, htmlContent, parsedData } =
        ctx;

    if (!vehicleExternalId || !motorArticleId || !contentSource) return;

    const text = buildRagSourceText(targetSchema, htmlContent, parsedData);
    if (!text || text.length < 80) {
        logger.info(`[${taskId}] L2 ingest skipped — not enough text`);
        return;
    }

    // Larger chunks for prose (2400 chars ≈ ~600 tokens) — captures full paragraphs/steps
    const maxChunkChars = Number.parseInt(process.env.L2_CHUNK_MAX_CHARS || '2400', 10);
    const overlap = Number.parseInt(process.env.L2_CHUNK_OVERLAP || '200', 10);
    const chunks = chunkTextForEmbedding(text, { maxChunkChars, overlap });
    if (chunks.length === 0) {
        logger.info(`[${taskId}] L2 ingest skipped — no chunks`);
        return;
    }

    const contentItemId = await fetchContentItemId(vehicleExternalId, motorArticleId, contentSource);
    if (!contentItemId) {
        logger.warn(`[${taskId}] L2 ingest skipped — no content_item row (phase1 migration?)`);
        return;
    }

    const allVectors = [];
    for (let i = 0; i < chunks.length; i += BATCH) {
        const batch = chunks.slice(i, i + BATCH);
        const { success, vectors, dims, error } = await embedTextsBatch(batch, { inputType: 'passage' });
        if (!success || !vectors) {
            logger.warn(`[${taskId}] L2 embedding failed: ${error || 'unknown'}`);
            return;
        }
        if (dims && dims !== EXPECTED_DIMS) {
            logger.warn(
                `[${taskId}] L2 ingest skipped — embedding dim ${dims} !== L2_EMBEDDING_DIMS ${EXPECTED_DIMS} (change model or DB column)`
            );
            return;
        }
        for (const v of vectors) {
            if (v.length !== EXPECTED_DIMS) {
                logger.warn(`[${taskId}] L2 ingest skipped — vector length ${v.length} !== ${EXPECTED_DIMS}`);
                return;
            }
        }
        allVectors.push(...vectors);
    }

    if (allVectors.length !== chunks.length) {
        logger.warn(`[${taskId}] L2 ingest aborted — embedding count mismatch`);
        return;
    }

    const rows = chunks.map((text_content, idx) => ({
        chunk_index: idx,
        text_content,
        embedding: allVectors[idx]
    }));

    const rep = await replaceContentChunksForContentItem(contentItemId, rows);
    if (!rep.success) {
        logger.warn(`[${taskId}] L2 content_chunk write failed: ${rep.error}`);
        return;
    }
    logger.info(`[${taskId}] L2 ingest: ${rows.length} chunk(s) for content_item ${contentItemId}`);
}
