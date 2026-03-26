/**
 * OpenAI-compatible embeddings (NVIDIA NIM — same client as chat unless EMBEDDING_BASE_URL overrides).
 */
import OpenAI from 'openai';
import { getNemotronApiKey, resolveNemotronBaseUrl } from './nemotron_client.js';

let _embeddingClient = null;

function getEmbeddingOpenAI() {
    if (_embeddingClient) return _embeddingClient;
    const apiKey = getNemotronApiKey();
    if (!apiKey) return null;
    const base =
        (process.env.EMBEDDING_BASE_URL || '').trim().replace(/\/+$/, '') || resolveNemotronBaseUrl();
    _embeddingClient = new OpenAI({ apiKey, baseURL: base });
    return _embeddingClient;
}

/**
 * @param {string[]} texts
 * @param {{ inputType?: 'query' | 'passage' }} [options] — NVIDIA nv-embedqa-e5 (and similar asymmetric models) require `input_type` on the embeddings endpoint; ingest uses `passage`, search uses `query`.
 * @returns {Promise<{ success: boolean, vectors?: number[][], error?: string, dims?: number }>}
 */
export async function embedTextsBatch(texts, options = {}) {
    if (!Array.isArray(texts) || texts.length === 0) {
        return { success: true, vectors: [], dims: 0 };
    }
    const client = getEmbeddingOpenAI();
    if (!client) {
        return { success: false, error: 'No NVIDIA/LLM API key for embeddings' };
    }
    const model = (process.env.EMBEDDING_MODEL || '').trim();
    if (!model) {
        return { success: false, error: 'Set EMBEDDING_MODEL (e.g. nvidia/nv-embedqa-e5-v5) when using L2 embeddings' };
    }
    const omitInputType = String(process.env.EMBEDDING_OMIT_INPUT_TYPE || '').toLowerCase() === 'true';
    const inputType = options.inputType;
    try {
        /** @type {Record<string, unknown>} */
        const body = {
            model,
            input: texts
        };
        if (!omitInputType && (inputType === 'query' || inputType === 'passage')) {
            body.input_type = inputType;
        }
        const res = await client.embeddings.create(body);
        const sorted = [...res.data].sort((a, b) => a.index - b.index);
        const vectors = sorted.map((d) => d.embedding);
        const dims = vectors[0]?.length ?? 0;
        return { success: true, vectors, dims };
    } catch (e) {
        return { success: false, error: e.message || String(e) };
    }
}
