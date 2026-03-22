import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';

/**
 * Per-IP limiter for GET article HTML/content paths under `/api/source/.../article/...`.
 * When `SUPABASE_JWT_SECRET` is set and `Authorization: Bearer <valid JWT>` is present,
 * the key is per user (`sub`); otherwise per `req.ip`.
 * Skipped when `x-vehapi-verify: 1` (evidence-link verify script).
 */
function articleRateLimitKey(req) {
    const secret = process.env.SUPABASE_JWT_SECRET;
    const auth = req.headers.authorization;
    if (secret && typeof auth === 'string' && auth.startsWith('Bearer ')) {
        try {
            const decoded = jwt.verify(auth.slice(7), secret);
            if (decoded?.sub) {
                return `user:${decoded.sub}`;
            }
        } catch {
            /* invalid/expired token — fall back to IP */
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
