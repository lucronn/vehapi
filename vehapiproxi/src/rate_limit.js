import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';

/**
 * Per-IP limiter for GET article HTML/content paths under `/api/source/.../article/...`.
 * When a Bearer JWT is present, key is per user (`sub` claim); otherwise per `req.ip`.
 * Token signature is NOT verified here — this is rate-limit keying only; auth is done by
 * secureAuthMiddleware which verifies Firebase ID tokens.
 * Skipped when `x-vehapi-verify: 1` (evidence-link verify script).
 */
function articleRateLimitKey(req) {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        try {
            const decoded = jwt.decode(auth.slice(7));
            if (decoded?.sub) {
                return `user:${decoded.sub}`;
            }
        } catch {
            /* malformed token — fall back to IP */
        }
    }
    return req.ip || 'unknown';
}

export function createArticleContentRateLimiter() {
    const windowMs = Number.parseInt(process.env.ARTICLE_RATE_LIMIT_WINDOW_MS || '60000', 10);
    const max = Number.parseInt(process.env.ARTICLE_RATE_LIMIT_MAX || '120', 10);

    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: articleRateLimitKey,
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
