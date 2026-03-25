/**
 * Health endpoints (non-authenticated).
 */

import { getLlmKeyEnvSource } from '../nemotron_client.js';

export function registerHealthEndpoint(app, authManager) {
    app.get('/health', (req, res) => {
        const llmKeyEnv = getLlmKeyEnvSource();
        res.json({
            status: 'ok',
            sessionValid: authManager.isSessionValid(),
            lastAuth: authManager.lastAuthTime,
            /** True if process.env exposes NVIDIA_API_KEY, NVAPI_KEY, or LLM_API_KEY (value never returned). */
            llmKeyConfigured: !!llmKeyEnv,
            /** Which variable name is set — helps verify the correct Vercel project received env. */
            llmKeyEnv
        });
    });
}

