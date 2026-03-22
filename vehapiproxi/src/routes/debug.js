import crypto from 'crypto';

/**
 * /debug endpoints for proxy diagnostics.
 * Mounted with an auth middleware using `config.debugApiKey`.
 */
export function registerDebugEndpoints(app, { config, authManager, logger, logBuffer }) {
    const debugAuthMiddleware = (req, res, next) => {
        const { debugApiKey } = config;

        // Fail closed if no key is configured
        if (!debugApiKey) {
            logger.warn('Debug access attempted but DEBUG_API_KEY is not configured');
            return res.status(403).json({ error: 'Debug access disabled' });
        }

        const requestKey = req.headers['x-debug-key'];

        // Constant-time comparison
        if (!requestKey || typeof requestKey !== 'string') {
            logger.warn(`Unauthorized debug access attempt from ${req.ip}`);
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Ensure lengths are equal first to avoid timing attacks on length
        if (requestKey.length !== debugApiKey.length) {
            logger.warn(`Unauthorized debug access attempt from ${req.ip}`);
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const requestKeyBuf = Buffer.from(requestKey);
        const debugApiKeyBuf = Buffer.from(debugApiKey);

        if (!crypto.timingSafeEqual(requestKeyBuf, debugApiKeyBuf)) {
            logger.warn(`Unauthorized debug access attempt from ${req.ip}`);
            return res.status(401).json({ error: 'Unauthorized' });
        }

        next();
    };

    // Apply auth middleware to all debug endpoints
    app.use('/debug', debugAuthMiddleware);

    // Get all logs with optional filtering
    app.get('/debug/logs', (req, res) => {
        try {
            const filters = {
                method: req.query.method,
                status: req.query.status,
                error: req.query.error === 'true',
                url: req.query.url,
                limit: req.query.limit
            };

            const logs = logBuffer.getAll(filters);
            res.json({
                count: logs.length,
                filters,
                logs
            });
        } catch (error) {
            res.status(500).json({
                error: error.message
            });
        }
    });

    // Get specific log by request ID
    app.get('/debug/logs/:requestId', (req, res) => {
        try {
            const log = logBuffer.get(req.params.requestId);
            if (!log) {
                return res.status(404).json({
                    error: 'Log entry not found'
                });
            }
            res.json(log);
        } catch (error) {
            res.status(500).json({
                error: error.message
            });
        }
    });

    // Get statistics
    app.get('/debug/stats', (req, res) => {
        try {
            const stats = logBuffer.getStats();
            res.json(stats);
        } catch (error) {
            res.status(500).json({
                error: error.message
            });
        }
    });

    // Clear log buffer
    app.post('/debug/clear', (req, res) => {
        try {
            logBuffer.clear();
            res.json({
                status: 'success',
                message: 'Log buffer cleared'
            });
        } catch (error) {
            res.status(500).json({
                error: error.message
            });
        }
    });

    // Get curl command to hit Motor directly using proxy's auth (Cookie + Referer/User-Agent)
    app.get('/debug/motor-curl', async (req, res) => {
        try {
            const cookieHeader = await authManager.getCookieHeader();
            if (!cookieHeader || cookieHeader.length === 0) {
                return res.status(502).json({ error: 'No proxy session; authenticate first via proxy.' });
            }

            const path = (req.query.path || '/').replace(/^\/+/, '/');
            const url = `${config.motorApiBase}${path === '/' ? '' : path}`;
            const curl = `curl -H 'Cookie: ${cookieHeader.replace(/'/g, "'\\''")}' -H 'Referer: https://sites.motor.com/m1/' -H 'User-Agent: ${config.userAgent.replace(/'/g, "'\\''")}' '${url}'`;
            res.json({ curl, url });
        } catch (error) {
            logger.error('debug/motor-curl:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Fetch Motor directly with proxy auth and return response body (e.g. to inspect HTML/scripts)
    app.get('/debug/motor-fetch', async (req, res) => {
        try {
            const cookieHeader = await authManager.getCookieHeader();
            if (!cookieHeader || cookieHeader.length === 0) {
                return res.status(502).json({ error: 'No proxy session; authenticate first via proxy.' });
            }

            const path = (req.query.path || '/').replace(/^\/+/, '/');
            const url = `${config.motorApiBase}${path === '/' ? '' : path}`;

            const resp = await fetch(url, {
                headers: {
                    Cookie: cookieHeader,
                    Referer: 'https://sites.motor.com/m1/',
                    'User-Agent': config.userAgent
                }
            });

            const contentType = resp.headers.get('content-type') || 'application/octet-stream';
            const body = await resp.text();
            res.set('Content-Type', contentType);
            res.set('X-Motor-Status', String(resp.status));
            res.set('X-Motor-Url', url);
            res.status(200).send(body);
        } catch (error) {
            logger.error('debug/motor-fetch:', error);
            res.status(500).json({ error: error.message });
        }
    });
}

