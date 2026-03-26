/**
 * L2: chunk + embed + write `content_chunk` (opt-in via ENABLE_L2_EMBEDDINGS).
 */
import logger from './logger.js';
import { htmlToMarkdownForLlm } from './html_preprocess.js';
import { chunkTextForEmbedding } from './text_chunk.js';
import { embedTextsBatch } from './embedding_client.js';
import {
    fetchContentItemId,
    replaceContentChunksForContentItem
} from './supabase.js';

const EXPECTED_DIMS = Number.parseInt(process.env.L2_EMBEDDING_DIMS || '1024', 10);
const BATCH = Math.max(1, Number.parseInt(process.env.L2_EMBED_BATCH_SIZE || '16', 10));

function buildRagSourceText(targetSchema, htmlContent, parsedData) {
    if (typeof htmlContent === 'string' && htmlContent.trim().length > 80) {
        const md = htmlToMarkdownForLlm(htmlContent);
        if (md && md.trim().length > 80) {
            return `kind:${targetSchema}\n\n${md}`;
        }
    }
    try {
        const s = JSON.stringify(parsedData ?? null);
        if (s && s.length > 40) return `kind:${targetSchema}\n\n${s}`;
    } catch {
        /* ignore */
    }
    return '';
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

    const maxChunkChars = Number.parseInt(process.env.L2_CHUNK_MAX_CHARS || '1800', 10);
    const overlap = Number.parseInt(process.env.L2_CHUNK_OVERLAP || '120', 10);
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
