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
            /** True if GOOGLE_CLOUD_PROJECT is set (Vertex AI configured). */
            llmKeyConfigured: !!llmKeyEnv,
            /** Which variable name enabled AI — 'GOOGLE_CLOUD_PROJECT' when Vertex AI is configured. */
            llmKeyEnv
        });
    });
}

