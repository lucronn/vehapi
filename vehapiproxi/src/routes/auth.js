import { proxyPool } from '../proxy-pool.js';

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

    app.get('/proxy-pool/status', (req, res) => {
        res.json(proxyPool.getStatus());
    });

    app.post('/proxy-pool/rotate', (req, res) => {
        proxyPool.rotate();
        res.json({ ok: true, status: proxyPool.getStatus() });
    });

    app.post('/proxy-pool/refresh', async (req, res) => {
        await proxyPool.refresh().catch(() => {});
        res.json({ ok: true, status: proxyPool.getStatus() });
    });

    app.post('/proxy-pool/reset-failures', (req, res) => {
        const count = proxyPool.resetFailures();
        res.json({ ok: true, reset: count, status: proxyPool.getStatus() });
    });

    app.post('/auth/reset', async (req, res) => {
        try {
            await authManager.invalidateSession();
            authManager.resetProgress();
            authManager.authenticate().catch((err) => {
                logger.error('Background authentication failed after reset:', err);
            });
            res.json({
                status: 'started',
                message: 'Session invalidated and new authentication started.'
            });
        } catch (error) {
            res.status(500).json({
                status: 'error',
                error: error.message
            });
        }
    });
}
