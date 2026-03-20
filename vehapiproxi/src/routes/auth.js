/**
 * Auth progress endpoints.
 */
export function registerAuthEndpoints(app, authManager, logger) {
    app.get('/auth/status', (req, res) => {
        const progress = authManager.getProgress();
        res.json({
            ...progress,
            sessionValid: authManager.isSessionValid(),
            lastAuth: authManager.lastAuthTime
        });
    });

    app.post('/auth/start', async (req, res) => {
        try {
            authManager.resetProgress();
            authManager.authenticate().catch((err) => {
                logger.error('Background authentication failed:', err);
            });
            res.json({
                status: 'started',
                message: 'Authentication started. Poll /auth/status for progress.'
            });
        } catch (error) {
            res.status(500).json({
                status: 'error',
                error: error.message
            });
        }
    });
}
