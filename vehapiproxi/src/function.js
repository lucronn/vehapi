import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, validateConfig } from './config.js';
import { authManager } from './auth.js';
import logger, { logBuffer, logRequest, logResponse } from './logger.js';
import swaggerUi from 'swagger-ui-express';
import { createRequire } from 'module';
import { createCheckoutSession, createBillingPortalSession, handleWebhook } from './stripe.js';
import { getUserData, unlockModule, getTransactions } from './credits.js';
import { checkParsedArticle } from './supabase.js';
import jwt from 'jsonwebtoken';

// AI parser is loaded lazily to avoid cold-start crashes when GEMINI_API_KEY is absent
let _rewriteArticleHtml = null;
let _generateTutorialSteps = null;
async function getAiFunctions() {
    if (_rewriteArticleHtml && _generateTutorialSteps) {
        return { rewriteArticleHtml: _rewriteArticleHtml, generateTutorialSteps: _generateTutorialSteps };
    }
    try {
        const mod = await import('./ai_parser.js');
        _rewriteArticleHtml = mod.rewriteArticleHtml;
        _generateTutorialSteps = mod.generateTutorialSteps;
    } catch (e) {
        logger.warn('AI parser unavailable:', e.message);
    }
    return { rewriteArticleHtml: _rewriteArticleHtml, generateTutorialSteps: _generateTutorialSteps };
}

// background_worker is loaded lazily to prevent cold-start crashes on serverless
let _enqueueParsingTask = null;
async function getEnqueue() {
    if (_enqueueParsingTask) return _enqueueParsingTask;
    try {
        const mod = await import('./background_worker.js');
        _enqueueParsingTask = mod.enqueueParsingTask;
    } catch (e) {
        // Background worker unavailable (e.g. missing API keys). Proxy still works.
    }
    return _enqueueParsingTask;
}

const require = createRequire(import.meta.url);
const swaggerDocument = require('./swagger.json');

// Validate configuration (non-blocking)
validateConfig();

const app = express();

// Enable CORS
app.use(cors({
    origin: true, // Allow all origins for now
    credentials: true
}));

// Health check endpoint
if (swaggerDocument) {
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        sessionValid: authManager.isSessionValid(),
        lastAuth: authManager.lastAuthTime
    });
});

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

// ============ DEBUG ENDPOINTS ============

// Debug Authentication Middleware
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

// Async Authentication Middleware (Upstream Proxy)
const authMiddleware = async (req, res, next) => {
    // Skip auth for preflight requests
    if (req.method === 'OPTIONS') {
        return next();
    }

    try {
        // Simple check: if memory session invalid, try one load from Firestore
        if (!authManager.isSessionValid()) {
            logger.info('In-memory session invalid, checking Firestore...');
            await authManager.loadSession();
        }

        // If STILL invalid after loading, authenticate
        if (!authManager.isSessionValid()) {
            logger.info('No valid session in Firestore, authenticating...');
            authManager.resetProgress();
            await authManager.authenticate();
            logger.info('✓ Authentication successful');
        }

        const cookieHeader = await authManager.getCookieHeader();
        if (!cookieHeader || cookieHeader.length === 0) {
            throw new Error('Authentication failed - no cookies retrieved');
        }

        req.headers['cookie'] = cookieHeader;
        req.headers['user-agent'] = config.userAgent;
        req.headers['referer'] = 'https://sites.motor.com/m1/';
        req.headers['x-requested-with'] = 'XMLHttpRequest';
        next();
    } catch (error) {
        logger.error('Auth middleware failure:', error);
        res.status(500).json({
            error: 'Authentication failed',
            message: error.message,
            status: 500
        });
    }
};

// --- MOCK SHIM REMOVED ---
// Requests to /dtcs, /tsbs, etc. will now be proxied to the upstream Motor API.
// The proxy middleware below handles the request forwarding and HTML normalization.

// --- MAKE ID RESOLUTION ---
// The upstream Motor API only accepts make *names* in the path.
// When a numeric make ID is provided, we resolve it to the name and proxy directly.
app.get('/api/year/:year/make/:make/models', authMiddleware, async (req, res, next) => {
    const { year, make } = req.params;

    // If 'make' is NOT purely numeric, it's already a name — let the proxy handle it
    if (!/^\d+$/.test(make)) {
        return next();
    }

    const makeId = parseInt(make, 10);
    logger.info(`Make ID ${makeId} detected — resolving to make name for year ${year}`);

    try {
        // 1. Fetch the makes list to resolve ID → name
        const makesUrl = `${config.motorApiBase}/api/year/${year}/makes`;
        const makesRes = await fetch(makesUrl, {
            headers: {
                'Cookie': req.headers['cookie'] || '',
                'User-Agent': req.headers['user-agent'] || config.userAgent,
                'Accept': 'application/json',
                'x-requested-with': 'XMLHttpRequest',
                'Referer': 'https://sites.motor.com/m1/'
            }
        });

        if (!makesRes.ok) {
            throw new Error(`Motor API returned ${makesRes.status} for makes list`);
        }

        const makesData = await makesRes.json();
        const makesList = makesData.body || makesData;
        // Use loose equality (==) in case makeId comes back as string from upstream
        const matched = (Array.isArray(makesList) ? makesList : []).find(m => m.makeId == makeId);

        if (!matched) {
            return res.status(404).json({
                header: { status: 'Not Found', statusCode: 404 },
                body: { error: `No make found with ID ${makeId} for year ${year}` }
            });
        }

        logger.info(`Resolved make ID ${makeId} → "${matched.makeName}"`);

        // 2. Proxy the models request directly using the resolved make name
        const modelsUrl = `${config.motorApiBase}/api/year/${year}/make/${matched.makeName}/models`;
        logger.info(`Proxying to: ${modelsUrl}`);

        const modelsRes = await fetch(modelsUrl, {
            headers: {
                'Cookie': req.headers['cookie'] || '',
                'User-Agent': req.headers['user-agent'] || config.userAgent,
                'Accept': 'application/json',
                'x-requested-with': 'XMLHttpRequest',
                'Referer': 'https://sites.motor.com/m1/',
                'Origin': 'https://sites.motor.com'
            }
        });

        const modelsData = await modelsRes.json();
        res.status(modelsRes.status).json(modelsData);

    } catch (error) {
        logger.error('Make ID resolution failed:', error);
        res.status(500).json({
            error: 'Failed to resolve make ID',
            message: error.message,
            status: 500
        });
    }
});

// Also support /api/motor/year/:year/make/:makeId/models with numeric make ID
app.get('/api/motor/year/:year/make/:make/models', authMiddleware, async (req, res, next) => {
    const { year, make } = req.params;

    if (!/^\d+$/.test(make)) {
        return next();
    }

    const makeId = parseInt(make, 10);
    logger.info(`Make ID ${makeId} detected (motor path) — resolving for year ${year}`);

    try {
        const makesUrl = `${config.motorApiBase}/api/year/${year}/makes`;
        const makesRes = await fetch(makesUrl, {
            headers: {
                'Cookie': req.headers['cookie'] || '',
                'User-Agent': req.headers['user-agent'] || config.userAgent,
                'Accept': 'application/json',
                'x-requested-with': 'XMLHttpRequest',
                'Referer': 'https://sites.motor.com/m1/'
            }
        });

        if (!makesRes.ok) {
            throw new Error(`Motor API returned ${makesRes.status} for makes list`);
        }

        const makesData = await makesRes.json();
        const makesList = makesData.body || makesData;
        const matched = (Array.isArray(makesList) ? makesList : []).find(m => m.makeId == makeId);

        if (!matched) {
            return res.status(404).json({
                header: { status: 'Not Found', statusCode: 404 },
                body: { error: `No make found with ID ${makeId} for year ${year}` }
            });
        }

        logger.info(`Resolved make ID ${makeId} → "${matched.makeName}" (motor path)`);

        const modelsUrl = `${config.motorApiBase}/api/motor/year/${year}/make/${matched.makeName}/models`;
        const modelsRes = await fetch(modelsUrl, {
            headers: {
                'Cookie': req.headers['cookie'] || '',
                'User-Agent': req.headers['user-agent'] || config.userAgent,
                'Accept': 'application/json',
                'x-requested-with': 'XMLHttpRequest',
                'Referer': 'https://sites.motor.com/m1/',
                'Origin': 'https://sites.motor.com'
            }
        });

        const modelsData = await modelsRes.json();
        res.status(modelsRes.status).json(modelsData);

    } catch (error) {
        logger.error('Make ID resolution (motor) failed:', error);
        res.status(500).json({
            error: 'Failed to resolve make ID',
            message: error.message,
            status: 500
        });
    }
});

// --- ORIENTATIONS ENDPOINT ---
// Fetches available vehicle configurations/orientations for articles that require selection
// Example: GET /api/source/Ford/vehicle/2013:Ford:Explorer/article/-999/orientations
app.get('/api/source/:source/vehicle/:vehicleId/article/:articleId/orientations', authMiddleware, async (req, res) => {
    try {
        const { source, vehicleId, articleId } = req.params;

        logger.info(`Fetching orientations for article ${articleId} in vehicle ${vehicleId}`);

        // For Motor API, orientations are typically returned as part of the articles list
        // When an article has ID -999 or requires selection, we need to fetch the related articles
        // The Motor API v2 articles endpoint includes orientation/qualifier information

        const motorApiUrl = `${config.motorApiBase}/api/source/${source}/vehicle/${encodeURIComponent(vehicleId)}/articles/v2`;

        const response = await fetch(motorApiUrl, {
            headers: {
                'Cookie': req.headers['cookie'] || '',
                'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
                'Accept': 'application/json',
                'x-requested-with': 'XMLHttpRequest'
            }
        });

        if (!response.ok) {
            throw new Error(`Motor API returned ${response.status}`);
        }

        const data = await response.json();

        // Extract orientations from the articles response
        // Articles with the same base procedure but different orientations will have related IDs
        // For now, we'll look for articles in the same bucket as the requested article

        const orientations = [];

        // The Motor API returns articles grouped by filterTabs and buckets
        // We need to find articles that represent different configurations
        if (data.body && data.body.filterTabs) {
            for (const tab of data.body.filterTabs) {
                if (tab.buckets) {
                    for (const bucket of tab.buckets) {
                        // Look for articles that might be orientation variants
                        // Typically these will be in specification or procedure buckets
                        if (bucket.articles) {
                            for (const article of bucket.articles) {
                                // Check if this article has orientation/qualifier information
                                // Motor API articles may have subtitle or description fields
                                if (article.subtitle || article.description) {
                                    orientations.push({
                                        id: article.id,
                                        displayName: article.title,
                                        qualifier: article.subtitle || article.description
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // If we didn't find any orientations in the structured way, provide a fallback
        // This happens when the Motor API doesn't expose orientation data directly
        if (orientations.length === 0) {
            // Return mock orientations for Ford Explorer as a fallback
            // In production, this should be replaced with actual Motor API data
            orientations.push(
                { id: 'P:539447705', displayName: '3.5L V6 DOHC', qualifier: '290 HP' },
                { id: 'P:539447706', displayName: '3.7L V6 Flexfuel', qualifier: '305 HP' },
                { id: 'P:539447707', displayName: '3.5L V6 EcoBoost', qualifier: '365 HP - Police Package' },
                { id: 'P:539447708', displayName: '2.0L I4 EcoBoost', qualifier: '240 HP' }
            );
        }

        res.json({
            header: {
                status: 'OK',
                statusCode: 200,
                date: new Date().toUTCString()
            },
            body: {
                orientations,
                total: orientations.length
            }
        });

    } catch (error) {
        logger.error('Error fetching orientations:', error);
        res.status(500).json({
            error: 'Failed to fetch orientations',
            message: error.message,
            status: 500
        });
    }
});

// --- CREDIT SYSTEM ENDPOINTS ---

// Verify Supabase JWT (access_token). Uses SUPABASE_JWT_SECRET from project settings.
function verifySupabaseJwt(token) {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
        logger.warn('SUPABASE_JWT_SECRET not set; cannot verify Supabase JWT');
        return null;
    }
    try {
        const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
        return decoded; // decoded.sub is the user id
    } catch (err) {
        return null;
    }
}

// Secure Auth Middleware: require Bearer token (Supabase JWT)
const secureAuthMiddleware = async (req, res, next) => {
    if (req.method === 'OPTIONS') {
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        if (req.headers['x-user-id']) {
            logger.warn('x-user-id header rejected; use Bearer token (Supabase session).');
        }
        return res.status(401).json({ error: 'Authorization header with Bearer token required' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decoded = verifySupabaseJwt(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid or expired authentication token' });
    }

    req.userId = decoded.sub; // Supabase user id
    req.user = decoded;
    req.isVerified = true;
    return next();
};

// Get User Balance & Unlocks
app.get('/api/credits/balance', secureAuthMiddleware, async (req, res) => {
    try {
        const userData = await getUserData(req.userId);
        res.json({
            credits: userData.credits || 0,
            unlocks: userData.unlocks || {}
        });
    } catch (error) {
        logger.error('Error fetching balance:', error);
        res.status(500).json({ error: 'Failed to fetch balance' });
    }
});

// Create Checkout Session
app.post('/api/credits/checkout', express.json(), secureAuthMiddleware, async (req, res) => {
    try {
        const { amount, origin } = req.body;
        const sessionUrl = await createCheckoutSession(req.userId, amount, origin || req.headers.origin);
        res.json({ url: sessionUrl });
    } catch (error) {
        logger.error('Error creating checkout session:', error);
        res.status(500).json({ error: error.message || 'Failed to create checkout session' });
    }
});

// Create Billing Portal Session (manage payment methods, invoices)
app.post('/api/credits/portal', express.json(), secureAuthMiddleware, async (req, res) => {
    try {
        const userData = await getUserData(req.userId);
        const customerId = userData.stripe_customer_id || null;
        const origin = req.body?.origin || req.headers.origin || '';
        const returnUrl = `${origin}/#/account`;
        const sessionUrl = await createBillingPortalSession(customerId, returnUrl);
        res.json({ url: sessionUrl });
    } catch (error) {
        logger.error('Error creating billing portal session:', error);
        res.status(400).json({ error: error.message || 'Unable to open billing. Make a purchase first to manage payment methods.' });
    }
});

// Unlock Module
app.post('/api/credits/unlock', express.json(), secureAuthMiddleware, async (req, res) => {
    try {
        const { vehicleId, vehicleName, moduleType, cost } = req.body;
        const userData = await unlockModule(req.userId, vehicleId, vehicleName || vehicleId, moduleType, cost);
        res.json({
            success: true,
            credits: userData.credits,
            unlocks: userData.unlocks
        });
    } catch (error) {
        logger.error('Error unlocking module:', error);
        res.status(400).json({ error: error.message });
    }
});

// Get Transaction History
app.get('/api/credits/transactions', secureAuthMiddleware, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const txns = await getTransactions(req.userId, limit);
        res.json({ transactions: txns });
    } catch (error) {
        logger.error('Error fetching transactions:', error);
        res.status(500).json({ error: 'Failed to fetch transaction history' });
    }
});

// Stripe Webhook (No auth middleware, validates signature)
// Using express.raw to preserve the raw body for signature verification
app.post('/api/credits/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// --- AI ENDPOINTS ---

// POST /api/rewrite — rewrites article HTML text content via Gemini
// Body: { html: string, title?: string }
// Returns: { html: string } or error
app.post('/api/rewrite', express.json({ limit: '256kb' }), async (req, res) => {
    const { html, title } = req.body || {};
    if (!html || typeof html !== 'string') {
        return res.status(400).json({ error: 'html field is required' });
    }

    const { rewriteArticleHtml } = await getAiFunctions();
    if (!rewriteArticleHtml) {
        return res.status(503).json({ error: 'AI rewriting unavailable — GEMINI_API_KEY not configured' });
    }

    try {
        const rewritten = await rewriteArticleHtml(html, title || '');
        res.json({ html: rewritten });
    } catch (err) {
        logger.error('AI rewrite error:', err);
        res.status(500).json({ error: 'AI rewrite failed', message: err.message });
    }
});

// POST /api/tutorials/generate — generates tutorial steps from article HTML via Gemini
// Body: { html: string, title?: string }
// Returns: { steps: TutorialStep[] } or error
app.post('/api/tutorials/generate', express.json({ limit: '256kb' }), async (req, res) => {
    const { html, title } = req.body || {};
    if (!html || typeof html !== 'string') {
        return res.status(400).json({ error: 'html field is required' });
    }

    const { generateTutorialSteps } = await getAiFunctions();
    if (!generateTutorialSteps) {
        return res.status(503).json({ error: 'AI tutorial generation unavailable — GEMINI_API_KEY not configured' });
    }

    try {
        const steps = await generateTutorialSteps(html, title || '');
        res.json({ steps });
    } catch (err) {
        logger.error('AI tutorial generation error:', err);
        res.status(500).json({ error: 'Tutorial generation failed', message: err.message });
    }
});


// Mount at root '/' to handle ALL requests (api, graphic, assets, v1, etc.)
app.use('/', authMiddleware, createProxyMiddleware({
    target: config.motorApiBase, // https://sites.motor.com/m1
    changeOrigin: true,
    selfHandleResponse: true, // Allow us to intercept and modify responses
    pathRewrite: function (path, req) {
        // Explicit rewrites for Chek-Chart legacy paths to /api
        if (path.includes('/Information/Chek-Chart/Years') && path.includes('/Makes') && path.includes('/Models')) {
            return path.replace('/v1/Information/Chek-Chart/Years', '/api/year').replace('/Makes', '/make').replace('/Models', '/models');
        }
        if (path.includes('/Information/Chek-Chart/Years') && path.includes('/Makes')) {
            return path.replace('/v1/Information/Chek-Chart/Years', '/api/year').replace('/Makes', '/makes');
        }
        if (path.includes('/Information/Chek-Chart/Years')) {
            return path.replace('/v1/Information/Chek-Chart/Years', '/api/years');
        }

        // Generic cleanup: Strip /v1 prefix if present
        return path.replace(/^\/v1/, '');
    },
    onProxyReq: (proxyReq, req, res) => {
        try {
            // Log the request
            logRequest(req, { route: req.path, sessionValid: authManager.isSessionValid() });

            // Force identity encoding to avoid GZIP issues in interceptor
            proxyReq.removeHeader('accept-encoding');

            // Get cookies from request headers (set by authMiddleware)
            const cookieHeader = req.headers['cookie'];
            if (cookieHeader) {
                proxyReq.setHeader('Cookie', cookieHeader);
            } else {
                logger.warn('No cookie header available!');
            }

            // Set required headers for connector
            proxyReq.setHeader('Origin', 'https://sites.motor.com');
            proxyReq.setHeader('Referer', 'https://sites.motor.com/m1/');
            proxyReq.setHeader('User-Agent', config.userAgent);
            proxyReq.setHeader('X-Requested-With', 'XMLHttpRequest');

            logger.info(`→ ${req.method} ${req.path} → ${config.motorApiBase}${req.path.replace(/^\/v1/, '')}`);
        } catch (error) {
            logger.error('Error setting proxy request headers:', error);
        }
    },
    onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        // STRICTLY override CORS to hide upstream source
        const requestOrigin = req.headers['origin'];
        if (requestOrigin) {
            res.setHeader('access-control-allow-origin', requestOrigin);
            res.setHeader('access-control-allow-credentials', 'true');
        } else {
            res.setHeader('access-control-allow-origin', '*');
        }

        // STRIP upstream headers that might reveal the source or leak data
        res.removeHeader('set-cookie'); // Frontend doesn't need Motor cookies
        res.removeHeader('server');     // Hide upstream server info
        res.removeHeader('x-powered-by');

        // Cache static data for 24 hours
        if (req.path.includes('/years') || req.path.includes('/makes')) {
            res.setHeader('cache-control', 'public, max-age=86400');
        }

        // Handle 401/403 by sending custom response that triggers client polling
        if (proxyRes.statusCode === 401 || proxyRes.statusCode === 403) {
            logger.warn(`Received ${proxyRes.statusCode} from Motor.com. Session expired. Invalidating session and starting authentication...`);

            // Invalidate session and start authentication
            authManager.lastAuthTime = 0;
            authManager.cookies = [];
            authManager.resetProgress();

            // Start authentication in background
            authManager.authenticate().catch(err => {
                logger.error('Background authentication failed:', err);
            });

            // Send custom response telling client to poll auth status
            const responseBody = JSON.stringify({
                error: 'Authentication required',
                message: 'Session expired. Authentication in progress.',
                status: 401,
                authStatus: 'authenticating',
                authStatusUrl: '/auth/status',
                retryAfter: 2,
                pollInterval: 500 // milliseconds
            });

            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('x-auth-status', 'authenticating');
            res.setHeader('x-auth-status-url', '/auth/status');
            res.setHeader('x-retry-after', '2');

            logger.info(`← 401 ${req.path} (custom response - auth in progress)`);
            return responseBody;
        }

        // Check if we have a buffer to process
        if (!responseBuffer || responseBuffer.length === 0) {
            logger.info(`← ${proxyRes.statusCode} ${req.path} (empty body)`);
            return responseBuffer;
        }

        // Check content type to determine if this is binary data
        const contentType = proxyRes.headers['content-type'] || '';
        const isBinary = contentType.includes('image/') ||
            contentType.includes('application/octet-stream') ||
            contentType.includes('application/pdf') ||
            contentType.includes('video/') ||
            contentType.includes('audio/');

        // For binary content, pass through as-is without conversion
        if (isBinary) {
            logger.info(`← ${proxyRes.statusCode} ${req.path} (binary: ${contentType}, ${responseBuffer.length} bytes)`);
            return responseBuffer;
        }

        try {
            // Log the response
            const responseData = responseBuffer.toString('utf8');

            // Normalize HTML content ONLY if explicitly HTML
            // Avoid string searches on JSON which might contain HTML markers in values
            let normalizedData = responseData;

            if (contentType.includes('text/html')) {
                // HTML is inherently whitespace-agnostic; skip costly regex cleanup to improve performance.
                logger.info('Skipping HTML whitespace normalization for performance');
            } else if (contentType.includes('application/json')) {
                // =============== IOS / SERVERLESS CRASH PROTECTION ===============
                // Massive arrays (like 5,000+ items) will crash iOS Safari due to massive
                // Javascript Array heap allocations upon JSON.parse.
                // We truncate any deeply nested array to 500 items max at the Proxy level.
                //
                // EXCEPTION: /articles/v2 is the master article CATALOG endpoint. It returns
                // lightweight metadata (id, title, bucket) for ALL article types (DTCs, TSBs,
                // Procedures, etc.). Truncating this array breaks section filtering because
                // DTCs/TSBs may appear past index 500. Since each item is ~200 bytes,
                // even 5000 items is only ~1MB — safe for iOS.
                const isArticleCatalog = req.path.includes('/articles/v2');

                if (!isArticleCatalog && normalizedData && normalizedData.length >= 1000) {
                    // Fast heuristic to avoid JSON.parse entirely if there's no possibility of a 500-element array.
                    // Does the string contain 500 commas?
                    let commaCount = 0;
                    let idx = normalizedData.indexOf(',');
                    while (idx !== -1) {
                        commaCount++;
                        if (commaCount >= 500) break;
                        idx = normalizedData.indexOf(',', idx + 1);
                    }

                    if (commaCount >= 500) {
                        try {
                            let parsedJson = JSON.parse(normalizedData);
                            let didTruncate = false;

                            const truncateArrays = (obj) => {
                                if (!obj || typeof obj !== 'object') return;
                                if (Array.isArray(obj)) {
                                    if (obj.length > 500) {
                                        obj.length = 500;
                                        didTruncate = true;
                                    }
                                    for (let i = 0; i < obj.length; i++) {
                                        const child = obj[i];
                                        if (child && typeof child === 'object') {
                                            truncateArrays(child);
                                        }
                                    }
                                } else {
                                    for (const key in obj) {
                                        if (Object.prototype.hasOwnProperty.call(obj, key)) {
                                            const child = obj[key];
                                            if (child && typeof child === 'object') {
                                                truncateArrays(child);
                                            }
                                        }
                                    }
                                }
                            };

                            truncateArrays(parsedJson);

                            if (didTruncate) {
                                normalizedData = JSON.stringify(parsedJson);
                                logger.info(`Truncated massive JSON arrays to prevent iOS/Vercel OOM crashes on ${req.path}`);
                            }
                        } catch (e) {
                            logger.warn('Failed to parse or truncate JSON for performance protections:', e);
                        }
                    }
                }
                // =================================================================

                // Enqueue for background AI parsing and caching to Supabase
                // Done via lazy dynamic import to prevent cold-start crashes on serverless
                getEnqueue().then(enqueue => {
                    if (enqueue) {
                        try {
                            enqueue(req.path, responseBuffer);
                        } catch (qErr) {
                            logger.error('Failed to enqueue background parsing task:', qErr);
                        }
                    }
                }).catch(() => { /* silently ignore if worker unavailable */ });
            }

            logResponse(req, res, normalizedData, proxyRes.statusCode >= 400 ? new Error(`HTTP ${proxyRes.statusCode}`) : null);

            logger.info(`← ${proxyRes.statusCode} ${req.path}`);
            return Buffer.from(normalizedData, 'utf8');
        } catch (processError) {
            logger.error('Error processing proxy response:', processError);
            return responseBuffer; // Fallback to raw buffer
        }
    }),
    onError: (err, req, res) => {
        logger.error('Proxy error:', err);
        if (!res.headersSent) {
            res.status(500).send('Proxy Error');
        }
    }
}));


export { app };
export default app;
