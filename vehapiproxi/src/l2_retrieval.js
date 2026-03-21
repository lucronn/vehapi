/**
 * L2 RAG query path: embed user text + pgvector RPC (match_content_chunks).
 */
import { embedTextsBatch } from './embedding_client.js';
import { matchContentChunksRpc } from './supabase.js';

const EXPECTED_DIMS = Number.parseInt(process.env.L2_EMBEDDING_DIMS || '1024', 10);

/**
 * @param {{ vehicleExternalId: string, query: string, matchCount: number }} args
 * @returns {Promise<{ success: boolean, chunks?: Array<Record<string, unknown>>, error?: string }>}
 */
export async function runL2VehicleChunkSearch({ vehicleExternalId, query, matchCount }) {
    const { success, vectors, dims, error } = await embedTextsBatch([query]);
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
