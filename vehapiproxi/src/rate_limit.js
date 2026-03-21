import rateLimit from 'express-rate-limit';

/**
 * Per-IP limiter for GET article HTML/content paths under `/api/source/.../article/...`.
 * Skipped when `x-vehapi-verify: 1` (evidence-link verify script).
 */
export function createArticleContentRateLimiter() {
    const windowMs = Number.parseInt(process.env.ARTICLE_RATE_LIMIT_WINDOW_MS || '60000', 10);
    const max = Number.parseInt(process.env.ARTICLE_RATE_LIMIT_MAX || '120', 10);

    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => String(req.headers['x-vehapi-verify'] || '').trim() === '1',
        handler: (req, res) => {
            const retrySec = Math.max(1, Math.ceil(windowMs / 1000));
            res.setHeader('Retry-After', String(retrySec));
            res.status(429).json({
                error: 'Too many article content requests',
                retryAfterSeconds: retrySec
            });
        }
    });
}

/** Only apply the limiter to article content GET routes (mounted under `/api`). */
export function articleContentRateLimitGate(limiter) {
    const articleGet = /^\/source\/[^/]+\/vehicle\/[^/]+\/article\/[^/]+(?:\/html)?$/;
    return (req, res, next) => {
        if (req.method !== 'GET' || !articleGet.test(req.path)) {
            return next();
        }
        return limiter(req, res, next);
    };
}
