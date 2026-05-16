/**
 * Vertex AI text embeddings via @google/genai.
 * Model: text-embedding-004 (768-dim). Override via EMBEDDING_MODEL env var.
 * Replaces the former NVIDIA NIM OpenAI-compatible embeddings client.
 */
import { GoogleGenAI } from '@google/genai';
import pLimit from 'p-limit';

const PROJECT_ID = (process.env.GOOGLE_CLOUD_PROJECT || '').trim();
const LOCATION = (process.env.VERTEX_LOCATION || 'us-central1').trim();

let _ai = null;

function getGenAI() {
    if (_ai) return _ai;
    if (!PROJECT_ID) return null;
    _ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });
    return _ai;
}

// Vertex AI embeddings: up to 250 texts/request but rate-limited — cap concurrent calls.
const embedLimit = pLimit(8);

/**
 * @param {string[]} texts
 * @param {{ inputType?: 'query' | 'passage' }} [options]
 * @returns {Promise<{ success: boolean, vectors?: number[][], error?: string, dims?: number }>}
 */
export async function embedTextsBatch(texts, options = {}) {
    if (!Array.isArray(texts) || texts.length === 0) {
        return { success: true, vectors: [], dims: 0 };
    }
    const ai = getGenAI();
    if (!ai) {
        return { success: false, error: 'Set GOOGLE_CLOUD_PROJECT to enable embeddings' };
    }
    const model = (process.env.EMBEDDING_MODEL || 'text-embedding-004').trim();
    const taskType = options.inputType === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';

    try {
        const results = await Promise.all(
            texts.map(text =>
                embedLimit(() =>
                    ai.models.embedContent({
                        model,
                        contents: text,
                        config: { taskType },
                    })
                )
            )
        );
        const vectors = results.map(r => r.embeddings[0].values);
        const dims = vectors[0]?.length ?? 0;
        return { success: true, vectors, dims };
    } catch (e) {
        return { success: false, error: e.message || String(e) };
    }
}
