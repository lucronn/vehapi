import winston from 'winston';
import { randomUUID } from 'crypto';

// In-memory log buffer for quick access
class LogBuffer {
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.logs = [];
        this.stats = {
            totalRequests: 0,
            errors: 0,
            avgDuration: 0,
            lastReset: new Date().toISOString()
        };
    }

    add(logEntry) {
        this.logs.unshift(logEntry);
        if (this.logs.length > this.maxSize) {
            this.logs.pop();
        }

        // Update stats
        this.stats.totalRequests++;
        if (logEntry.error) {
            this.stats.errors++;
        }
        if (logEntry.duration) {
            const total = this.stats.avgDuration * (this.stats.totalRequests - 1) + logEntry.duration;
            this.stats.avgDuration = Math.round(total / this.stats.totalRequests);
        }
    }

    get(requestId) {
        return this.logs.find(log => log.requestId === requestId);
    }

    getAll(filters = {}) {
        let filtered = this.logs;

        if (filters.method) {
            filtered = filtered.filter(log => log.method === filters.method.toUpperCase());
        }
        if (filters.status) {
            filtered = filtered.filter(log => log.status === parseInt(filters.status));
        }
        if (filters.error) {
            filtered = filtered.filter(log => log.error !== null);
        }
        if (filters.url) {
            filtered = filtered.filter(log => log.url.includes(filters.url));
        }

        const limit = parseInt(filters.limit) || 50;
        return filtered.slice(0, limit);
    }

    getStats() {
        return {
            ...this.stats,
            bufferSize: this.logs.length,
            maxSize: this.maxSize
        };
    }

    clear() {
        this.logs = [];
        this.stats = {
            totalRequests: 0,
            errors: 0,
            avgDuration: 0,
            lastReset: new Date().toISOString()
        };
    }
}

// Create global log buffer
export const logBuffer = new LogBuffer(100);

// Winston logger configuration
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, requestId, ...meta }) => {
                    const reqId = requestId ? `[${requestId.slice(0, 8)}]` : '';
                    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
                    return `${timestamp} ${reqId} [${level}]: ${message} ${metaStr}`;
                })
            )
        })
    ]
});

// Helper to sanitize sensitive data
function sanitize(obj) {
    if (!obj) return obj;
    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
        return obj.map(item => sanitize(item));
    }

    const sanitized = { ...obj };
    const sensitiveKeys = [
        'authorization', 'cookie', 'set-cookie', 'password', 'token', 'api-key', 'api_key',
        'access_token', 'secret', 'client_secret', 'user_id', 'email', 'ssn',
        'credit_card', 'phone'
    ];

    for (const key of Object.keys(sanitized)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
            sanitized[key] = '[REDACTED]';
        } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
            sanitized[key] = sanitize(sanitized[key]);
        }
    }
    return sanitized;
}

// Helper to truncate large bodies
function truncateBody(body, maxLength = 1000) {
    if (!body) return null;
    const str = typeof body === 'string' ? body : JSON.stringify(body);
    return str.length > maxLength ? str.slice(0, maxLength) + '... [truncated]' : str;
}

// Enhanced logging functions
export function logRequest(req, metadata = {}) {
    const requestId = req.requestId || randomUUID();
    req.requestId = requestId;
    req.startTime = Date.now();

    const logEntry = {
        requestId,
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.url,
        headers: sanitize(req.headers),
        query: sanitize(req.query),
        ...metadata
    };

    logger.info('Incoming request', logEntry);
    return requestId;
}

export function logResponse(req, res, responseData = null, error = null) {
    const duration = Date.now() - (req.startTime || Date.now());

    const logEntry = {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration,
        request: {
            headers: sanitize(req.headers),
            query: sanitize(req.query),
            body: truncateBody(sanitize(req.body))
        },
        response: {
            headers: sanitize(res.getHeaders()),
            body: truncateBody(sanitize(responseData))
        },
        error: error ? {
            message: error.message,
            stack: error.stack,
            code: error.code
        } : null,
        metadata: {
            sessionValid: req.sessionValid,
            cached: req.cached || false
        }
    };

    // Add to buffer
    logBuffer.add(logEntry);

    // Log to winston
    if (error) {
        logger.error('Request failed', logEntry);
    } else {
        logger.info('Request completed', logEntry);
    }
}

export default logger;
