/**
 * Tutorial chatbot endpoint — POST /api/ai/vehicle/:vehicleId/tutorial
 *
 * Generates custom, vehicle-specific step-by-step tutorials by combining:
 *   1. Semantic retrieval: Vertex AI RAG corpus (if configured) or pgvector fallback
 *   2. Exact DB lookups: DTCs, specs, procedures for the specific vehicle
 *   3. Grounded generation: Gemini 2.5 Flash streaming, anchored to retrieved context
 *
 * The result is far more accurate than generic LLM automotive knowledge because
 * exact values (torque specs, fluid capacities, part numbers, DTC diagnostic steps)
 * come directly from the vehicle's normalized Motor data.
 *
 * Auth: Firebase Bearer token required (same as other secure endpoints).
 * Streaming: Server-Sent Events (text/event-stream).
 */
import express from 'express';
import logger from '../logger.js';
import { dbQuery, isDbConfigured } from '../db.js';
import { runL2VehicleChunkSearch } from '../l2_retrieval.js';
import { retrieveFromCorpus, generateWithRagGrounding, isRagConfigured } from '../rag_engine.js';
import { getGeminiClient, getNemotronTextModel } from '../nemotron_client.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Vehicle + DB context helpers
// ---------------------------------------------------------------------------

/**
 * Resolve vehicle display name from DB metadata or vehicleId format.
 */
async function resolveVehicleName(vehicleId) {
    // Composite format: "2013:Ford:Explorer" or "2013:Ford:Explorer:3.5L V6"
    const parts = vehicleId.split(':');
    if (parts.length >= 3 && /^\d{4}$/.test(parts[0])) {
        return parts.slice(0, 4).join(' ');
    }

    // Numeric ID: look up from vehicle_metadata
    if (!isDbConfigured()) return vehicleId;
    try {
        const { rows } = await dbQuery(
            `SELECT path FROM vehicle_metadata
             WHERE path LIKE '/year/%/make/%/model/%/engines'
               AND data::text LIKE $1
             LIMIT 1`,
            [`%"vehicleId":${vehicleId}%`]
        );
        if (rows.length > 0) {
            const m = rows[0].path.match(/^\/year\/(\d+)\/make\/([^/]+)\/model\/([^/]+)/);
            if (m) return `${m[1]} ${m[2]} ${m[3]}`;
        }
    } catch {
        /* fall through */
    }
    return vehicleId;
}

/**
 * Pull exact structured data for the vehicle to ground the tutorial.
 * Returns a compact text block that gets injected into the Gemini prompt.
 */
async function buildVehicleDbContext(vehicleId, query) {
    if (!isDbConfigured()) return null;

    const sections = [];

    // Extract DTC code from query if present
    const dtcMatch = query.match(/\b([PCBU][0-9A-Fa-f]{4})\b/);
    const dtcCode = dtcMatch?.[1]?.toUpperCase();

    // Direct DTC lookup (exact match — highest value context)
    if (dtcCode) {
        try {
            const { rows } = await dbQuery(
                `SELECT code, description, possible_causes, symptoms, monitor_strategy, diagnostic_steps
                 FROM dtcs WHERE vehicle_id = $1 AND code = $2 LIMIT 1`,
                [vehicleId, dtcCode]
            );
            if (rows.length > 0) {
                const d = rows[0];
                const parts = [`DTC ${d.code}: ${d.description}`];
                if (d.possible_causes?.length) parts.push(`Possible causes: ${d.possible_causes.join('; ')}`);
                if (d.symptoms?.length) parts.push(`Symptoms: ${d.symptoms.join('; ')}`);
                if (d.monitor_strategy) parts.push(`Monitor: ${d.monitor_strategy}`);
                if (d.diagnostic_steps?.length) {
                    const steps = d.diagnostic_steps.map(s =>
                        `${s.order + 1}. ${s.test}${s.result_match ? ' → expected: ' + s.result_match : ''}${s.action_if_match ? ' → if match: ' + s.action_if_match : ''}`
                    );
                    parts.push('Diagnostic steps:\n' + steps.join('\n'));
                }
                sections.push('[DTC DIAGNOSTIC DATA]\n' + parts.join('\n'));
            }
        } catch { /* non-fatal */ }
    }

    // Relevant specifications (torque, fluid, capacity)
    try {
        const specKeywords = extractSpecKeywords(query);
        if (specKeywords.length > 0) {
            const { rows } = await dbQuery(
                `SELECT category, name, value, unit, display_text
                 FROM spec_fact WHERE vehicle_id = $1
                   AND (${specKeywords.map((_, i) => `lower(name || ' ' || category) LIKE $${i + 2}`).join(' OR ')})
                 ORDER BY spec_type, category, name
                 LIMIT 20`,
                [vehicleId, ...specKeywords.map(k => `%${k.toLowerCase()}%`)]
            );
            if (rows.length > 0) {
                const specLines = rows.map(s =>
                    `${s.category} — ${s.name}: ${s.value}${s.unit ? ' ' + s.unit : ''}${s.display_text ? ' (' + s.display_text + ')' : ''}`
                );
                sections.push('[VEHICLE SPECIFICATIONS]\n' + specLines.join('\n'));
            }
        }
    } catch { /* non-fatal */ }

    // Relevant procedures (title + first few steps)
    try {
        const { rows } = await dbQuery(
            `SELECT title, description, steps, tools_required, parts_required, cautions
             FROM procedures WHERE vehicle_id = $1
             LIMIT 5`,
            [vehicleId]
        );
        if (rows.length > 0) {
            const procText = rows.map(p => {
                const parts = [`Procedure: ${p.title || 'Service procedure'}`];
                if (p.description) parts.push(p.description);
                if (Array.isArray(p.steps) && p.steps.length) {
                    // Include up to 8 steps
                    const steps = p.steps.slice(0, 8).map((s, i) => `  ${i + 1}. ${s.text}`);
                    parts.push('Steps:\n' + steps.join('\n'));
                    if (p.steps.length > 8) parts.push(`  ... (${p.steps.length - 8} more steps)`);
                }
                if (Array.isArray(p.tools_required) && p.tools_required.length) {
                    parts.push(`Tools: ${p.tools_required.join(', ')}`);
                }
                if (p.cautions) parts.push(`⚠ ${p.cautions}`);
                return parts.join('\n');
            }).join('\n\n');
            sections.push('[SERVICE PROCEDURES]\n' + procText);
        }
    } catch { /* non-fatal */ }

    // Recent TSBs
    try {
        const { rows } = await dbQuery(
            `SELECT bulletin_number, title, summary, affected_components
             FROM tsbs WHERE vehicle_id = $1
             ORDER BY issue_date DESC NULLS LAST
             LIMIT 5`,
            [vehicleId]
        );
        if (rows.length > 0) {
            const tsbText = rows.map(t =>
                `TSB ${t.bulletin_number}: ${t.title}${t.summary ? '\n' + t.summary : ''}${t.affected_components?.length ? '\nAffects: ' + t.affected_components.join(', ') : ''}`
            ).join('\n\n');
            sections.push('[TECHNICAL SERVICE BULLETINS]\n' + tsbText);
        }
    } catch { /* non-fatal */ }

    return sections.length > 0 ? sections.join('\n\n') : null;
}

function extractSpecKeywords(query) {
    const keywords = [];
    const q = query.toLowerCase();
    if (/oil|engine oil|motor oil/.test(q)) keywords.push('oil');
    if (/torque|tighten|bolt/.test(q)) keywords.push('torque');
    if (/coolant|antifreeze/.test(q)) keywords.push('coolant');
    if (/transmission|trans fluid/.test(q)) keywords.push('transmission');
    if (/brake/.test(q)) keywords.push('brake');
    if (/tire|inflation|psi/.test(q)) keywords.push('tire');
    if (/spark plug/.test(q)) keywords.push('spark plug');
    if (/capacity|volume|quart/.test(q)) keywords.push('capacity');
    if (/fluid/.test(q)) keywords.push('fluid');
    return keywords;
}

/**
 * Retrieve semantically relevant chunks for the query.
 * Prefers Vertex AI RAG Engine (managed hybrid retrieval); falls back to pgvector.
 */
async function retrieveRelevantChunks(vehicleId, query, topK = 8) {
    // Primary: Vertex AI RAG Engine (hybrid BM25 + vector + reranking)
    if (isRagConfigured()) {
        const result = await retrieveFromCorpus({
            query,
            vehicleId,
            topK
        }).catch(err => {
            logger.warn(`RAG retrieval failed: ${err.message}`);
            return null;
        });
        if (result?.success && result.chunks?.length > 0) {
            return result.chunks.map(c => c.text).join('\n\n---\n\n');
        }
    }

    // Fallback: pgvector L2 search
    const l2Result = await runL2VehicleChunkSearch({
        vehicleExternalId: vehicleId,
        query,
        matchCount: topK
    }).catch(() => null);

    if (l2Result?.success && l2Result.chunks?.length > 0) {
        return l2Result.chunks.map(c => c.text).join('\n\n---\n\n');
    }

    return null;
}

// ---------------------------------------------------------------------------
// Tutorial generation
// ---------------------------------------------------------------------------

/**
 * Generate a streaming tutorial grounded in vehicle-specific data.
 */
async function streamTutorial(res, vehicleId, vehicleName, query, matchCount = 8) {
    // Gather context in parallel
    const [semanticChunks, dbContext] = await Promise.all([
        retrieveRelevantChunks(vehicleId, query, matchCount).catch(() => null),
        buildVehicleDbContext(vehicleId, query).catch(() => null)
    ]);

    const contextSections = [];
    if (semanticChunks) contextSections.push('[RETRIEVED ARTICLES]\n' + semanticChunks);
    if (dbContext)       contextSections.push(dbContext);

    const hasContext = contextSections.length > 0;
    const contextBlock = hasContext
        ? `\n\nVehicle-specific data from the Motor service database:\n\n${contextSections.join('\n\n')}\n\n`
        : '\n\n(No vehicle-specific service data available — use general automotive knowledge.)\n\n';

    const systemPrompt =
        `You are an expert automotive service advisor generating a detailed, vehicle-specific tutorial. ` +
        `Ground every answer in the vehicle data provided. ` +
        `Use exact values from the specifications (torque specs, fluid capacities, part numbers). ` +
        `Reference specific DTCs, TSBs, or procedures by name/code where relevant. ` +
        `Format your response as a clear step-by-step tutorial with:\n` +
        `- A brief introduction explaining what and why\n` +
        `- Numbered steps with specific, actionable instructions\n` +
        `- Tools and parts needed\n` +
        `- Safety warnings where applicable\n` +
        `- Expected outcomes and verification steps\n\n` +
        `Vehicle: ${vehicleName}`;

    const userPrompt =
        `Generate a detailed tutorial for: "${query}"${contextBlock}` +
        `Use the vehicle data above to provide vehicle-specific values. ` +
        `If the data doesn't cover something, note it clearly rather than guessing.`;

    // Use RAG-grounded generation if corpus is configured, otherwise stream directly
    if (isRagConfigured() && !hasContext) {
        // Let Gemini pull from corpus automatically
        const result = await generateWithRagGrounding({
            prompt: `${systemPrompt}\n\n${userPrompt}`,
            vehicleId,
            model: process.env.VERTEX_TEXT_MODEL || 'gemini-2.5-flash-lite'
        });
        if (result.success) {
            res.write(`data: ${JSON.stringify({ text: result.text, done: false })}\n\n`);
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            return;
        }
    }

    // Streaming generation via native Gemini SDK
    const ai = getGeminiClient();
    if (!ai) {
        res.write(`data: ${JSON.stringify({ error: 'AI not configured' })}\n\n`);
        res.end();
        return;
    }

    const model = process.env.VERTEX_TEXT_MODEL || 'gemini-2.5-flash-lite';
    const stream = await ai.models.generateContentStream({
        model,
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        config: {
            systemInstruction: systemPrompt,
            temperature: 0.3,
            maxOutputTokens: 8192
        }
    });

    for await (const chunk of stream) {
        const text = chunk.text ?? '';
        if (text) {
            res.write(`data: ${JSON.stringify({ text, done: false })}\n\n`);
        }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

router.post('/vehicle/:vehicleId/tutorial', async (req, res) => {
    const { vehicleId } = req.params;
    const { query, matchCount = 8 } = req.body || {};

    if (!vehicleId) {
        return res.status(400).json({ error: 'vehicleId required' });
    }
    if (!query || typeof query !== 'string' || query.trim().length < 3) {
        return res.status(400).json({ error: 'query required (minimum 3 characters)' });
    }

    const ai = getGeminiClient();
    if (!ai) {
        return res.status(503).json({ error: 'AI not configured — set GOOGLE_CLOUD_PROJECT' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
        const vehicleName = await resolveVehicleName(vehicleId);
        await streamTutorial(res, vehicleId, vehicleName, query.trim(), Number(matchCount) || 8);
    } catch (err) {
        logger.error(`Tutorial generation failed for vehicle ${vehicleId}:`, err);
        try {
            res.write(`data: ${JSON.stringify({ error: err.message || 'Tutorial generation failed' })}\n\n`);
        } catch {
            /* connection may have closed */
        }
    } finally {
        res.end();
    }
});

export default router;
export { router as registerTutorialEndpoints };
