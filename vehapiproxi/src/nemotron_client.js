/**
 * Vertex AI (Gemini) clients.
 *
 * Two surfaces:
 *  1. getNemotronClient() — OpenAI-compat endpoint (streaming free-text, rewrite, tutorials)
 *  2. getGeminiClient()  — native @google/genai SDK (structured JSON, constrained generation, thinking)
 *
 * Auth: Application Default Credentials via google-auth-library (Cloud Run ADC, or
 * GOOGLE_APPLICATION_CREDENTIALS locally).
 */
import OpenAI from 'openai';
import { GoogleAuth } from 'google-auth-library';
import { GoogleGenAI } from '@google/genai';

const PROJECT_ID = (process.env.GOOGLE_CLOUD_PROJECT || '').trim();
const LOCATION = (process.env.VERTEX_LOCATION || 'us-central1').trim();

function buildBaseUrl() {
    if (!PROJECT_ID) return null;
    return `https://${LOCATION}-aiplatform.googleapis.com/v1beta1/projects/${PROJECT_ID}/locations/${LOCATION}/endpoints/openapi`;
}

const VERTEX_BASE_URL = buildBaseUrl();

const _auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

/** Custom fetch that injects a fresh Bearer token on every request. google-auth-library caches and auto-refreshes. */
async function vertexFetch(url, init = {}) {
    const token = await _auth.getAccessToken();
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    return globalThis.fetch(url, { ...init, headers });
}

export function resolveNemotronBaseUrl() {
    return VERTEX_BASE_URL;
}

/** Returns a truthy sentinel when Vertex AI is configured (GOOGLE_CLOUD_PROJECT is set). */
export function getNemotronApiKey() {
    return PROJECT_ID ? 'vertex-adc' : '';
}

/** Returns the env var name that enabled AI — used by /health for diagnostics. */
export function getLlmKeyEnvSource() {
    return PROJECT_ID ? 'GOOGLE_CLOUD_PROJECT' : null;
}

/**
 * Structured parse model (constrained JSON generation).
 * Higher quality than text model; override via VERTEX_PARSE_MODEL.
 */
export function getParseModel() {
    return (
        process.env.VERTEX_PARSE_MODEL ||
        'gemini-2.5-flash-lite'
    ).trim();
}

/** Text/chat model for free-form generation (rewrite, tutorials, common-issues). */
export function getNemotronTextModel() {
    return (
        process.env.VERTEX_TEXT_MODEL ||
        process.env.NEMOTRON_MODEL ||
        'gemini-2.5-flash-lite'
    ).trim();
}

let _openaiClient = null;

/** OpenAI-compat client for streaming free-text calls. Returns null if PROJECT_ID unset. */
export function getNemotronClient() {
    if (_openaiClient) return _openaiClient;
    if (!VERTEX_BASE_URL) return null;
    _openaiClient = new OpenAI({
        apiKey: 'unused',
        baseURL: VERTEX_BASE_URL,
        fetch: vertexFetch,
    });
    return _openaiClient;
}

let _geminiClient = null;

/**
 * Native @google/genai client for structured JSON generation with responseSchema.
 * Use for all structured parse calls — constrained generation prevents malformed JSON entirely.
 */
export function getGeminiClient() {
    if (_geminiClient) return _geminiClient;
    if (!PROJECT_ID) return null;
    _geminiClient = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });
    return _geminiClient;
}

// ─── OpenRouter client (free Gemini 2.5 Flash — Phase 5 normalization pipeline) ──

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export function getOpenRouterApiKey() {
    return (process.env.OPENROUTER_API_KEY || '').trim();
}

export function getOpenRouterModel() {
    return (process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash').trim();
}

let _openRouterClient = null;

/**
 * OpenAI-compat client pointed at OpenRouter.
 * Returns null when OPENROUTER_API_KEY is unset.
 * Primary client for the normalization pipeline (free Gemini 2.5 Flash).
 */
export function getOpenRouterClient() {
    if (_openRouterClient) return _openRouterClient;
    const key = getOpenRouterApiKey();
    if (!key) return null;
    _openRouterClient = new OpenAI({
        apiKey: key,
        baseURL: OPENROUTER_BASE_URL,
        defaultHeaders: {
            'HTTP-Referer': 'https://vehapi-torque.web.app',
            'X-Title': 'vehapi normalization pipeline',
        },
    });
    return _openRouterClient;
}
