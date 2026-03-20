/**
 * Health endpoints (non-authenticated).
 */

export function registerHealthEndpoint(app, authManager) {
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            sessionValid: authManager.isSessionValid(),
            lastAuth: authManager.lastAuthTime
        });
    });
}

