/**
 * Shared Nemotron / NVIDIA NIM OpenAI-compatible client.
 * Supports Torque env names (NVIDIA_API_KEY, NEMOTRON_BASE_URL, NEMOTRON_MODEL) and
 * selfdevai-style aliases (LLM_API_KEY, LLM_URL, LLM_MODEL).
 */
import OpenAI from 'openai';

/** OpenAI SDK base URL (no /chat/completions). */
export function resolveNemotronBaseUrl() {
    const explicit = (process.env.NEMOTRON_BASE_URL || '').trim();
    if (explicit) {
        return explicit.replace(/\/+$/, '');
    }
    const llmUrl = (process.env.LLM_URL || '').trim();
    if (llmUrl) {
        try {
            const u = new URL(llmUrl);
            let path = u.pathname.replace(/\/chat\/completions\/?$/i, '');
            if (path === '' || path === '/') {
                path = '/v1';
            }
            return `${u.origin}${path}`.replace(/\/+$/, '');
        } catch {
            // fall through to default
        }
    }
    return 'https://integrate.api.nvidia.com/v1';
}

export function getNemotronApiKey() {
    return (process.env.NVIDIA_API_KEY || process.env.NVAPI_KEY || process.env.LLM_API_KEY || '').trim();
}

/**
 * Which env var name is providing the key (for diagnostics only; never the secret value).
 * @returns {'NVIDIA_API_KEY'|'NVAPI_KEY'|'LLM_API_KEY'|null}
 */
export function getLlmKeyEnvSource() {
    if ((process.env.NVIDIA_API_KEY || '').trim()) return 'NVIDIA_API_KEY';
    if ((process.env.NVAPI_KEY || '').trim()) return 'NVAPI_KEY';
    if ((process.env.LLM_API_KEY || '').trim()) return 'LLM_API_KEY';
    return null;
}

/** Text/chat model (rewrite, parse, tutorials, thinking stream). */
export function getNemotronTextModel() {
    return (process.env.NEMOTRON_MODEL || process.env.LLM_MODEL || 'nvidia/nemotron-3-super-120b-a12b').trim();
}

let _openaiClient = null;

export function getNemotronClient() {
    if (_openaiClient) {
        return _openaiClient;
    }
    const apiKey = getNemotronApiKey();
    if (!apiKey) {
        return null;
    }
    _openaiClient = new OpenAI({
        apiKey,
        baseURL: resolveNemotronBaseUrl()
    });
    return _openaiClient;
}
