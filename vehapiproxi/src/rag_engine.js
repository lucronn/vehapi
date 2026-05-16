/**
 * Vertex AI RAG Engine — managed corpus, retrieval, and grounded generation.
 *
 * Uses the $2000 Gen AI App Builder credits via Vertex AI Search / RAG Engine APIs.
 *
 * Replaces pgvector for semantic search over article prose with:
 *   - Managed chunking at semantic boundaries
 *   - Hybrid BM25 + vector retrieval
 *   - Semantic Ranker reranking
 *   - Native Gemini grounding (answers stay anchored to corpus documents)
 *
 * Required env vars:
 *   GOOGLE_CLOUD_PROJECT   — GCP project ID
 *   VERTEX_RAG_CORPUS      — Full corpus resource name OR short ID
 *                            e.g. "projects/vehapi-torque/locations/us-central1/ragCorpora/1234567890"
 *                            or just "1234567890" (module builds full name)
 *   VERTEX_LOCATION        — GCP region (default us-central1)
 *
 * GCP setup (one-time, run from gcloud):
 *   1. Enable APIs: aiplatform.googleapis.com, discoveryengine.googleapis.com
 *   2. Create a corpus:
 *      gcloud ai rag-corpora create \
 *        --display-name="vehapi-motor-articles" \
 *        --embedding-model-config-publisher-model="publishers/google/models/text-embedding-004" \
 *        --region=us-central1
 *   3. Copy the corpus resource name into VERTEX_RAG_CORPUS env var.
 */
import { GoogleAuth } from 'google-auth-library';
import logger from './logger.js';

const PROJECT_ID = (process.env.GOOGLE_CLOUD_PROJECT || '').trim();
const LOCATION = (process.env.VERTEX_LOCATION || 'us-central1').trim();
const RAG_CORPUS_RAW = (process.env.VERTEX_RAG_CORPUS || '').trim();

const _auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCorpusName() {
    if (!RAG_CORPUS_RAW) return null;
    if (RAG_CORPUS_RAW.startsWith('projects/')) return RAG_CORPUS_RAW;
    return `projects/${PROJECT_ID}/locations/${LOCATION}/ragCorpora/${RAG_CORPUS_RAW}`;
}

function isConfigured() {
    return Boolean(PROJECT_ID && RAG_CORPUS_RAW);
}

async function authFetch(url, init = {}) {
    const token = await _auth.getAccessToken();
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Content-Type', 'application/json');
    return globalThis.fetch(url, { ...init, headers });
}

function ragApiBase() {
    return `https://${LOCATION}-aiplatform.googleapis.com/v1beta1`;
}

// ---------------------------------------------------------------------------
// Corpus management
// ---------------------------------------------------------------------------

/**
 * List all RAG corpora in the project.
 */
export async function listCorpora() {
    const url = `${ragApiBase()}/projects/${PROJECT_ID}/locations/${LOCATION}/ragCorpora`;
    const res = await authFetch(url, { method: 'GET' });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`listCorpora failed [${res.status}]: ${t.slice(0, 500)}`);
    }
    const data = await res.json();
    return data.ragCorpora || [];
}

/**
 * Create a new RAG corpus backed by text-embedding-004.
 * Returns the created corpus resource name.
 */
export async function createCorpus(displayName = 'vehapi-motor-articles') {
    const url = `${ragApiBase()}/projects/${PROJECT_ID}/locations/${LOCATION}/ragCorpora`;
    const body = {
        displayName,
        ragEmbeddingModelConfig: {
            vertexPredictionEndpoint: {
                publisherModel: `publishers/google/models/text-embedding-004`
            }
        }
    };
    const res = await authFetch(url, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`createCorpus failed [${res.status}]: ${t.slice(0, 500)}`);
    }
    const op = await res.json();
    logger.info(`RAG corpus creation operation started: ${op.name}`);
    return op;
}

// ---------------------------------------------------------------------------
// Document ingestion
// ---------------------------------------------------------------------------

/**
 * Upload a text document to the RAG corpus.
 * The RAG Engine handles chunking, embedding, and indexing.
 *
 * @param {{ text: string, displayName: string, metadataJson?: object }} doc
 * @returns {Promise<{ success: boolean, ragFileId?: string, error?: string }>}
 */
export async function uploadTextToCorpus(doc) {
    const corpusName = getCorpusName();
    if (!corpusName) return { success: false, error: 'VERTEX_RAG_CORPUS not configured' };
    if (!doc.text || doc.text.trim().length < 50) {
        return { success: false, error: 'Text too short to upload' };
    }

    const url = `${ragApiBase()}/${corpusName}/ragFiles:upload`;
    const body = {
        ragFile: {
            displayName: doc.displayName || 'article',
            directUploadSource: {
                ragFileContent: {
                    rawContent: Buffer.from(doc.text, 'utf-8').toString('base64')
                }
            }
        },
        uploadRagFileConfig: {
            ragFileChunkingConfig: {
                chunkSize: 512,   // tokens — RAG Engine uses semantic chunking at these boundaries
                chunkOverlap: 100
            }
        }
    };

    const res = await authFetch(url, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) {
        const t = await res.text();
        logger.warn(`RAG upload failed for "${doc.displayName}" [${res.status}]: ${t.slice(0, 300)}`);
        return { success: false, error: t.slice(0, 300) };
    }
    const data = await res.json();
    const ragFileId = data.ragFile?.name || null;
    return { success: true, ragFileId };
}

/**
 * Upload a parsed Motor article to the RAG corpus.
 * Called from background_worker after successful AI parse.
 *
 * @param {{ vehicleId: string, articleId: string, targetSchema: string, title: string, htmlContent: string | null, parsedData: unknown, vehicleContext?: object }} ctx
 */
export async function ingestArticleToRagCorpus(ctx) {
    if (!isConfigured()) return;

    const { vehicleId, articleId, targetSchema, title, htmlContent, parsedData, vehicleContext } = ctx;

    // Build rich text document: vehicle header + prose content
    const vehicleHeader = vehicleContext
        ? `Vehicle: ${[vehicleContext.year, vehicleContext.make, vehicleContext.model, vehicleContext.engine].filter(Boolean).join(' ')}\n`
        : `Vehicle ID: ${vehicleId}\n`;

    let bodyText = '';

    if (typeof htmlContent === 'string' && htmlContent.trim().length > 80) {
        // Import htmlToMarkdownForLlm lazily to avoid circular deps
        const { htmlToMarkdownForLlm } = await import('./html_preprocess.js');
        bodyText = htmlToMarkdownForLlm(htmlContent, { maxChars: 500000 });
    }

    if (!bodyText && parsedData) {
        bodyText = JSON.stringify(parsedData, null, 2).slice(0, 100000);
    }

    if (!bodyText || bodyText.trim().length < 50) return;

    const fullText = `${vehicleHeader}Article: ${title || articleId}\nType: ${targetSchema}\n\n${bodyText}`;
    const displayName = `${vehicleId}/${articleId}/${targetSchema}`;

    const result = await uploadTextToCorpus({ text: fullText, displayName });
    if (result.success) {
        logger.info(`[RAG] Ingested article ${articleId} (${targetSchema}) into corpus. fileId=${result.ragFileId}`);
    }
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/**
 * Retrieve relevant chunks from the RAG corpus for a query.
 * Uses hybrid retrieval + Semantic Ranker reranking.
 *
 * @param {{ query: string, vehicleId?: string, topK?: number }} opts
 * @returns {Promise<{ success: boolean, chunks?: Array<{ text: string, score: number, sourceUri: string }>, error?: string }>}
 */
export async function retrieveFromCorpus({ query, vehicleId = null, topK = 10 }) {
    const corpusName = getCorpusName();
    if (!corpusName) return { success: false, error: 'VERTEX_RAG_CORPUS not configured' };

    // Optionally scope query to a specific vehicle
    const scopedQuery = vehicleId ? `Vehicle ID: ${vehicleId}\n\n${query}` : query;

    const url = `${ragApiBase()}/projects/${PROJECT_ID}/locations/${LOCATION}:retrieveContexts`;
    const body = {
        vertex_rag_store: {
            rag_resources: [{ rag_corpus: corpusName }],
            rag_retrieval_config: {
                top_k: topK,
                hybrid_search: { alpha: 0.5 },  // 0=keyword-only, 1=vector-only, 0.5=balanced
                ranking: {
                    rank_service: {
                        model_name: 'semantic-ranker-512@latest'
                    }
                }
            }
        },
        query: { text: scopedQuery }
    };

    const res = await authFetch(url, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) {
        const t = await res.text();
        logger.warn(`RAG retrieval failed [${res.status}]: ${t.slice(0, 300)}`);
        return { success: false, error: t.slice(0, 300) };
    }

    const data = await res.json();
    const contexts = data.contexts?.contexts || [];
    const chunks = contexts.map(c => ({
        text:      c.text || '',
        score:     c.score ?? 0,
        sourceUri: c.sourceUri || c.ragCorpus || ''
    }));

    return { success: true, chunks };
}

/**
 * Generate a grounded response using Gemini with the RAG corpus as context.
 * Gemini retrieves relevant chunks from the corpus automatically before generating.
 *
 * @param {{ prompt: string, vehicleId?: string, model?: string }} opts
 * @returns {Promise<{ success: boolean, text?: string, groundingChunks?: Array, error?: string }>}
 */
export async function generateWithRagGrounding({ prompt, vehicleId = null, model = null }) {
    const corpusName = getCorpusName();
    if (!corpusName) {
        // Fallback: generate without grounding
        return { success: false, error: 'VERTEX_RAG_CORPUS not configured — cannot ground generation' };
    }

    const { getGeminiClient } = await import('./nemotron_client.js');
    const ai = getGeminiClient();
    if (!ai) return { success: false, error: 'Vertex AI not configured' };

    const useModel = model || (process.env.VERTEX_TEXT_MODEL || 'gemini-2.5-flash-lite');
    const vehiclePrefix = vehicleId ? `[Context: vehicle ${vehicleId}]\n\n` : '';

    try {
        const response = await ai.models.generateContent({
            model: useModel,
            contents: [{ role: 'user', parts: [{ text: vehiclePrefix + prompt }] }],
            config: {
                tools: [{
                    retrieval: {
                        vertexRagStore: {
                            ragResources: [{ ragCorpus: corpusName }],
                            ragRetrievalConfig: {
                                topK: 10,
                                hybridSearch: { alpha: 0.5 },
                                ranking: { rankService: { modelName: 'semantic-ranker-512@latest' } }
                            }
                        }
                    }
                }],
                temperature: 0.3,
                maxOutputTokens: 8192
            }
        });

        const text = response.text ?? '';
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.retrievalQueries || [];
        return { success: true, text, groundingChunks };
    } catch (err) {
        logger.error('RAG grounded generation failed:', err);
        return { success: false, error: err.message };
    }
}

export { isConfigured as isRagConfigured, getCorpusName };
