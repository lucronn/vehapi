import logger from './logger.js';

// Use the Gemini REST API directly via fetch - no SDK needed, works everywhere
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

// The schema definitions to enforce structured output
const SCHEMAS = {
    dtcs: {
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
                        text: { type: 'STRING' },
                        warning: { type: 'STRING' }
                    }
                }
            }
        },
        required: ['code', 'description']
    },
    tsbs: {
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
                        warning: { type: 'STRING' }
                    }
                }
            },
            tools_required: { type: 'ARRAY', items: { type: 'STRING' } },
            cautions: { type: 'STRING' }
        },
        required: ['title']
    },
    specifications: {
        type: 'OBJECT',
        properties: {
            category: { type: 'STRING' },
            name: { type: 'STRING' },
            value: { type: 'STRING' },
            unit: { type: 'STRING' },
            display_text: { type: 'STRING' }
        },
        required: ['name', 'value', 'category']
    }
};

/**
 * Parses raw JSON from the Motor API into a structured format via Gemini REST API.
 * @param {string} rawData JSON string of the raw response
 * @param {string} targetSchema The key in SCHEMAS (e.g. 'dtcs' or 'tsbs')
 */
export async function parseWithAI(rawData, targetSchema) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    if (!SCHEMAS[targetSchema]) {
        throw new Error(`Schema ${targetSchema} is not defined in ai_parser.js`);
    }

    // Trim raw data to avoid exceeding token limits (first 8000 chars)
    const trimmedData = typeof rawData === 'string' ? rawData.slice(0, 8000) : JSON.stringify(rawData).slice(0, 8000);

    const prompt = `You are an automotive data parser. Extract the relevant technical information from the provided raw JSON response and map it strictly to the output schema. If some data is not present, omit it or provide empty arrays/strings. Do not hallucinate data.\n\nRaw Data:\n${trimmedData}`;

    const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: SCHEMAS[targetSchema]
        }
    };

    const url = `${GEMINI_API_BASE}/${MODEL}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
        throw new Error('Gemini returned no text in response');
    }

    return JSON.parse(text);
}
