/**
 * L2 RAG query path: embed user text + pgvector RPC (match_content_chunks).
 */
import { embedTextsBatch } from './embedding_client.js';
import { matchContentChunksRpc } from './supabase.js';

const EXPECTED_DIMS = Number.parseInt(process.env.L2_EMBEDDING_DIMS || '1024', 10);

/**
 * Raw row from `matchContentChunksRpc` (internal camelCase).
 * @typedef {{
 *   chunkId: string,
 *   contentItemId: string,
 *   motorArticleId: string,
 *   canonicalSiloCode: string | null,
 *   contentSource: string | null,
 *   chunkIndex: number,
 *   text: string,
 *   score: number
 * }} L2ChunkRow
 */

/**
 * L1-aligned citation for RAG answers (design: cite content_item + article identity).
 * @param {L2ChunkRow} c
 */
function buildCitation(c) {
    return {
        content_item_id: c.contentItemId,
        motor_article_id: c.motorArticleId,
        canonical_silo_code: c.canonicalSiloCode ?? null,
        content_source: c.contentSource ?? null,
        chunk_id: c.chunkId,
        chunk_index: c.chunkIndex
    };
}

/**
 * Public API shape: snake_case ids + nested citation for L1 mapping.
 * @param {L2ChunkRow[]} rows
 * @returns {Array<{ text: string, content_item_id: string, score: number, citation: ReturnType<typeof buildCitation> }>}
 */
export function mapChunksToL2ApiResponse(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows.map((c) => {
        const content_item_id = c.contentItemId;
        return {
            text: c.text,
            content_item_id,
            score: c.score,
            citation: buildCitation(c)
        };
    });
}

/**
 * @param {{ vehicleExternalId: string, query: string, matchCount: number }} args
 * @returns {Promise<{ success: boolean, chunks?: L2ChunkRow[], error?: string }>}
 */
export async function runL2VehicleChunkSearch({ vehicleExternalId, query, matchCount }) {
    const { success, vectors, dims, error } = await embedTextsBatch([query], { inputType: 'query' });
    if (!success || !vectors?.[0]) {
        return { success: false, error: error || 'Embedding failed' };
    }
    if (dims !== EXPECTED_DIMS) {
        return {
            success: false,
            error: `Embedding dimension ${dims} does not match L2_EMBEDDING_DIMS ${EXPECTED_DIMS}`
        };
    }
    return matchContentChunksRpc({
        queryEmbedding: vectors[0],
        vehicleExternalId,
        matchCount
    });
}
