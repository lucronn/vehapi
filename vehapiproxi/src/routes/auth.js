/**
 * Auth progress endpoints.
 */

export function registerAuthEndpoints(app, authManager, logger) {
    // Authentication status endpoint for progress polling
    app.get('/auth/status', (req, res) => {
        const progress = authManager.getProgress();
        res.json({
            ...progress,
            sessionValid: authManager.isSessionValid(),
            lastAuth: authManager.lastAuthTime
        });
    });

    // Trigger authentication endpoint (optional - for manual triggering)
    app.post('/auth/start', async (req, res) => {
        try {
            // Reset progress and start authentication
            authManager.resetProgress();

            // Start authentication in background (don't wait)
            authManager.authenticate().catch(err => {
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

/**
 * Auth progress endpoints.
 */

export function registerAuthEndpoints(app, authManager, logger) {
    // Authentication status endpoint for progress polling
    app.get('/auth/status', (req, res) => {
        const progress = authManager.getProgress();
        res.json({
            ...progress,
            sessionValid: authManager.isSessionValid(),
            lastAuth: authManager.lastAuthTime
        });
    });

    // Trigger authentication endpoint (optional - for manual triggering)
    app.post('/auth/start', async (req, res) => {
        try {
            // Reset progress and start authentication
            authManager.resetProgress();

            // Start authentication in background (don't wait)
            authManager.authenticate().catch(err => {
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

