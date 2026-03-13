import logger from './logger.js';

// Use the Gemini REST API directly via fetch - no SDK needed, works everywhere
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// 2.0-flash: fast, cheap, ideal for structured extraction. Upgrade to gemini-3-flash when GA.
const MODEL = 'gemini-2.0-flash';

// Schema definitions aligned with Supabase/TypeScript for maximum retention and accessibility.
// Single source of truth for AI output structure.
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
    procedures: {
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
                    required: ['order', 'text']
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
                    required: ['description', 'quantity']
                }
            },
            time_estimate_hours: { type: 'NUMBER' },
            cautions: { type: 'STRING' }
        },
        required: ['title']
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

// Schema for tutorial generation
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

/**
 * Internal helper that calls the Gemini generateContent endpoint.
 * Retries automatically on 429 (rate limit) with exponential backoff.
 * @param {string} prompt Text prompt to send
 * @param {object|null} schema Optional JSON schema for structured output
 * @returns {string} Raw text response from Gemini
 */
async function callGemini(prompt, schema = null) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    const generationConfig = schema
        ? { responseMimeType: 'application/json', responseSchema: schema }
        : {};

    const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig
    };

    const url = `${GEMINI_API_BASE}/${MODEL}:generateContent?key=${apiKey}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (response.status === 429 && attempt < MAX_RETRIES) {
            const retryMatch = (await response.text()).match(/retryDelay.*?(\d+)/);
            const delaySec = retryMatch ? Math.min(parseInt(retryMatch[1], 10), 60) : (10 * (attempt + 1));
            logger.info(`Gemini 429 rate-limited, retrying in ${delaySec}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
            await new Promise(r => setTimeout(r, delaySec * 1000));
            continue;
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API error ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            throw new Error('Gemini returned no text in response');
        }
        return text;
    }

    throw new Error('Gemini API: max retries exceeded on 429');
}

/**
 * Rewrites the text content of an HTML article using AI while preserving structure and media.
 * Images (<img>, <mtr-image>) and PDFs are kept untouched; only text nodes are rewritten.
 * @param {string} html Raw HTML from the Motor API
 * @returns {Promise<string>} Rewritten HTML string
 */
export async function rewriteArticleHtml(html) {
    if (!html || !html.trim()) return html;

    // Trim input to avoid token limits
    const trimmed = html.slice(0, 12000);

    const prompt = `You are an automotive technical writer. Rephrase the text content in the following HTML article in your own words while maintaining technical accuracy, the original meaning, step sequences, safety warnings, and HTML structure.

Rules:
- Keep ALL HTML tags, attributes, and structure exactly as-is.
- Rephrase ONLY the visible text content inside tags (paragraphs, headings, list items, table cells, etc.) using different wording while preserving meaning.
- Do NOT change, remove, or add any <img>, <mtr-image>, <iframe>, or <object> tags.
- Do NOT change href or src attribute values.
- Preserve all part numbers, codes, measurements, and technical specifications exactly.
- Use active voice and clear, concise language.
- Output ONLY the rewritten HTML with no additional commentary.

Original HTML:
${trimmed}`;

    const rewritten = await callGemini(prompt, null);
    return rewritten.trim();
}

/**
 * Generates interactive tutorial steps from an article's HTML content.
 * @param {string} html Processed article HTML
 * @param {string} title Article title for context
 * @returns {Promise<Array>} Array of TutorialStep objects
 */
export async function generateTutorialSteps(html, title = '') {
    if (!html || !html.trim()) return [];

    // Strip HTML tags to get plain text for the prompt (keeps token count manageable)
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

    const text = await callGemini(prompt, TUTORIAL_SCHEMA);
    return JSON.parse(text);
}

/**
 * Parses raw JSON from the Motor API into a structured format via Gemini REST API.
 * @param {string} rawData JSON string of the raw response
 * @param {string} targetSchema The key in SCHEMAS (e.g. 'dtcs' or 'tsbs')
 */
export async function parseWithAI(rawData, targetSchema) {
    if (!SCHEMAS[targetSchema]) {
        throw new Error(`Schema ${targetSchema} is not defined in ai_parser.js`);
    }

    const rawStr = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
    const MAX_CHARS = 150000; // ~37k tokens; Gemini 2.0 Flash supports 1M - no truncation for typical articles
    const trimmedData = rawStr.slice(0, MAX_CHARS);
    const wasTruncated = rawStr.length > MAX_CHARS;

    if (wasTruncated) {
        logger.warn(`parseWithAI: input truncated from ${rawStr.length} to ${MAX_CHARS} chars for ${targetSchema}`);
    }
    const schemaHints = {
        tsbs: 'Format issue_date as YYYY-MM-DD when present. Preserve full content including HTML.',
        dtcs: 'For diagnostic_steps: test=what to measure, result_match=expected value/criteria, action_if_match=next step if pass, action_if_not_match=action if fail. Use empty string for missing action fields.',
        procedures: 'Extract parts_required (part_number, description, quantity) when present. Include image_url in steps if image references exist. time_estimate_hours as number when given.',
        specifications: 'Use metadata for any extra key-value pairs that do not fit category/name/value/unit.'
    };
    const hint = schemaHints[targetSchema] ? `\n\nSchema-specific: ${schemaHints[targetSchema]}` : '';
    const prompt = `You are an automotive data parser. Extract ALL relevant technical information from the provided raw JSON response and map it strictly to the output schema. Capture every item — do not skip any. If some optional fields are not present, omit them or provide empty arrays/strings. Do not hallucinate data.${hint}${wasTruncated ? '\n\nNote: The data below was truncated. Extract everything that IS present.' : ''}\n\nRaw Data:\n${trimmedData}`;

    const text = await callGemini(prompt, SCHEMAS[targetSchema]);
    return JSON.parse(text);
}

/**
 * Generates common issues for a given vehicle using Gemini.
 * @param {string} vehicleName The year make model of the vehicle.
 * @returns {Promise<Array>} Array of CommonIssue objects.
 */
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
        const text = await callGemini(prompt, SCHEMAS.common_issues);
        return JSON.parse(text);
    } catch (err) {
        logger.error(`generateCommonIssues failed for ${vehicleName}:`, err);
        return [];
    }
}
