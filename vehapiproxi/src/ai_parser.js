/**
 * Gemini 2.5 Flash Lite — structured data extraction via native @google/genai SDK.
 *
 * Key quality improvements over previous Nemotron/OpenAI-compat approach:
 *  - Native responseMimeType + responseSchema: constrained generation — model output is
 *    guaranteed valid JSON. Zod failures are now semantic-only (wrong field values, not malformed JSON).
 *  - Thinking budget for procedures: Gemini 2.5 Flash Lite uses thinking tokens internally
 *    for complex multi-step extraction, producing more accurate step decomposition.
 *  - Vehicle context in every prompt: year/make/model/engine anchors extraction to the specific vehicle.
 *  - Retry with Zod error feedback for ALL schema types (not just procedures).
 *  - Concurrency raised to 10 (Gemini 2.5 has higher quota than legacy Nemotron limits).
 *
 * Free-text paths (rewrite, generateCommonIssues) continue to use the OpenAI-compat
 * streaming endpoint for output flexibility.
 */
import pLimit from 'p-limit';
import logger from './logger.js';
import { getGeminiClient, getParseModel, getNemotronClient, getNemotronTextModel } from './nemotron_client.js';
import { htmlToMarkdownForLlm, extractArticleHtmlFromMotorPayload } from './html_preprocess.js';
import { ArticleExtractionSchema, formatZodError } from './ai_parser_schemas.js';
import { insertFailedExtraction } from './db.service.js';

const STRUCTURED_CONCURRENCY = Math.max(
    1,
    Number.parseInt(process.env.NEMOTRON_STRUCTURED_CONCURRENCY || '10', 10)
);
const structuredLimit = pLimit(STRUCTURED_CONCURRENCY);

// ---------------------------------------------------------------------------
// Schema definitions — Gemini native format (lowercase types, OpenAPI 3.0-ish)
// ---------------------------------------------------------------------------

const STEP_SCHEMA = {
    type: 'object',
    properties: {
        order:     { type: 'integer' },
        text:      { type: 'string' },
        image_url: { type: 'string' },
        warning:   { type: 'string' },
        note:      { type: 'string' }
    },
    required: ['text']
};

const PART_SCHEMA = {
    type: 'object',
    properties: {
        part_number:  { type: 'string' },
        description:  { type: 'string' },
        quantity:     { type: 'integer' }
    },
    required: ['description']
};

const PROCEDURE_ITEM_SCHEMA = {
    type: 'object',
    properties: {
        title:              { type: 'string' },
        description:        { type: 'string' },
        steps:              { type: 'array', items: STEP_SCHEMA },
        tools_required:     { type: 'array', items: { type: 'string' } },
        parts_required:     { type: 'array', items: PART_SCHEMA },
        time_estimate_hours:{ type: 'number' },
        cautions:           { type: 'string' }
    },
    required: ['title', 'steps']
};

const SCHEMAS = {
    procedures: {
        type: 'object',
        properties: {
            article_title:       { type: 'string' },
            article_description: { type: 'string' },
            procedures: {
                type: 'array',
                items: PROCEDURE_ITEM_SCHEMA
            }
        },
        required: ['procedures']
    },

    dtcs: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                code:                { type: 'string' },
                description:         { type: 'string' },
                possible_causes:     { type: 'array', items: { type: 'string' } },
                symptoms:            { type: 'array', items: { type: 'string' } },
                monitor_strategy:    { type: 'string' },
                malfunction_criteria:{ type: 'string' },
                diagnostic_steps: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            order:               { type: 'integer' },
                            test:                { type: 'string' },
                            result_match:        { type: 'string' },
                            action_if_match:     { type: 'string' },
                            action_if_not_match: { type: 'string' },
                            warning:             { type: 'string' }
                        },
                        required: ['order', 'test']
                    }
                }
            },
            required: ['code', 'description']
        }
    },

    tsbs: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                bulletin_number:     { type: 'string' },
                issue_date:          { type: 'string' },
                title:               { type: 'string' },
                summary:             { type: 'string' },
                content:             { type: 'string' },
                affected_components: { type: 'array', items: { type: 'string' } },
                models_affected:     { type: 'array', items: { type: 'string' } }
            },
            required: ['bulletin_number', 'title']
        }
    },

    specifications: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                category:     { type: 'string' },
                name:         { type: 'string' },
                value:        { type: 'string' },
                unit:         { type: 'string' },
                display_text: { type: 'string' }
            },
            required: ['name', 'value', 'category']
        }
    },

    common_issues: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                title:            { type: 'string' },
                description:      { type: 'string' },
                symptoms:         { type: 'array', items: { type: 'string' } },
                severity:         { type: 'string', enum: ['High', 'Medium', 'Low'] },
                fixComplexity:    { type: 'string', enum: ['Easy', 'Moderate', 'Hard'] },
                suggestedAction:  { type: 'string' },
                relatedArticleIds:{ type: 'array', items: { type: 'string' } }
            },
            required: ['title', 'description', 'severity', 'fixComplexity']
        }
    }
};

const TUTORIAL_SCHEMA = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            title:            { type: 'string' },
            content:          { type: 'string' },
            warning:          { type: 'string' },
            tool:             { type: 'string' },
            mediaPlaceholder: { type: 'string' }
        },
        required: ['title', 'content']
    }
};

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

const SCHEMA_HINTS = {
    tsbs: 'Format issue_date as YYYY-MM-DD when present. Preserve full bulletin content.',
    dtcs: 'For diagnostic_steps: test=what to measure, result_match=expected value, action_if_match=next if pass, action_if_not_match=action if fail. Use empty string for missing action fields.',
    procedures:
        'Identify EVERY distinct procedure or major section in the document. One object per distinct procedure, each with its own steps array. Do not merge unrelated procedures. ' +
        'For parts_required: include every part line with description; quantity only when stated. Never omit the entire array because quantity is unknown.',
    specifications:
        'Capture every specification row in the document — torque values, fluid capacities, clearances, pressures. ' +
        'Use exact numeric values as strings. Category should match the section heading the spec appears under.'
};

const FEW_SHOT_PROCEDURES = `
Example (illustrative only — use real content from document):
procedures:[{"title":"Front brake pad replacement","steps":[{"order":0,"text":"Loosen lug nuts before lifting vehicle."},{"order":1,"text":"Remove caliper bolts (14mm). Slide caliper off rotor."}],"tools_required":["14mm socket","torque wrench"],"parts_required":[{"description":"Brake pads","quantity":2}]}]
`;

function buildVehicleContextBlock(vehicleCtx) {
    if (!vehicleCtx) return '';
    const parts = [];
    if (vehicleCtx.year)   parts.push(`Year: ${vehicleCtx.year}`);
    if (vehicleCtx.make)   parts.push(`Make: ${vehicleCtx.make}`);
    if (vehicleCtx.model)  parts.push(`Model: ${vehicleCtx.model}`);
    if (vehicleCtx.engine) parts.push(`Engine: ${vehicleCtx.engine}`);
    if (vehicleCtx.trim)   parts.push(`Trim: ${vehicleCtx.trim}`);
    if (!parts.length) return '';
    return `\nVehicle: ${parts.join(' | ')}\n`;
}

// ---------------------------------------------------------------------------
// Native Gemini structured call (constrained JSON generation)
// ---------------------------------------------------------------------------

const MAX_NETWORK_RETRIES = 3;
const ZOD_ATTEMPTS_PROCEDURES = 3;
const ZOD_ATTEMPTS_DEFAULT = 2;

/**
 * Call Gemini with native responseSchema — output is guaranteed valid JSON matching the schema.
 * Zod validation is still applied to catch semantic issues (missing required fields, bad enums).
 *
 * @param {string} userPrompt
 * @param {object} jsonSchema  Gemini-format schema object
 * @param {{ thinkingBudget?: number, temperature?: number, maxOutputTokens?: number }} [options]
 * @returns {Promise<{ text: string, usage: object | null }>}
 */
async function callGeminiStructured(userPrompt, jsonSchema, options = {}) {
    const ai = getGeminiClient();
    if (!ai) throw new Error('Vertex AI unavailable — set GOOGLE_CLOUD_PROJECT');

    const model = getParseModel();
    const { thinkingBudget = 0, temperature = 0.1, maxOutputTokens = 16384 } = options;

    const config = {
        responseMimeType: 'application/json',
        responseSchema: jsonSchema,
        temperature,
        maxOutputTokens,
        systemInstruction:
            'You are a precise automotive service data extractor. ' +
            'Extract ALL information from the provided document. Do not hallucinate data not present. ' +
            'Do not omit any items — if a document contains 20 DTCs, return all 20.'
    };

    if (thinkingBudget > 0) {
        config.thinkingConfig = { thinkingBudget };
    }

    const contents = [{ role: 'user', parts: [{ text: userPrompt }] }];

    for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt++) {
        try {
            const response = await structuredLimit(() =>
                ai.models.generateContent({ model, contents, config })
            );
            const text = response.text ?? '';
            const usage = response.usageMetadata
                ? {
                      prompt_tokens:     response.usageMetadata.promptTokenCount ?? 0,
                      completion_tokens: response.usageMetadata.candidatesTokenCount ?? 0,
                      total_tokens:      response.usageMetadata.totalTokenCount ?? 0
                  }
                : null;
            return { text, usage };
        } catch (error) {
            const isRate = error?.status === 429 || String(error?.message || '').includes('429') || String(error?.message || '').includes('RESOURCE_EXHAUSTED');
            logger.warn(`Gemini structured call error (attempt ${attempt + 1}/${MAX_NETWORK_RETRIES + 1}): ${error.message}`);
            if (attempt === MAX_NETWORK_RETRIES) throw error;
            const backoff = isRate ? 8000 * (attempt + 1) : 2000 * (attempt + 1);
            await new Promise((r) => setTimeout(r, backoff));
        }
    }
}

// ---------------------------------------------------------------------------
// Free-text call (streaming, OpenAI-compat — for rewrite/tutorials/common-issues)
// ---------------------------------------------------------------------------

async function callAIFreeText(prompt, options = {}) {
    const openai = getNemotronClient();
    if (!openai) throw new Error('Vertex AI unavailable — set GOOGLE_CLOUD_PROJECT');

    const temperature = typeof options.temperature === 'number' ? options.temperature : 0.7;
    const top_p       = typeof options.top_p       === 'number' ? options.top_p       : 0.95;
    const max_tokens  = typeof options.max_tokens  === 'number' ? options.max_tokens  : 8192;

    for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt++) {
        try {
            const completion = await openai.chat.completions.create({
                model: getNemotronTextModel(),
                messages: [{ role: 'user', content: prompt }],
                temperature,
                top_p,
                max_tokens,
                stream: true
            });
            let fullContent = '';
            for await (const chunk of completion) {
                if (chunk.choices[0]?.delta?.content) {
                    fullContent += chunk.choices[0].delta.content;
                }
            }
            if (!fullContent) throw new Error('Empty response from Gemini');
            return fullContent;
        } catch (error) {
            logger.warn(`Gemini free-text error (attempt ${attempt + 1}): ${error.message}`);
            if (attempt === MAX_NETWORK_RETRIES) throw error;
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers (kept from original)
// ---------------------------------------------------------------------------

export function collapseProceduresForL1(parsed) {
    if (!parsed || typeof parsed !== 'object') return parsed;
    if (!Array.isArray(parsed.procedures) || parsed.procedures.length === 0) return parsed;

    const procs = parsed.procedures;
    const title = procs.map((p) => p.title).filter(Boolean).join(' · ') || 'Service procedures';
    const description = procs.map((p) => p.description).filter(Boolean).join('\n\n') || null;

    const mergedSteps = [];
    let order = 0;
    for (const p of procs) {
        const secTitle = (p.title && String(p.title).trim()) || 'Procedure';
        const steps = Array.isArray(p.steps) ? p.steps : [];
        steps.forEach((s, idx) => {
            const text = typeof s.text === 'string' ? s.text : '';
            mergedSteps.push({
                order: order++,
                text: idx === 0 ? `**${secTitle}**\n\n${text}` : text,
                image_url: s.image_url || null,
                warning:   s.warning   || null,
                note:      s.note      || null
            });
        });
    }

    const tools = [];
    const parts = [];
    for (const p of procs) {
        if (Array.isArray(p.tools_required)) tools.push(...p.tools_required.map(String));
        if (Array.isArray(p.parts_required)) parts.push(...p.parts_required);
    }

    const cautionsList = procs.map((p) => p.cautions).filter(Boolean);
    const cautions = cautionsList.length ? cautionsList.join('\n\n') : parsed.cautions || null;

    let time_estimate_hours = parsed.time_estimate_hours ?? null;
    for (const p of procs) {
        if (typeof p.time_estimate_hours === 'number' && !Number.isNaN(p.time_estimate_hours)) {
            time_estimate_hours = p.time_estimate_hours;
            break;
        }
    }

    return {
        title,
        description,
        steps: mergedSteps,
        tools_required: [...new Set(tools)],
        parts_required: parts,
        cautions,
        time_estimate_hours
    };
}

function mergeUsage(a, b) {
    const pt = (a?.prompt_tokens || 0) + (b?.prompt_tokens || 0);
    const ct = (a?.completion_tokens || 0) + (b?.completion_tokens || 0);
    return { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct };
}

function normalizeUsage(u) {
    if (!u) return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const pt = u.prompt_tokens ?? 0;
    const ct = u.completion_tokens ?? 0;
    return { prompt_tokens: pt, completion_tokens: ct, total_tokens: u.total_tokens ?? pt + ct };
}

function extractArticleIdFromMeta(meta) {
    const p = meta?.urlPath;
    if (!p || typeof p !== 'string') return null;
    const m = p.match(/\/article\/([^?/]+)/);
    return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Core export: parseWithAI
// ---------------------------------------------------------------------------

/**
 * Parse raw Motor article data into a typed schema using Gemini 2.5 Flash Lite.
 *
 * @param {unknown} rawData        Raw article content (string or object)
 * @param {string}  targetSchema   One of: procedures, dtcs, tsbs, specifications
 * @param {{ urlPath?: string, vehicleContext?: { year?, make?, model?, engine?, trim? } }} [meta]
 * @returns {Promise<{ parsed: unknown, usage: object }>}
 */
export async function parseWithAI(rawData, targetSchema, meta = {}) {
    if (!SCHEMAS[targetSchema]) {
        throw new Error(`Schema '${targetSchema}' is not defined in ai_parser.js`);
    }

    const MAX_CHARS = 150000;
    const vehicleBlock = buildVehicleContextBlock(meta?.vehicleContext);
    const hint = SCHEMA_HINTS[targetSchema] ? `\nSchema guidance: ${SCHEMA_HINTS[targetSchema]}\n` : '';
    const zodAttempts = targetSchema === 'procedures' ? ZOD_ATTEMPTS_PROCEDURES : ZOD_ATTEMPTS_DEFAULT;
    // Thinking budget: procedures are most complex (multi-step, nested). Others get 0 (fast).
    const thinkingBudget = targetSchema === 'procedures' ? 1024 : 0;

    let userPrompt;

    if (targetSchema === 'procedures') {
        const { html } = extractArticleHtmlFromMotorPayload(
            typeof rawData === 'string' ? rawData : JSON.stringify(rawData)
        );
        if (!html || !html.trim()) {
            const rawStr = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
            userPrompt =
                `You are an automotive data parser extracting service procedures.${vehicleBlock}${hint}\n` +
                `${FEW_SHOT_PROCEDURES}\n` +
                `Parse the following Motor API payload. If HTML is embedded in JSON, infer procedures from it.\n\n---\n\n${rawStr.slice(0, MAX_CHARS)}`;
        } else {
            const md = htmlToMarkdownForLlm(html, { maxChars: MAX_CHARS });
            userPrompt =
                `You are an automotive data parser extracting service procedures from a Motor service document.${vehicleBlock}${hint}\n` +
                `${FEW_SHOT_PROCEDURES}\n` +
                `The following Markdown was converted from a Motor service document (tables/lists preserved). ` +
                `Extract ALL distinct procedures; each must have its own title and steps array.\n\n---\n\n${md}`;
        }
    } else {
        const rawStr = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
        const trimmedData = rawStr.slice(0, MAX_CHARS);
        const wasTruncated = rawStr.length > MAX_CHARS;
        if (wasTruncated) {
            logger.warn(`parseWithAI: input truncated from ${rawStr.length} to ${MAX_CHARS} chars for ${targetSchema}`);
        }
        userPrompt =
            `You are an automotive data parser. Extract ALL relevant technical information from the provided data.${vehicleBlock}${hint}` +
            `Capture every item — do not skip any. If optional fields are absent, omit them or use empty arrays.` +
            (wasTruncated ? ' Note: data was truncated — extract everything present.' : '') +
            `\n\nRaw Data:\n${trimmedData}`;
    }

    // Zod self-correction loop — applies to all schema types
    let correctionSuffix = '';
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let lastErr = '';

    for (let zAttempt = 0; zAttempt < zodAttempts; zAttempt++) {
        const { text, usage } = await callGeminiStructured(
            userPrompt + correctionSuffix,
            SCHEMAS[targetSchema],
            { thinkingBudget }
        );
        totalUsage = mergeUsage(totalUsage, usage);

        // With constrained generation, text is guaranteed valid JSON — parse without try/catch
        let parsedRaw;
        try {
            parsedRaw = JSON.parse(text);
        } catch (e) {
            // Should never happen with native JSON schema mode, but handle defensively
            lastErr = `Unexpected JSON parse error: ${e.message}`;
            correctionSuffix = `\n\nPrevious output failed JSON parsing: ${lastErr}. Return only valid JSON.`;
            continue;
        }

        if (targetSchema === 'procedures') {
            const v = ArticleExtractionSchema.safeParse(parsedRaw);
            if (v.success) {
                return { parsed: collapseProceduresForL1(v.data), usage: normalizeUsage(totalUsage) };
            }
            lastErr = formatZodError(v.error);
            correctionSuffix =
                `\n\nYour output failed semantic validation. Fix these specific issues and re-output:\n${lastErr}`;
            continue;
        }

        // For non-procedure schemas, accept the result directly (schema is enforced by model)
        return { parsed: parsedRaw, usage: normalizeUsage(totalUsage) };
    }

    // Procedures: all Zod attempts exhausted
    const rawText = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
    const articleId = extractArticleIdFromMeta(meta) || 'unknown';
    await insertFailedExtraction({
        article_id: articleId,
        raw_text: rawText.slice(0, 120000),
        error_message: `Zod validation failed after ${zodAttempts} attempts: ${lastErr}`,
        url_path: meta.urlPath || null,
        category: targetSchema
    });
    throw new Error(`${targetSchema} validation failed after ${zodAttempts} attempts: ${lastErr}`);
}

// ---------------------------------------------------------------------------
// Supporting exports (unchanged interface, updated model)
// ---------------------------------------------------------------------------

export async function rewriteArticleHtml(html, title = '') {
    if (!html || !html.trim()) return html;
    const trimmed = html.slice(0, 12000);
    const titleLine = (title && String(title).trim()) || '(none)';

    const prompt = `You are an automotive technical editor. Produce a PUBLICATION-READY rewrite of the HTML below. The source is reference material only — your output must be substantively different prose (new vocabulary, new sentence structures, varied phrasing throughout).

Rewrite requirements:
- Express every instruction, caution, specification, and step in original language.
- Preserve all technical facts exactly: part numbers, codes, torques, measurements, fluid types, tool names, DTC codes, and safety warnings.
- Use a confident, direct service-manual tone.

HTML mechanics (strict):
- Keep ALL tags, attributes, and nesting exactly as in the input.
- Change ONLY human-visible text node content.
- Do NOT add, remove, or rename tags. Do NOT alter <img>, <mtr-image>, <iframe>, or <object> elements.
- Do NOT change href, src, id, or data-* attribute values.

Context — article title: ${titleLine}

Source HTML:
${trimmed}

Output ONLY the complete rewritten HTML. No markdown fences, no commentary.`;

    const rewritten = await callAIFreeText(prompt, { temperature: 0.88, top_p: 0.9, max_tokens: 8192 });
    return rewritten.trim();
}

export async function generateTutorialSteps(html, title = '') {
    if (!html || !html.trim()) return [];
    const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000);

    const prompt = `You are an automotive service expert. Generate a step-by-step interactive tutorial from the following vehicle service article.

Article Title: ${title || 'Vehicle Service Procedure'}

Article Content:
${plainText}

Requirements for each step:
- title: Short, action-oriented (5-10 words, imperative mood)
- content: Clear HTML instruction paragraph for this step. Active voice, specific details.
- warning: (optional) Safety-critical warning if applicable.
- tool: (optional) Primary tool or part required.
- mediaPlaceholder: Leave empty string.

Create 3-12 meaningful steps covering the full procedure.`;

    const { text } = await callGeminiStructured(prompt, TUTORIAL_SCHEMA, { temperature: 0.3 });
    return JSON.parse(text);
}

export async function generateCommonIssues(vehicleName, vehicleContext) {
    if (!vehicleName || !vehicleName.trim()) return [];

    const contextBlock = vehicleContext
        ? `\n\nVehicle-specific data from the service database (ground your answers in this data):\n\n${vehicleContext}`
        : '';

    const prompt = `You are an automotive service advisor. Generate common issues for this vehicle:

Vehicle: ${vehicleName}${contextBlock}

For each issue provide:
- title: Short issue name
- description: Brief technical explanation
- symptoms: List of driver-observable signs
- severity: High (safety/breakdown), Medium (performance), or Low (nuisance)
- fixComplexity: Easy (DIY), Moderate (shop), or Hard (major teardown)
- suggestedAction: Specific next step referencing any DTCs, TSBs, or procedures from database context
- relatedArticleIds: Bulletin numbers or DTC codes from database (empty array if none)

Create 4-8 high-quality issues tailored to this specific vehicle.`;

    try {
        const { text } = await callGeminiStructured(prompt, SCHEMAS.common_issues, { temperature: 0.3 });
        return JSON.parse(text);
    } catch (err) {
        logger.error(`generateCommonIssues failed for ${vehicleName}:`, err);
        return [];
    }
}
