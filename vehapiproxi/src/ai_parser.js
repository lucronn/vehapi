/**
 * Nemotron (NVIDIA) — text parsing, rewrite, tutorials, common-issues.
 * Multimodal (PDF page → PNG, image OCR): import `./nemotron_multimodal.js` directly (or dynamic `import()`).
 * Do not re-export that module here — it pulls native `canvas` and would load when anything imports `parseWithAI`.
 * @see docs/plans/2026-03-18-normalization-schema-design.md Appendix A
 */
import pLimit from 'p-limit';
import logger from './logger.js';
import { getNemotronClient, getNemotronTextModel } from './nemotron_client.js';
import { htmlToMarkdownForLlm, extractArticleHtmlFromMotorPayload } from './html_preprocess.js';
import { ArticleExtractionSchema, formatZodError } from './ai_parser_schemas.js';
import { insertFailedExtraction } from './supabase.js';

const STRUCTURED_CONCURRENCY = Math.max(
    1,
    Number.parseInt(process.env.NEMOTRON_STRUCTURED_CONCURRENCY || '3', 10)
);
const structuredLimit = pLimit(STRUCTURED_CONCURRENCY);

const SYSTEM_JSON_ONLY =
    'You are a strict JSON generator for automotive service data. Output ONLY valid JSON. ' +
    'Do not include preambles, explanations, markdown code fences, apologies, or chain-of-thought reasoning. ' +
    'Begin your response with { or [ and end with } or ].';

/** No reasoning tokens, no meta-commentary — JSON only. */
const ZERO_MONOLOGUE =
    '\nZero-Monologue: Do not narrate your thinking or reveal internal reasoning. Do not explain. ' +
    'Return JSON only — no text before or after the JSON object.';

const SYSTEM_JSON_STRICT = SYSTEM_JSON_ONLY + ZERO_MONOLOGUE;

const FEW_SHOT_PROCEDURES = `
Example valid output (illustrative only; use real content from the document):
{"article_title":"Front brake service","article_description":"Optional short summary","procedures":[{"title":"Remove caliper","description":"","steps":[{"order":0,"text":"Loosen lug nuts before lifting."}],"tools_required":["torque wrench"],"parts_required":[{"description":"Brake pads","quantity":2}]}]}
`;

/** One Motor document may contain multiple distinct procedures — each entry has its own steps array. */
const PROCEDURE_ITEM_SCHEMA = {
    type: 'OBJECT',
    properties: {
        title: { type: 'STRING' },
        description: { type: 'STRING' },
        steps: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    order: { type: 'INTEGER' },
                    text: { type: 'STRING' },
                    image_url: { type: 'STRING' },
                    warning: { type: 'STRING' },
                    note: { type: 'STRING' }
                },
                required: ['text']
            }
        },
        tools_required: { type: 'ARRAY', items: { type: 'STRING' } },
        parts_required: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    part_number: { type: 'STRING' },
                    description: { type: 'STRING' },
                    quantity: { type: 'INTEGER' }
                },
                required: ['description']
            }
        },
        time_estimate_hours: { type: 'NUMBER' },
        cautions: { type: 'STRING' }
    },
    required: ['title', 'steps']
};

// Schema definitions aligned with Supabase/TypeScript for maximum retention and accessibility.
const SCHEMAS = {
    dtcs: {
        type: 'ARRAY',
        items: {
            type: 'OBJECT',
            properties: {
                code: { type: 'STRING' },
                description: { type: 'STRING' },
                possible_causes: { type: 'ARRAY', items: { type: 'STRING' } },
                symptoms: { type: 'ARRAY', items: { type: 'STRING' } },
                monitor_strategy: { type: 'STRING' },
                malfunction_criteria: { type: 'STRING' },
                diagnostic_steps: {
                    type: 'ARRAY',
                    items: {
                        type: 'OBJECT',
                        properties: {
                            order: { type: 'INTEGER' },
                            test: { type: 'STRING' },
                            result_match: { type: 'STRING' },
                            action_if_match: { type: 'STRING' },
                            action_if_not_match: { type: 'STRING' },
                            warning: { type: 'STRING' }
                        },
                        required: ['order', 'test']
                    }
                }
            },
            required: ['code', 'description']
        }
    },
    tsbs: {
        type: 'ARRAY',
        items: {
            type: 'OBJECT',
            properties: {
                bulletin_number: { type: 'STRING' },
                issue_date: { type: 'STRING' },
                title: { type: 'STRING' },
                summary: { type: 'STRING' },
                content: { type: 'STRING' },
                affected_components: { type: 'ARRAY', items: { type: 'STRING' } },
                models_affected: { type: 'ARRAY', items: { type: 'STRING' } }
            },
            required: ['bulletin_number', 'title']
        }
    },
    /** Top-level `procedures` array — collapsed to one L0 `procedures` row in `collapseProceduresForL1`. */
    procedures: {
        type: 'OBJECT',
        properties: {
            article_title: { type: 'STRING' },
            article_description: { type: 'STRING' },
            procedures: {
                type: 'ARRAY',
                items: PROCEDURE_ITEM_SCHEMA
            }
        },
        required: ['procedures']
    },
    specifications: {
        type: 'ARRAY',
        items: {
            type: 'OBJECT',
            properties: {
                category: { type: 'STRING' },
                name: { type: 'STRING' },
                value: { type: 'STRING' },
                unit: { type: 'STRING' },
                display_text: { type: 'STRING' },
                metadata: { type: 'OBJECT' }
            },
            required: ['name', 'value', 'category']
        }
    },
    common_issues: {
        type: 'ARRAY',
        items: {
            type: 'OBJECT',
            properties: {
                title: { type: 'STRING' },
                description: { type: 'STRING' },
                symptoms: { type: 'ARRAY', items: { type: 'STRING' } },
                severity: { type: 'STRING', enum: ['High', 'Medium', 'Low'] },
                fixComplexity: { type: 'STRING', enum: ['Easy', 'Moderate', 'Hard'] }
            },
            required: ['title', 'description', 'severity', 'fixComplexity']
        }
    }
};

const TUTORIAL_SCHEMA = {
    type: 'ARRAY',
    items: {
        type: 'OBJECT',
        properties: {
            title: { type: 'STRING' },
            content: { type: 'STRING' },
            warning: { type: 'STRING' },
            tool: { type: 'STRING' },
            mediaPlaceholder: { type: 'STRING' }
        },
        required: ['title', 'content']
    }
};

const MAX_RETRIES = 3;
/** Zod self-correction rounds (each triggers a new Nemotron call). */
const ZOD_PROCEDURE_ATTEMPTS = 3;

function parseMaxTokens() {
    const n = Number.parseInt(process.env.NEMOTRON_MAX_OUTPUT_TOKENS || process.env.NEMOTRON_MAX_TOKENS || '32768', 10);
    return Number.isFinite(n) && n > 0 ? n : 32768;
}

function stripJsonFences(s) {
    let t = String(s || '').trim();
    if (t.startsWith('```json')) t = t.replace(/^```json\n?/i, '');
    else if (t.startsWith('```')) t = t.replace(/^```\n?/, '');
    if (t.endsWith('```')) t = t.replace(/\n?```$/, '');
    return t.trim();
}

/**
 * Collapse multi-procedure Nemotron output into one `procedures` table row (single external_id per article).
 * Preserves section boundaries by prefixing the first step of each sub-procedure with a Markdown heading line.
 */
export function collapseProceduresForL1(parsed) {
    if (!parsed || typeof parsed !== 'object') return parsed;
    if (!Array.isArray(parsed.procedures) || parsed.procedures.length === 0) {
        return parsed;
    }

    const procs = parsed.procedures;
    const title = procs.map((p) => p.title).filter(Boolean).join(' · ') || 'Service procedures';
    const description =
        procs.map((p) => p.description).filter(Boolean).join('\n\n') || null;

    const mergedSteps = [];
    let order = 0;
    for (const p of procs) {
        const secTitle = (p.title && String(p.title).trim()) || 'Procedure';
        const steps = Array.isArray(p.steps) ? p.steps : [];
        steps.forEach((s, idx) => {
            const text = typeof s.text === 'string' ? s.text : '';
            const block =
                idx === 0
                    ? `**${secTitle}**\n\n${text}`
                    : text;
            mergedSteps.push({
                order: order++,
                text: block,
                image_url: s.image_url || null,
                warning: s.warning || null,
                note: s.note || null
            });
        });
    }

    const tools = [];
    const parts = [];
    for (const p of procs) {
        if (Array.isArray(p.tools_required)) {
            tools.push(...p.tools_required.map((t) => String(t)));
        }
        if (Array.isArray(p.parts_required)) {
            parts.push(...p.parts_required);
        }
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
    const tt = u.total_tokens ?? pt + ct;
    return { prompt_tokens: pt, completion_tokens: ct, total_tokens: tt };
}

function extractArticleIdFromMeta(meta) {
    const p = meta?.urlPath;
    if (!p || typeof p !== 'string') return null;
    const m = p.match(/\/article\/([^?/]+)/);
    return m ? m[1] : null;
}

function safeJsonParse(text) {
    const cleaned = stripJsonFences(text);
    try {
        return JSON.parse(cleaned);
    } catch (e1) {
        const m = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (m) {
            try {
                return JSON.parse(m[0]);
            } catch (e2) {
                logger.warn(`safeJsonParse: brace-extract failed: ${e2.message}`);
            }
        }
        throw new Error(`Invalid JSON from model: ${e1.message}`);
    }
}

/**
 * Structured Nemotron call: non-streaming, no thinking budget, large max_tokens — avoids truncated JSON.
 * Globally throttled via p-limit (NEMOTRON_STRUCTURED_CONCURRENCY, default 3) to reduce 429s.
 * @returns {Promise<{ text: string, usage: { prompt_tokens?: number, completion_tokens?: number, total_tokens?: number } | null }>}
 */
async function callStructuredCompletion(userPrompt, schema) {
    const openai = getNemotronClient();
    if (!openai) {
        throw new Error('Nemotron unavailable — set NVIDIA_API_KEY, NVAPI_KEY, or LLM_API_KEY');
    }

    const schemaBlock = `\n\nReturn JSON that matches this schema (types are conceptual; output valid JSON only):\n${JSON.stringify(schema, null, 2)}`;

    const useJsonObjectMode =
        String(process.env.NEMOTRON_JSON_RESPONSE || process.env.OPENAI_JSON_MODE || '').toLowerCase() === 'true' ||
        process.env.NEMOTRON_JSON_RESPONSE === '1';

    const body = {
        model: getNemotronTextModel(),
        messages: [
            { role: 'system', content: SYSTEM_JSON_STRICT },
            { role: 'user', content: userPrompt + schemaBlock }
        ],
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: parseMaxTokens(),
        stream: false
    };

    // OpenAI `json_object` requires a JSON object at root — not valid for array-root schemas (dtcs, tsbs, …).
    if (useJsonObjectMode && schema && schema.type === 'OBJECT') {
        body.response_format = { type: 'json_object' };
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const completion = await structuredLimit(() => openai.chat.completions.create(body));
            const fullContent = completion.choices[0]?.message?.content;
            if (!fullContent || !String(fullContent).trim()) {
                throw new Error('Nemotron returned empty content');
            }
            return { text: String(fullContent).trim(), usage: completion.usage ?? null };
        } catch (error) {
            const code = error?.status || error?.code;
            const isRate = code === 429 || String(error?.message || '').includes('429');
            logger.warn(`Nemotron structured API error (attempt ${attempt + 1}): ${error.message}`);
            if (attempt === MAX_RETRIES) throw error;
            const backoff = isRate ? 5000 * (attempt + 1) : 2000 * (attempt + 1);
            await new Promise((r) => setTimeout(r, backoff));
        }
    }
}

/**
 * Free-form text (rewrite) — streaming optional; thinking disabled to save tokens.
 * @param {{ temperature?: number, top_p?: number, max_tokens?: number }} [options] Used when schema is null (chat completion).
 */
async function callAI(prompt, schema = null, options = {}) {
    if (schema) {
        const r = await callStructuredCompletion(prompt.replace(/\s*$/, ''), schema);
        return r.text;
    }

    const openai = getNemotronClient();
    if (!openai) {
        throw new Error('Nemotron unavailable — set NVIDIA_API_KEY, NVAPI_KEY, or LLM_API_KEY');
    }

    const temperature = typeof options.temperature === 'number' ? options.temperature : 0.7;
    const top_p = typeof options.top_p === 'number' ? options.top_p : 0.95;
    const max_tokens =
        typeof options.max_tokens === 'number'
            ? options.max_tokens
            : Math.min(parseMaxTokens(), 8192);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const completion = await openai.chat.completions.create({
                model: getNemotronTextModel(),
                messages: [{ role: 'user', content: prompt }],
                temperature,
                top_p,
                max_tokens,
                stream: true,
                chat_template_kwargs: { enable_thinking: false }
            });

            let fullContent = '';
            for await (const chunk of completion) {
                if (chunk.choices[0]?.delta?.content) {
                    fullContent += chunk.choices[0].delta.content;
                }
            }

            if (!fullContent) {
                throw new Error('Nemotron returned no text in response');
            }
            return fullContent;
        } catch (error) {
            logger.warn(`Nemotron API error (attempt ${attempt + 1}): ${error.message}`);
            if (attempt === MAX_RETRIES) throw error;
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
    }
}

export async function rewriteArticleHtml(html, title = '') {
    if (!html || !html.trim()) return html;

    const trimmed = html.slice(0, 12000);
    const titleLine = (title && String(title).trim()) || '(none)';

    const prompt = `You are an automotive technical editor. Produce a PUBLICATION-READY rewrite of the HTML below. The source is reference material only — your output must be substantively different prose so it is not close paraphrase or recognizably the same wording as the source (avoid plagiarism: new vocabulary, new sentence structures, and varied phrasing throughout).

Rewrite requirements:
- Express every instruction, caution, specification, and step in clearly original language. Do not preserve distinctive phrases, parallel sentence patterns, or the source's rhythm.
- You may reorder sentences within a paragraph when it improves clarity, but keep procedure order and step sequence logically correct and complete.
- Preserve all technical facts exactly: part numbers, codes, torques, measurements, fluid types, tool names where given, DTC codes, and safety implications. Do not omit, add, or soften warnings.
- Use a confident, direct service-manual tone; avoid copying stock phrases from the source.

HTML mechanics (strict):
- Keep ALL tags, attributes, and nesting exactly as in the input.
- Change ONLY human-visible text node content (paragraphs, headings, list items, table cells, figcaptions, etc.).
- Do NOT add, remove, or rename tags. Do NOT alter <img>, <mtr-image>, <iframe>, or <object> elements.
- Do NOT change href, src, id, or data-* attribute values.
- Leave bare numbers/codes that are the factual value unchanged when they appear as the primary content of a cell or line.

Context — article title (do not paste into output unless it already appears as HTML in the source): ${titleLine}

Source HTML:
${trimmed}

Output ONLY the complete rewritten HTML. No markdown fences, no commentary.`;

    const rewritten = await callAI(prompt, null, {
        temperature: 0.88,
        top_p: 0.9,
        max_tokens: Math.min(parseMaxTokens(), 8192)
    });
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
- title: Short, action-oriented title (5-10 words, imperative mood e.g. "Remove the Battery")
- content: Clear HTML instruction paragraph(s) for this step. Use active voice, include specific details.
- warning: (optional) Safety-critical warning text if applicable. Omit if not relevant.
- tool: (optional) Primary tool or part required for this step. Omit if not applicable.
- mediaPlaceholder: (optional) Leave empty string.

Create between 3 and 12 meaningful steps covering the full procedure. Only include steps that are genuinely actionable. Preserve safety warnings and technical accuracy.`;

    const { text } = await callStructuredCompletion(prompt, TUTORIAL_SCHEMA);
    return safeJsonParse(text);
}

/**
 * @param {unknown} rawData
 * @param {string} targetSchema
 * @param {{ urlPath?: string }} [meta] urlPath enables DLQ article_id + failed_extractions.url_path
 * @returns {Promise<{ parsed: unknown, usage: { prompt_tokens: number, completion_tokens: number, total_tokens: number } }>}
 */
export async function parseWithAI(rawData, targetSchema, meta = {}) {
    if (!SCHEMAS[targetSchema]) {
        throw new Error(`Schema ${targetSchema} is not defined in ai_parser.js`);
    }

    const schemaHints = {
        tsbs: 'Format issue_date as YYYY-MM-DD when present. Preserve full content including HTML.',
        dtcs: 'For diagnostic_steps: test=what to measure, result_match=expected value/criteria, action_if_match=next step if pass, action_if_not_match=action if fail. Use empty string for missing action fields.',
        procedures:
            'Identify EVERY distinct procedure or major section in the document. Output one object per distinct procedure in `procedures`, each with its own `steps` array. Do not merge unrelated procedures. ' +
            'Include optional `article_title` and `article_description` when inferable. ' +
            'For parts_required: include every line with a description; use quantity only when the OEM text gives a number (otherwise omit quantity). Never omit an entire parts_required array because quantity is unknown.',
        specifications: 'Use metadata for any extra key-value pairs that do not fit category/name/value/unit.'
    };

    let userPrompt;
    const MAX_CHARS = 150000;

    if (targetSchema === 'procedures') {
        const { html } = extractArticleHtmlFromMotorPayload(
            typeof rawData === 'string' ? rawData : JSON.stringify(rawData)
        );
        if (!html || !html.trim()) {
            const rawStr = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
            userPrompt =
                `Parse the following Motor API payload into the schema. If HTML is embedded in JSON, infer procedures from it.\n\n${FEW_SHOT_PROCEDURES}\n\n` +
                `${schemaHints.procedures}\n\n---\n\n${rawStr.slice(0, MAX_CHARS)}`;
        } else {
            const md = htmlToMarkdownForLlm(html, { maxChars: MAX_CHARS });
            userPrompt =
                `You are an automotive data parser. The following Markdown was converted from a Motor service document (tables/lists preserved). ` +
                `Extract ALL distinct procedures; each procedure must have its own title and steps array. ` +
                `Map parts_required with description required; include quantity only when stated.\n\n${FEW_SHOT_PROCEDURES}\n\n${schemaHints.procedures}\n\n---\n\n${md}`;
        }

        let correctionSuffix = '';
        let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        let lastErr = '';

        for (let zAttempt = 0; zAttempt < ZOD_PROCEDURE_ATTEMPTS; zAttempt++) {
            const { text, usage } = await callStructuredCompletion(userPrompt + correctionSuffix, SCHEMAS.procedures);
            totalUsage = mergeUsage(totalUsage, usage);

            let parsedRaw;
            try {
                parsedRaw = safeJsonParse(text);
            } catch (e) {
                lastErr = `Invalid JSON: ${e.message}`;
                correctionSuffix = `\n\nYour previous JSON failed validation with this error: ${lastErr}. Fix the formatting and return ONLY the corrected JSON.`;
                continue;
            }

            const v = ArticleExtractionSchema.safeParse(parsedRaw);
            if (v.success) {
                const collapsed = collapseProceduresForL1(v.data);
                return { parsed: collapsed, usage: normalizeUsage(totalUsage) };
            }

            lastErr = formatZodError(v.error);
            correctionSuffix = `\n\nYour previous JSON failed validation with this error: ${lastErr}. Fix the formatting and return ONLY the corrected JSON.`;
        }

        const rawText = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
        const articleId = extractArticleIdFromMeta(meta) || 'unknown';
        await insertFailedExtraction({
            article_id: articleId,
            raw_text: rawText.slice(0, 120000),
            error_message: `Zod validation failed after ${ZOD_PROCEDURE_ATTEMPTS} attempts: ${lastErr}`,
            url_path: meta.urlPath || null,
            category: 'procedures'
        });

        throw new Error(
            `Procedure JSON validation failed after ${ZOD_PROCEDURE_ATTEMPTS} correction attempts: ${lastErr}`
        );
    }

    const rawStr = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
    const trimmedData = rawStr.slice(0, MAX_CHARS);
    const wasTruncated = rawStr.length > MAX_CHARS;
    if (wasTruncated) {
        logger.warn(`parseWithAI: input truncated from ${rawStr.length} to ${MAX_CHARS} chars for ${targetSchema}`);
    }
    const hint = schemaHints[targetSchema] ? `\n\nSchema-specific: ${schemaHints[targetSchema]}` : '';
    userPrompt =
        `You are an automotive data parser. Extract ALL relevant technical information from the provided raw data and map it strictly to the output schema. ` +
        `Capture every item — do not skip any. If some optional fields are not present, omit them or provide empty arrays/strings. Do not hallucinate data.${hint}` +
        (wasTruncated ? '\n\nNote: The data below was truncated. Extract everything that IS present.' : '') +
        `\n\nRaw Data:\n${trimmedData}`;

    const { text, usage } = await callStructuredCompletion(userPrompt, SCHEMAS[targetSchema]);
    const parsed = safeJsonParse(text);

    return { parsed, usage: normalizeUsage(usage) };
}

export async function generateCommonIssues(vehicleName) {
    if (!vehicleName || !vehicleName.trim()) return [];

    const prompt = `You are an automotive service advisor. Generate a list of common issues, failures, and known patterns for the following vehicle:
    
Vehicle: ${vehicleName}

For each issue, provide:
- title: Short name of the issue.
- description: Brief technical explanation of why it happens.
- symptoms: List of signs the driver might notice.
- severity: High (safety/breakdown), Medium (performance/repair soon), or Low (nuisance/maintenance).
- fixComplexity: Easy (DIY), Moderate (Special tools/shop), or Hard (Engine/Trans tear down).

Create 4-8 high-quality common issues tailored to this specific vehicle.`;

    try {
        const { text } = await callStructuredCompletion(prompt, SCHEMAS.common_issues);
        return safeJsonParse(text);
    } catch (err) {
        logger.error(`generateCommonIssues failed for ${vehicleName}:`, err);
        return [];
    }
}
