/**
 * Split long text into overlapping chunks for embedding (L2 RAG).
 */

/**
 * @param {string} text
 * @param {{ maxChunkChars?: number, overlap?: number }} [opts]
 * @returns {string[]}
 */
export function chunkTextForEmbedding(text, opts = {}) {
    const maxChunkChars = opts.maxChunkChars ?? 1800;
    const overlap = Math.min(opts.overlap ?? 120, Math.floor(maxChunkChars / 4));

    const raw = typeof text === 'string' ? text.trim() : '';
    if (!raw) return [];
    if (raw.length <= maxChunkChars) return [raw];

    const chunks = [];
    const step = Math.max(1, maxChunkChars - overlap);
    for (let i = 0; i < raw.length; i += step) {
        const piece = raw.slice(i, i + maxChunkChars).trim();
        if (piece.length >= 20) chunks.push(piece);
    }
    return chunks.length > 0 ? chunks : [raw.slice(0, maxChunkChars).trim()];
}
