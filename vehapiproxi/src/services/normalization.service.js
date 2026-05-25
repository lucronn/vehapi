/**
 * Normalization pipeline — Phase 5.
 * Lazy-load: RawFetch → AIExtract → Validate → Store
 *
 * Entry points:
 *   enqueueNormalization(vehicleId, articleId, rawHtml, articleMeta)
 *     Fire-and-forget. Skips silently if already normalized or LLM unavailable.
 *
 *   normalizeArticle(vehicleId, articleId, rawHtml, articleMeta)
 *     Await the full pipeline. Returns { stored, skipped, error? }.
 *
 * Model: OpenRouter google/gemini-2.5-flash (JSON mode, OpenAI-compat).
 * Falls back gracefully when OPENROUTER_API_KEY is not set.
 */
import { randomUUID } from 'crypto';
import logger from '../logger.js';
import { getOpenRouterClient, getOpenRouterModel } from '../nemotron_client.js';
import { htmlToMarkdownForLlm } from '../html_preprocess.js';
import { validateAtomicStep, validateLogicNode } from '../domain/content-schemas.js';
import { upsertAtomicSteps, getProcedureByArticleId } from '../repositories/procedures.repo.js';
import { upsertLogicNodes } from '../repositories/dtcs.repo.js';
import { dbQuery } from '../db.js';

// ─── In-flight dedup: don't run the same article twice concurrently ──────────
const _inFlight = new Set();

// ─── OpenRouter JSON extraction ───────────────────────────────────────────────

const SYSTEM_PROMPT =
    'You are a precise automotive service data extractor. ' +
    'Extract ALL information from the provided document. ' +
    'Do not hallucinate data not present in the document. ' +
    'Return only valid JSON matching the requested schema.';

const ATOMIC_STEP_EXTRACT_SCHEMA = {
    steps: [
        {
            step_id: 'uuid-string',
            operation_name: 'string — short name for the operation',
            sequence_order: 0,
            spec_data: {
                torque_nm: 'number or omit',
                torque_ft_lbs: 'number or omit',
                clearance_mm: 'number or omit',
                tool_ids: ['string tool names']
            },
            safety_data: {
                warnings: ['string'],
                ppe_required: ['string'],
                caution_level: 'low|medium|high|critical or omit'
            },
            media_assets: []
        }
    ]
};

const LOGIC_NODE_EXTRACT_SCHEMA = {
    tree_id: 'uuid-string (same for all nodes in one DTC tree)',
    dtc_code: 'string e.g. P0420',
    nodes: [
        {
            node_id: 'uuid-string',
            node_type: 'decision|measurement|terminal_action',
            input_criteria: { dtc_code: 'string', expected_range: { min: 0, max: 0, unit: 'string' } },
            edges: [{ condition: 'string', next_node_id: 'uuid-string' }]
        }
    ]
};

/**
 * Call OpenRouter with JSON mode and return the parsed object.
 * Throws on model error.
 */
async function callLlmJson(systemPrompt, userPrompt, maxTokens = 8192) {
    const client = getOpenRouterClient();
    if (!client) throw new Error('OPENROUTER_API_KEY not configured');

    const res = await client.chat.completions.create({
        model: getOpenRouterModel(),
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        max_tokens: maxTokens,
        temperature: 0.1,
    });

    const text = res.choices[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty LLM response');
    return JSON.parse(text);
}

// ─── Determine article category from bucket ───────────────────────────────────

function classifyArticleBucket(bucket = '') {
    const b = bucket.toLowerCase();
    if (b.includes('dtc') || b.includes('diagnostic trouble') || b.includes('fault code')) return 'dtc';
    if (b.includes('procedure') || b.includes('repair') || b.includes('removal') ||
        b.includes('installation') || b.includes('service')) return 'procedure';
    return 'other';
}

// ─── Pipeline stages ──────────────────────────────────────────────────────────

async function extractAtomicSteps(markdown, vehicleCtx, articleTitle) {
    const vehicleStr = vehicleCtx
        ? `${vehicleCtx.year ?? ''} ${vehicleCtx.make ?? ''} ${vehicleCtx.model ?? ''}`.trim()
        : 'unknown vehicle';

    const prompt =
        `Vehicle: ${vehicleStr}\nArticle: ${articleTitle || 'Service Procedure'}\n\n` +
        `Extract every procedural step from the document below as an array of atomic steps.\n` +
        `Each step must have a unique step_id (UUID v4), a short operation_name, and sequence_order.\n` +
        `Extract torque values, tool names, and safety warnings into spec_data and safety_data.\n` +
        `Return JSON with this structure:\n${JSON.stringify(ATOMIC_STEP_EXTRACT_SCHEMA, null, 2)}\n\n` +
        `--- DOCUMENT ---\n${markdown}`;

    const result = await callLlmJson(SYSTEM_PROMPT, prompt);
    const raw = Array.isArray(result) ? result : (result.steps ?? []);

    // Assign stable UUIDs where model omitted them and validate
    return raw
        .map((s, i) => ({ sequence_order: i, ...s, step_id: s.step_id || randomUUID() }))
        .filter(s => {
            const { valid, errors } = validateAtomicStep(s);
            if (!valid) logger.warn(`[normalization] AtomicStep validation: ${errors.join('; ')}`);
            return valid;
        });
}

async function extractLogicNodes(markdown, vehicleCtx, articleTitle) {
    const vehicleStr = vehicleCtx
        ? `${vehicleCtx.year ?? ''} ${vehicleCtx.make ?? ''} ${vehicleCtx.model ?? ''}`.trim()
        : 'unknown vehicle';

    const prompt =
        `Vehicle: ${vehicleStr}\nArticle: ${articleTitle || 'DTC Diagnostic'}\n\n` +
        `Extract the complete diagnostic decision tree from the document below.\n` +
        `Model every branch point as a node with edges pointing to the next node.\n` +
        `Use a single tree_id UUID for all nodes in this tree. Assign unique node_id UUIDs.\n` +
        `Return JSON with this structure:\n${JSON.stringify(LOGIC_NODE_EXTRACT_SCHEMA, null, 2)}\n\n` +
        `--- DOCUMENT ---\n${markdown}`;

    const result = await callLlmJson(SYSTEM_PROMPT, prompt);
    const treeId = result.tree_id || randomUUID();
    const dtcCode = result.dtc_code || null;
    const raw = Array.isArray(result.nodes) ? result.nodes : [];

    return raw
        .map(n => ({
            ...n,
            node_id: n.node_id || randomUUID(),
            tree_id: treeId,
            dtc_code: dtcCode,
        }))
        .filter(n => {
            const { valid, errors } = validateLogicNode(n);
            if (!valid) logger.warn(`[normalization] LogicNode validation: ${errors.join('; ')}`);
            return valid;
        });
}

// ─── Store ────────────────────────────────────────────────────────────────────

async function storeAtomicSteps(vehicleId, articleId, steps) {
    if (!steps.length) return 0;

    // Ensure the vehicle row exists (procedures has FK to vehicles.external_id)
    await dbQuery(
        `INSERT INTO vehicles (external_id, updated_at)
         VALUES ($1, now())
         ON CONFLICT (external_id) DO NOTHING`,
        [vehicleId]
    );

    // Ensure the parent procedure row exists (upsert by vehicle+external_id)
    const existing = await getProcedureByArticleId(vehicleId, articleId);
    let procedureId = existing?.id;
    if (!procedureId) {
        const { rows } = await dbQuery(
            `INSERT INTO procedures (id, vehicle_id, external_id, title, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, now(), now())
             ON CONFLICT (vehicle_id, external_id) DO UPDATE SET updated_at = now()
             RETURNING id`,
            [vehicleId, articleId, steps[0]?.operation_name || articleId]
        );
        procedureId = rows[0].id;
    }

    await upsertAtomicSteps(vehicleId, procedureId, steps);
    return steps.length;
}

async function storeLogicNodes(vehicleId, nodes) {
    if (!nodes.length) return 0;
    const withVehicle = nodes.map(n => ({ ...n, vehicle_id: vehicleId }));
    await upsertLogicNodes(withVehicle);
    return nodes.length;
}

// ─── Log outcome ──────────────────────────────────────────────────────────────

async function logNormalization(vehicleId, articleId, bucket, outcome) {
    try {
        await dbQuery(
            `INSERT INTO ai_processing_logs
               (vehicle_id, article_id, processing_type, status, metadata_json, created_at)
             VALUES ($1,$2,'normalization',$3,$4::jsonb,now())
             ON CONFLICT DO NOTHING`,
            [vehicleId, articleId, outcome.status, JSON.stringify({ bucket, ...outcome })]
        );
    } catch {
        /* non-fatal */
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the full normalization pipeline for one article.
 * @param {string} vehicleId
 * @param {string} articleId
 * @param {string} rawHtml
 * @param {{ year?, make?, model?, engine?, bucket?, title? }} articleMeta
 * @returns {Promise<{ stored: number, skipped: boolean, error?: string }>}
 */
export async function normalizeArticle(vehicleId, articleId, rawHtml, articleMeta = {}) {
    if (!getOpenRouterClient()) {
        return { stored: 0, skipped: true, error: 'OPENROUTER_API_KEY not configured' };
    }
    if (!rawHtml?.trim()) {
        return { stored: 0, skipped: true, error: 'empty rawHtml' };
    }

    const category = classifyArticleBucket(articleMeta.bucket);
    if (category === 'other') {
        return { stored: 0, skipped: true };
    }

    const markdown = htmlToMarkdownForLlm(rawHtml);
    if (!markdown.trim()) {
        return { stored: 0, skipped: true, error: 'markdown conversion produced empty string' };
    }

    logger.info(`[normalization] Extracting ${category} for ${vehicleId}/${articleId}`);

    try {
        let stored = 0;
        if (category === 'procedure') {
            const steps = await extractAtomicSteps(markdown, articleMeta, articleMeta.title);
            stored = await storeAtomicSteps(vehicleId, articleId, steps);
        } else if (category === 'dtc') {
            const nodes = await extractLogicNodes(markdown, articleMeta, articleMeta.title);
            stored = await storeLogicNodes(vehicleId, nodes);
        }
        logger.info(`[normalization] Stored ${stored} items for ${vehicleId}/${articleId}`);
        await logNormalization(vehicleId, articleId, articleMeta.bucket, { status: 'success', stored });
        return { stored, skipped: false };
    } catch (err) {
        logger.warn(`[normalization] Failed for ${vehicleId}/${articleId}: ${err.message}`);
        await logNormalization(vehicleId, articleId, articleMeta.bucket, { status: 'failed', error: err.message });
        return { stored: 0, skipped: false, error: err.message };
    }
}

/**
 * Fire-and-forget normalization. Safe to call from any request handler.
 * Deduplicates concurrent calls for the same article.
 */
export function enqueueNormalization(vehicleId, articleId, rawHtml, articleMeta = {}) {
    const key = `${vehicleId}:${articleId}`;
    if (_inFlight.has(key)) return;
    _inFlight.add(key);
    normalizeArticle(vehicleId, articleId, rawHtml, articleMeta)
        .catch(err => logger.warn(`[normalization] Unhandled error for ${key}:`, err.message))
        .finally(() => _inFlight.delete(key));
}
