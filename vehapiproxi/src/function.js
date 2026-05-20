import './runtime_polyfills.js';
import express from 'express';
import cors from 'cors';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { config, validateConfig } from './config.js';
import { authManager } from './auth.js';
import logger, { logBuffer, logRequest, logResponse } from './logger.js';
import swaggerUi from 'swagger-ui-express';
import { createRequire } from 'module';
import { createCheckoutSession, createBillingPortalSession, handleWebhook, verifyAndFulfillSession } from './stripe.js';
import { getUserData, unlockModule, getTransactions } from './credits.js';
import { mapChunksToL2ApiResponse, runL2VehicleChunkSearch } from './l2_retrieval.js';
import { 
    insertParsedData, 
    checkParsedArticle,
    checkArticleContent,
    getArticleMetadata,
    upsertMediaAssetGraphicBinary,
    insertMetadata, 
    getMetadata,
    isMetadataStale,
    getVehicleArticles,
    getVehicleArticlesCount,
    getVehicleIsNormalized
} from './db.service.js';
import jwt from 'jsonwebtoken';
import admin from 'firebase-admin';
import { registerHealthEndpoint } from './routes/health.js';
import { registerAuthEndpoints } from './routes/auth.js';
import { registerChekChartYmmeRoutes } from './routes/chek-chart-ymme.js';
import { registerIngestEndpoint } from './routes/ingest.js';
import { registerCreditsEndpoints } from './routes/credits-endpoints.js';
import { registerAiEndpoints } from './routes/ai-endpoints.js';
import { registerDebugEndpoints } from './routes/debug.js';
import tutorialRouter from './routes/tutorial.js';
import dataApiRouter from './routes/data-api.js';
import dbEndpointsRouter from './routes/db-endpoints.js';
import { registerMakeIdResolutionEndpoints } from './routes/make-id-resolution.js';
import { registerOrientationEndpoints } from './routes/orientations.js';
import { registerArticleMetadataEndpoint } from './routes/article-metadata.js';
import {
    registerMotorInformationFluidsIntercept,
    registerMotorInformationYmmeRoutes
} from './routes/motor-information.js';
import { createArticleContentRateLimiter, articleContentRateLimitGate } from './rate_limit.js';
import {
    checkArticleAccess,
    inferModuleTypeFromArticleId,
    resolveModuleTypeFromCatalogMetadata
} from './article-access.js';
import { normalizeMotorResponse, buildMenuFromNormalizedArticles } from './menu-normalizer.js';
// AI parser is loaded lazily to avoid cold-start crashes when no Nemotron API key (NVIDIA_API_KEY / LLM_API_KEY)
let _rewriteArticleHtml = null;
let _generateTutorialSteps = null;
let _generateCommonIssues = null;
async function getAiFunctions() {
    if (_rewriteArticleHtml && _generateTutorialSteps && _generateCommonIssues) {
        return {
            rewriteArticleHtml: _rewriteArticleHtml,
            generateTutorialSteps: _generateTutorialSteps,
            generateCommonIssues: _generateCommonIssues
        };
    }
    try {
        const mod = await import('./ai_parser.js');
        _rewriteArticleHtml = mod.rewriteArticleHtml;
        _generateTutorialSteps = mod.generateTutorialSteps;
        _generateCommonIssues = mod.generateCommonIssues;
    } catch (e) {
        logger.error('AI parser unavailable (dynamic import failed):', { message: e?.message, stack: e?.stack });
    }
    return {
        rewriteArticleHtml: _rewriteArticleHtml,
        generateTutorialSteps: _generateTutorialSteps,
        generateCommonIssues: _generateCommonIssues
    };
}

// background_worker is loaded lazily to prevent cold-start crashes on serverless
let _enqueueParsingTask = null;
async function getEnqueue() {
    if (_enqueueParsingTask) return _enqueueParsingTask;
    try {
        const mod = await import('./background_worker.js');
        _enqueueParsingTask = mod.enqueueParsingTask;
        logger.info('Background worker loaded for async parsing.');
    } catch (e) {
        // Background worker unavailable (e.g. missing API keys). Proxy still works.
        logger.warn(`Background worker unavailable: ${e?.message || e}`);
    }
    return _enqueueParsingTask;
}

/** Motor article HTML is `text/html` — must enqueue here; JSON-only enqueue would skip procedures/evidence for /article/.../html. */
function enqueueBackgroundParse(req, responseBuffer) {
    getEnqueue()
        .then((enqueue) => {
            if (enqueue) {
                try {
                    logger.info(
                        `Queueing background parse for ${req.path}${isVerifyBypass(req) ? ' [verify force-reparse]' : ''}`
                    );
                    enqueue(req.path, responseBuffer, { forceReparse: isVerifyBypass(req) });
                } catch (qErr) {
                    logger.error('Failed to enqueue background parsing task:', qErr);
                }
            }
        })
        .catch(() => {
            /* worker unavailable */
        });
}

function persistGraphicAsset(req, responseBuffer, contentType) {
    const sourceGraphicMatch = req.path.match(/\/api\/source\/([^/]+)\/graphic\/([^/?]+)/i);
    if (!sourceGraphicMatch || !responseBuffer || responseBuffer.length === 0) {
        return;
    }

    const [, contentSource, motorGraphicId] = sourceGraphicMatch;
    Promise.resolve(
        upsertMediaAssetGraphicBinary({
            vehicleExternalId: null,
            contentSource,
            motorGraphicId,
            binaryBuffer: responseBuffer,
            mimeType: String(contentType || ''),
            sourceLabel: 'graphic_api',
            metadataJson: {
                path: req.path
            }
        })
    ).catch((err) => {
        logger.warn('Failed to persist graphic media_asset:', err?.message || err);
    });
}

const require = createRequire(import.meta.url);
const swaggerDocument = require('./swagger.json');

// Validate configuration (non-blocking)
validateConfig();

// Firebase Admin — uses Application Default Credentials on Cloud Run; no explicit init needed.
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: (process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '').trim() || undefined,
    });
}

const app = express();
app.set('trust proxy', 1);

/** Correlation id for logs (preserve `x-request-id` / `x-correlation-id` when present). */
app.use((req, res, next) => {
    const incoming = req.get('x-request-id') || req.get('x-correlation-id');
    req.correlationId = incoming || randomUUID();
    if (!req.requestId) req.requestId = req.correlationId;
    next();
});

/** When `x-vehapi-verify: 1`, skip Supabase-first caches so requests hit Motor and enqueue background parsing (verify script only). */
function isVerifyBypass(req) {
    return String(req.get('x-vehapi-verify') || '').trim() === '1';
}

// Enable CORS
// Use explicit origin reflection for credentialed requests and avoid wildcard
// fallback in any cross-origin browser response.
function normalizeOriginHeader(origin) {
    if (origin == null) return '';
    const v = Array.isArray(origin) ? origin[0] : origin;
    return typeof v === 'string' ? v.trim() : '';
}

/** Localhost dev origins — only allowed outside Cloud Run/production. */
function shouldAllowLocalhostOrigins() {
    if (process.env.GOOGLE_CLOUD_RUN === '1') return false;
    if (process.env.NODE_ENV === 'production') return false;
    return true;
}

function buildAllowedOrigins() {
    const origins = new Set([
        'https://vehapi-torque.web.app',
        'https://vehapi-torque.firebaseapp.com',
        'https://ferox-torque.web.app',
        'https://ferox-torque.firebaseapp.com',
        'https://vehapi-torque-proxy.web.app',
    ]);
    if (shouldAllowLocalhostOrigins()) {
        origins.add('http://localhost:3000');
        origins.add('http://127.0.0.1:3000');
    }
    const extra = process.env.CORS_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS;
    if (extra) {
        for (const part of extra.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)) {
            origins.add(part);
        }
    }
    return origins;
}

const allowedOrigins = buildAllowedOrigins();

function isOriginAllowed(origin) {
    const o = normalizeOriginHeader(origin);
    return Boolean(o && allowedOrigins.has(o));
}

const corsOptionsDelegate = (req, callback) => {
    const requestOrigin = normalizeOriginHeader(req.headers.origin);
    let corsOptions;

    if (!requestOrigin) {
        // Non-browser/server-to-server calls: no CORS headers needed.
        corsOptions = { origin: false, credentials: true };
    } else if (isOriginAllowed(requestOrigin)) {
        corsOptions = { origin: requestOrigin, credentials: true };
    } else {
        corsOptions = { origin: false, credentials: true };
    }

    callback(null, corsOptions);
};

app.use(cors(corsOptionsDelegate));
app.options('*', cors(corsOptionsDelegate));

// Health check endpoint
if (swaggerDocument) {
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}
registerHealthEndpoint(app, authManager);
registerAuthEndpoints(app, authManager, logger);
registerDebugEndpoints(app, { config, authManager, logger, logBuffer });

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

// --- MAKE ID RESOLUTION + ORIENTATIONS ---
registerMakeIdResolutionEndpoints(app, authMiddleware, config, logger);
registerOrientationEndpoints(app, authMiddleware, config, logger);

// --- CREDIT SYSTEM ENDPOINTS ---

// Verify Firebase ID token using firebase-admin.
// On Cloud Run, Application Default Credentials (ADC) are used automatically.
async function verifyFirebaseToken(token) {
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        return { sub: decoded.uid, email: decoded.email ?? null };
    } catch (err) {
        logger.warn('Firebase token verification failed: ' + err.message);
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
            logger.warn('x-user-id header rejected; use Bearer token (Firebase ID token).');
        }
        return res.status(401).json({ error: 'Authorization header with Bearer token required' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decoded = await verifyFirebaseToken(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid or expired authentication token' });
    }

    req.userId = decoded.sub; // Firebase UID
    req.user = decoded;
    req.isVerified = true;

    return next();
};

// --- PUBLIC CONFIG ENDPOINT (no auth required) ---
app.get('/api/app-config', (_req, res) => {
    res.json({ demoMode: config.demoMode });
});

// --- CREDIT SYSTEM ENDPOINTS ---
registerCreditsEndpoints(app, secureAuthMiddleware);

// L2 RAG — vector search over content_chunk (requires DB RPC + embeddings; service role only for RPC)
const l2SearchJson = express.json({ limit: '24kb' });

async function handleL2VehicleSearch(req, res, vehicleExternalId) {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    const matchCount = Math.min(24, Math.max(1, parseInt(req.body?.matchCount ?? '8', 10)));
    if (!vehicleExternalId || !query) {
        return res.status(400).json({ error: 'vehicle id and query are required' });
    }

    const l2Enabled = String(process.env.ENABLE_L2_EMBEDDINGS || '').toLowerCase() === 'true';
    if (!l2Enabled) {
        return res.status(503).json({
            error: 'Knowledge search is not enabled on the server (ENABLE_L2_EMBEDDINGS=false)',
            code: 'L2_DISABLED'
        });
    }

    const userData = await getUserData(req.userId);
    const unlocks = userData.unlocks?.[vehicleExternalId] || [];
    const allowed = unlocks.includes('full') || unlocks.length > 0;
    if (!allowed) {
        return res.status(403).json({
            error: 'Unlock at least one module for this vehicle before using search',
            code: 'L2_UNLOCK_REQUIRED'
        });
    }
    const result = await runL2VehicleChunkSearch({ vehicleExternalId, query, matchCount });
    if (!result.success) {
        const msg = result.error || 'L2 search unavailable';
        let code = 'L2_SEARCH_FAILED';
        if (/dimension|L2_EMBEDDING_DIMS/i.test(msg)) {
            code = 'L2_EMBEDDING_DIM_MISMATCH';
        } else if (/No NVIDIA|EMBEDDING_MODEL|API key|embeddings/i.test(msg)) {
            code = 'L2_EMBEDDING_CONFIG';
        } else if (/RPC|Supabase|match_content_chunks|42883|function public\.match_content_chunks/i.test(msg)) {
            code = 'L2_RPC_OR_SCHEMA';
        }
        return res.status(503).json({ error: msg, code });
    }

    const rows = result.chunks || [];
    if (rows.length === 0) {
        // Distinct from service outage: search ran; this vehicle has no rows in content_chunk yet.
        return res.status(200).json({
            chunks: [],
            code: 'L2_NO_CHUNKS',
            hint: 'No vector chunks are indexed for this vehicle. Run the worker with ENABLE_L2_EMBEDDINGS=true (and EMBEDDING_MODEL) after articles are parsed, or ingest may still be in progress.'
        });
    }

    return res.json({ chunks: mapChunksToL2ApiResponse(rows) });
}

/** Preferred: vehicle id in path (matches other vehicle-scoped APIs). */
app.post(
    '/api/vehicle/:vehicleId/l2/search',
    l2SearchJson,
    secureAuthMiddleware,
    async (req, res) => {
        try {
            const vehicleExternalId = decodeURIComponent(req.params.vehicleId || '').trim();
            return await handleL2VehicleSearch(req, res, vehicleExternalId);
        } catch (e) {
            logger.error('L2 search failed', { message: e?.message, stack: e?.stack });
            return res.status(500).json({ error: 'L2 search failed' });
        }
    }
);

/** Legacy: vehicle id in body (curl / older clients). */
app.post('/api/l2/search', l2SearchJson, secureAuthMiddleware, async (req, res) => {
    try {
        const vehicleExternalId =
            typeof req.body?.vehicleExternalId === 'string' ? req.body.vehicleExternalId.trim() : '';
        return await handleL2VehicleSearch(req, res, vehicleExternalId);
    } catch (e) {
        logger.error('L2 search failed', { message: e?.message, stack: e?.stack });
        return res.status(500).json({ error: 'L2 search failed' });
    }
});

// Article metadata (bucket, moduleType) for frontend access resolution when moduleType is missing
registerArticleMetadataEndpoint(app, secureAuthMiddleware, logger);

// --- AI ENDPOINTS ---
registerAiEndpoints(app, getAiFunctions);

// Tutorial chatbot — POST /api/ai/vehicle/:vehicleId/tutorial (requires Firebase auth)
app.use('/api/ai', secureAuthMiddleware, tutorialRouter);

// Cloud SQL-backed read endpoints (YMME + article catalog from our DB)
app.use('/api/db', dbEndpointsRouter);

// Data API — GET /api/data/:table (public reads), POST /api/data/:table (auth required)
app.use('/api/data', express.json({ limit: '2mb' }), (req, res, next) => {
    // Only POST/PUT/PATCH require auth; GET is public (vehicle data is not user-private)
    if (req.method === 'GET') return next();
    return secureAuthMiddleware(req, res, next);
}, dataApiRouter);

// Motor Information API — YMME helpers (base vehicle id, engines); requires Supabase JWT
registerMotorInformationYmmeRoutes(app, secureAuthMiddleware, logger);

/** In-memory observability for Motor catch-all vs Cloud SQL cache hits. */
const proxyStats = { motorHits: 0, dbHits: 0 };

/** Short-lived cache for vehicle normalization eligibility. */
const vehicleCatalogCache = new Map();
const VEHICLE_CATALOG_CACHE_TTL_MS = 60_000;

function getCachedCatalogEligibility(vehicleId) {
    const entry = vehicleCatalogCache.get(vehicleId);
    if (entry && Date.now() < entry.expiry) return entry;
    return null;
}

function setCachedCatalogEligibility(vehicleId, count, isNormalized) {
    vehicleCatalogCache.set(vehicleId, { count, isNormalized, expiry: Date.now() + VEHICLE_CATALOG_CACHE_TTL_MS });
    if (vehicleCatalogCache.size > 500) {
        const first = vehicleCatalogCache.keys().next().value;
        vehicleCatalogCache.delete(first);
    }
}

/**
 * Paths that may legitimately flow through the catch-all to Motor (ingest, non-normalized, assets).
 * Not used for blocking — documentation + optional logging context.
 */
const MOTOR_PROXY_ALLOWLIST = [
    /^\/api\/source\/[^/]+\/graphic\//,
    /^\/api\/source\/[^/]+\/vehicle\/[^/]+\/graphic\//,
    /^\/api\/assets\//,
    /^\/v1\/assets\//,
    /^\/auth\/status$/,
    /^\/api\/years$/,
    /^\/api\/year\//,
    /^\/api\/motor\//,
    /^\/api\/source\//,
    /^\/debug\//,
    /^\/health$/,
    /^\/api\/health$/
];

function isMotorProxyAllowlisted(path) {
    return MOTOR_PROXY_ALLOWLIST.some((regex) => regex.test(path));
}

function recordProxyStat(kind) {
    if (kind === 'motor') {
        proxyStats.motorHits++;
    } else {
        proxyStats.dbHits++;
    }
    const total = proxyStats.motorHits + proxyStats.dbHits;
    if (total % 100 === 0 && total > 0) {
        logger.info('[ProxyStats]', proxyStats);
    }
}

/** In-memory YMME metadata cache — avoids repeated DB round-trips for stable paths. */
const metadataMemCache = new Map();
const METADATA_MEM_CACHE_TTL_MS = 300_000;

function getMetadataFromMemCache(path) {
    const entry = metadataMemCache.get(path);
    if (entry && Date.now() < entry.expiry) return entry.data;
    return null;
}

function setMetadataMemCache(path, data) {
    metadataMemCache.set(path, { data, expiry: Date.now() + METADATA_MEM_CACHE_TTL_MS });
    if (metadataMemCache.size > 200) {
        const first = metadataMemCache.keys().next().value;
        metadataMemCache.delete(first);
    }
}

/** In-memory article content — avoids repeated DB lookups for hot articles (back button, multiple users). */
const articleContentMemCache = new Map();
const ARTICLE_CONTENT_MEM_CACHE_TTL_MS = 120_000;

function getArticleContentFromMemCache(vehicleId, articleId) {
    const key = `${vehicleId}:${articleId}`;
    const entry = articleContentMemCache.get(key);
    if (entry && Date.now() < entry.expiry) return entry.payload;
    return null;
}

function setArticleContentMemCache(vehicleId, articleId, payload) {
    const key = `${vehicleId}:${articleId}`;
    articleContentMemCache.set(key, { payload, expiry: Date.now() + ARTICLE_CONTENT_MEM_CACHE_TTL_MS });
    if (articleContentMemCache.size > 300) {
        const first = articleContentMemCache.keys().next().value;
        articleContentMemCache.delete(first);
    }
}

/** YMME metadata cache TTL (days). Cached rows older than this still return immediately; a background Motor refresh is queued. */
const METADATA_STALENESS_DAYS = (() => {
    const v = parseInt(process.env.METADATA_STALENESS_DAYS ?? '90', 10);
    return Number.isFinite(v) && v > 0 ? v : 90;
})();

function queueMetadataBackgroundRefresh(cachePath) {
    const port = config.proxyPort;
    const url = `http://127.0.0.1:${port}/api${cachePath.startsWith('/') ? cachePath : `/${cachePath}`}`;
    fetch(url, {
        headers: {
            'x-metadata-refresh-bypass': '1',
            'x-requested-with': 'XMLHttpRequest'
        }
    }).catch((err) => {
        logger.warn(`Background metadata refresh failed for ${cachePath}: ${err?.message || err}`);
    });
}

// Metadata Cache-First Middleware
const metadataCacheMiddleware = async (req, res, next) => {
    const path = req.path;
    if (String(req.get('x-metadata-refresh-bypass') || '').trim() === '1') {
        return next();
    }

    const isMetadata = path.includes('/years') || path.includes('/makes') || path.includes('/models') || path.includes('/engines');
    
    if (isMetadata && req.method === 'GET') {
        const memHit = getMetadataFromMemCache(path);
        if (memHit) {
            recordProxyStat('db');
            res.setHeader('x-data-source', 'memory');
            res.setHeader('x-cache-hit', 'true');
            return res.json(memHit);
        }
        try {
            const cachedRow = await getMetadata(path);
            if (cachedRow && cachedRow.data != null) {
                const stale = isMetadataStale(cachedRow, METADATA_STALENESS_DAYS);
                logger.info(`Serving metadata from cache: ${path}${stale ? ' (stale — background refresh queued)' : ''}`);
                recordProxyStat('db');
                setMetadataMemCache(path, cachedRow.data);
                res.setHeader('x-data-source', 'cloudsql');
                res.setHeader('x-cache-hit', 'true');
                if (stale) {
                    res.setHeader('x-data-stale', 'true');
                    queueMetadataBackgroundRefresh(path);
                }
                return res.json(cachedRow.data);
            }
        } catch (err) {
            logger.warn(`Failed to fetch metadata from cache for ${path}:`, err.message);
        }
    }
    next();
};

// Articles Cache-First Middleware
const articlesCacheMiddleware = async (req, res, next) => {
    const path = req.path;
    // Example: /api/source/Ford/vehicle/2013:Ford:Explorer/articles/v2
    const isArticlesCatalog = path.includes('/articles/v2');
    
    if (isArticlesCatalog && req.method === 'GET') {
        const skipSbCache =
            req.query.torqueCatalogSync === '1' ||
            req.query.torqueCatalogSync === 'true' ||
            String(req.headers['x-torque-catalog-sync'] || '').trim() === '1';
        if (skipSbCache) {
            return next();
        }

        try {
            // Extract vehicleId from path
            const pathParts = path.split('/');
            const vehicleIdx = pathParts.indexOf('vehicle');
            if (vehicleIdx !== -1 && pathParts.length > vehicleIdx + 1) {
                const vehicleId = decodeURIComponent(pathParts[vehicleIdx + 1]);

                let count, isNormalized;
                const cached = getCachedCatalogEligibility(vehicleId);
                if (cached) {
                    count = cached.count;
                    isNormalized = cached.isNormalized;
                } else {
                    [count, isNormalized] = await Promise.all([
                        getVehicleArticlesCount(vehicleId),
                        getVehicleIsNormalized(vehicleId)
                    ]);
                    setCachedCatalogEligibility(vehicleId, count, isNormalized);
                }

                const minRows = parseInt(process.env.ARTICLE_CATALOG_MIN_ROWS ?? '10', 10);
                const serveFromCloudSql =
                    isNormalized === true &&
                    count >= minRows;

                if (!serveFromCloudSql) {
                    if (count > 0 || isNormalized != null) {
                        logger.info(
                            `Articles cache bypass for ${vehicleId}: count=${count}, is_normalized=${isNormalized} (need both normalized flag and count>=${minRows})`
                        );
                    }
                    return next();
                }

                logger.info(`✓ Serving ${count} cached articles for ${vehicleId} from Cloud SQL (normalized catalog).`);
                const articles = await getVehicleArticles(vehicleId);
                    
                if (articles && articles.length > 0) {
                        // We need to transform these Cloud SQL rows back into the shape Motor API returns
                        // or at least what our normalizeMotorResponse expects.
                        const articleDetails = articles.map(a => ({
                            id: a.original_id,
                            title: a.title,
                            subtitle: a.subtitle,
                            code: a.code || undefined,
                            description: a.description || undefined,
                            bucket: a.bucket,
                            parentBucket: a.parent_bucket,
                            thumbnailHref: a.thumbnail_href,
                            bulletinNumber: a.bulletin_number || undefined,
                            releaseDate: a.release_date || undefined,
                            sort: a.sort,
                            contentSource: a.content_source || 'MOTOR'
                        }));
                        const motorShape = {
                            header: { status: 'OK', statusCode: 200 },
                            body: {
                                articleDetails,
                                filterTabs: [],
                                normalizedMenu: buildMenuFromNormalizedArticles(articles)
                            }
                        };
                        
                        recordProxyStat('db');
                        res.setHeader('x-data-source', 'cloudsql');
                        res.setHeader('x-cache-hit', 'true');
                        return res.json(motorShape);
                }
            }
        } catch (err) {
            logger.warn(`Failed to fetch articles from cache for ${path}:`, err.message);
        }
    }
    next();
};

// Article Access Enforcement: require auth + unlock for article content
const articleAccessMiddleware = async (req, res, next) => {
    const path = req.path;
    // IMPORTANT:
    // This middleware is mounted at `app.use('/api', ...)`, so inside here `req.path`
    // is relative to that mount (it starts with `/source/...`, not `/api/source/...`).
    // If we incorrectly expect `/api/source/...`, unauthenticated requests can slip
    // through and reach the article cache middleware.
    const articleContentMatch = path.match(/^\/source\/[^/]+\/vehicle\/([^/]+)\/article\/([^/]+)(?:\/html)?$/);
    if (!articleContentMatch || req.method !== 'GET') {
        return next();
    }

    const vehicleId = decodeURIComponent(articleContentMatch[1]);
    let articleId = articleContentMatch[2];
    try {
        articleId = decodeURIComponent(articleId);
    } catch {
        /* use raw segment */
    }

    const skipFlag = String(process.env.SKIP_ARTICLE_ACCESS_AUTH || '')
        .trim()
        .toLowerCase();
    const skipArticleAuth =
        ['true', '1', 'yes'].includes(skipFlag) && process.env.NODE_ENV !== 'production';

    if (['true', '1', 'yes'].includes(skipFlag) && process.env.NODE_ENV === 'production') {
        logger.warn(
            '[DEV] SKIP_ARTICLE_ACCESS_AUTH is set but NODE_ENV=production — article auth not skipped. ' +
                'Unset NODE_ENV or set NODE_ENV=development in vehapiproxi/.env (see .env.example).'
        );
    }

    if (skipArticleAuth) {
        logger.warn(
            `[DEV] SKIP_ARTICLE_ACCESS_AUTH: bypassing article JWT/unlock for ${vehicleId}/${articleId} (never set in production)`
        );
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization required to access article content' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decoded = await verifyFirebaseToken(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid or expired authentication token' });
    }

    const userId = decoded.sub;
    // Always read fresh unlocks from Supabase: in-memory cache is per-instance and stale after
    // unlock/purchase on another serverless worker (common on Vercel).
    const userData = await getUserData(userId, { skipCache: true });
    const unlocks = userData.unlocks || {};
    const vehicleUnlocks = unlocks[vehicleId] || [];

    const metadata = await getArticleMetadata(vehicleId, articleId);
    let moduleType = metadata ? resolveModuleTypeFromCatalogMetadata(metadata) : null;
    if (!moduleType) {
        moduleType = inferModuleTypeFromArticleId(articleId);
    }
    const { allowed } = checkArticleAccess(vehicleUnlocks, articleId, moduleType);

    if (allowed) {
        return next();
    }

    if (!moduleType) {
        logger.warn(`Article ${articleId} (vehicle ${vehicleId}): no bucket metadata in Cloud SQL; denying category-level access`);
        return res.status(403).json({ error: 'Article access cannot be verified' });
    }

    logger.info(`Article access denied: user ${userId} lacks ${moduleType} for vehicle ${vehicleId}`);
    return res.status(403).json({
        error: 'Module not unlocked for this vehicle',
        moduleType
    });
};

app.use('/api', articleContentRateLimitGate(createArticleContentRateLimiter()));
app.use('/api', articleAccessMiddleware);
app.use('/api', metadataCacheMiddleware);
app.use('/api', articlesCacheMiddleware);

// Article Content Cache-First Middleware
const articleContentCacheMiddleware = async (req, res, next) => {
    const path = req.path;
    // Only intercept the actual article-content endpoints.
    // This middleware must NOT run for e.g. `/article/:id/title` or other sub-routes,
    // otherwise unauthenticated callers could receive cached HTML unintentionally.
    const articleContentMatch = path.match(/^\/source\/[^/]+\/vehicle\/([^/]+)\/article\/([^/]+)(?:\/html)?$/);

    if (articleContentMatch && req.method === 'GET') {
        if (isVerifyBypass(req)) {
            return next();
        }
        const articleId = articleContentMatch[2];
        const vehicleId = decodeURIComponent(articleContentMatch[1]);

        const memPayload = getArticleContentFromMemCache(vehicleId, articleId);
        if (memPayload) {
            recordProxyStat('db');
            res.setHeader('x-data-source', 'memory');
            res.setHeader('x-cache-hit', 'true');
            return res.json(memPayload);
        }

        try {
            // 1. Check normalized content tables (procedures, dtcs, tsbs, specifications)
            const cached = await checkParsedArticle(articleId);
            if (cached) {
                const html = cached.content_html || cached.html || cached.content || '';
                if (html) {
                    logger.info(`✓ Serving article ${articleId} from normalized cache (${cached._table})`);
                    const payload = {
                        header: { status: 'OK', statusCode: 200 },
                        body: { html, title: cached.title, id: articleId }
                    };
                    setArticleContentMemCache(vehicleId, articleId, payload);
                    recordProxyStat('db');
                    res.setHeader('x-data-source', 'cloudsql');
                    res.setHeader('x-cache-hit', 'true');
                    return res.json(payload);
                }
            }

            // 2. Check articles table for original_content (lazy-synced HTML)
            const articleRow = await checkArticleContent(vehicleId, articleId);
            if (articleRow && articleRow.original_content) {
                logger.info(`✓ Serving article ${articleId} from articles table cache`);
                const payload = {
                    header: { status: 'OK', statusCode: 200 },
                    body: { html: articleRow.original_content, title: articleRow.title, id: articleId }
                };
                setArticleContentMemCache(vehicleId, articleId, payload);
                recordProxyStat('db');
                res.setHeader('x-data-source', 'cloudsql');
                res.setHeader('x-cache-hit', 'true');
                return res.json(payload);
            }
        } catch (err) {
            logger.warn(`Failed to fetch article content from cache for ${path}:`, err.message);
        }
    }
    next();
};

app.use('/api', articleContentCacheMiddleware);

// Chek-Chart YMME: api.motor.com fallback for /api/years, /api/year/:year/makes, /api/year/:year/make/:make/models
// Activates only when MOTOR_FLUIDS_PUBLIC_KEY + MOTOR_FLUIDS_PRIVATE_KEY are set. Cloud SQL cache still takes priority.
registerChekChartYmmeRoutes(app, logger);
// Ingest endpoint — raw body for binary/PDF/image, json for structured, text for plaintext
app.use('/api/ingest', (req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/json')) return express.json({ limit: '50mb' })(req, res, next);
    if (ct.includes('text/')) return express.text({ limit: '10mb', type: 'text/*' })(req, res, next);
    return express.raw({ limit: '50mb', type: '*/*' })(req, res, next);
});
registerIngestEndpoint(app, secureAuthMiddleware, logger);

// Fluids: optional direct `api.motor.com` RecommendedFluids when MOTOR_INFORMATION_* env + baseVehicleId + engineId query params
registerMotorInformationFluidsIntercept(app, logger);

// Canary: log when Motor catch-all is used for paths that should be Cloud SQL-backed.
app.use('/', (req, res, next) => {
    const path = req.path || (typeof req.url === 'string' ? req.url.split('?')[0] : '');

    const dbCoveredPatterns = [
        /^\/api\/source\/[^/]+\/vehicle\/[^/]+\/articles\/v2$/,
        /^\/api\/source\/[^/]+\/vehicle\/[^/]+\/article\/[^/]+\/html$/,
        /^\/api\/source\/[^/]+\/vehicle\/[^/]+\/article\/[^/]+$/
    ];

    const isDbCovered = dbCoveredPatterns.some((p) => p.test(path));

    if (isDbCovered) {
        const isForcedIngest =
            req.headers['x-torque-catalog-sync'] === '1' ||
            req.query?.torqueCatalogSync === '1' ||
            req.query?.torqueCatalogSync === 'true';
        if (!isForcedIngest) {
            logger.warn(
                `[ProxyCanary] Request to Motor for DB-covered path: ${req.method} ${path}` +
                    (isMotorProxyAllowlisted(path) ? ' (allowlisted route pattern)' : '')
            );
            res.setHeader('x-torque-proxy-canary', 'db-covered-path');
        }
    }

    next();
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
            recordProxyStat('motor');
            // Log the request
            logRequest(req, { route: req.path, sessionValid: authManager.isSessionValid() });

            // Force identity encoding to avoid GZIP issues in interceptor
            proxyReq.removeHeader('accept-encoding');

            // IMPORTANT:
            // For `/api/source/.../article/...` requests the browser also sends a Supabase
            // `Authorization: Bearer <jwt>` header so our backend can verify unlocks.
            // Those headers must NOT be forwarded to Motor.com (we authenticate to Motor.com
            // exclusively via the cookie jar established in `authMiddleware`).
            proxyReq.removeHeader('authorization');
            proxyReq.removeHeader('Authorization');
            proxyReq.removeHeader('x-metadata-refresh-bypass');

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
        res.setHeader('x-motor-proxy', 'true');
        // STRICTLY override CORS to hide upstream source
        const requestOrigin = normalizeOriginHeader(req.headers.origin);
        if (isOriginAllowed(requestOrigin)) {
            res.setHeader('access-control-allow-origin', requestOrigin);
            // Required when frontend sends withCredentials: true (Supabase auth). Cannot use * with credentials.
            res.setHeader('access-control-allow-credentials', 'true');
        } else {
            // Do not emit wildcard for credentialed/browser requests.
            res.removeHeader('access-control-allow-origin');
            res.removeHeader('access-control-allow-credentials');
        }
        // Strip upstream cookie headers so frontend never receives Motor cookies.
        // (access-control-allow-credentials above allows our frontend's credentialed requests.)

        // STRIP upstream headers that might reveal the source or leak data
        res.removeHeader('authorization');
        res.removeHeader('www-authenticate');
        res.removeHeader('proxy-authenticate');
        res.removeHeader('cookie');
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
            if (req.path.includes('/graphic/')) {
                persistGraphicAsset(req, responseBuffer, contentType);
            }
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
                // Motor API returns its SPA fallback HTML for missing REST endpoints (e.g. 404s on /fluids)
                if (req.path.includes('/api/source/') && !req.path.includes('/article/')) {
                    logger.warn(`Motor API returned HTML for REST endpoint ${req.path}. Rewriting to empty JSON.`);
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    return Buffer.from(JSON.stringify({ header: { status: 'Not Found', statusCode: 404 }, body: { data: [] } }), 'utf8');
                }
                // HTML is inherently whitespace-agnostic; skip costly regex cleanup to improve performance.
                logger.info('Skipping HTML whitespace normalization for performance');
                if (/\/article\//i.test(req.path)) {
                    const bodySnippet = responseData.slice(0, 8000);
                    if (
                        bodySnippet.includes('<title>Vehicle Information</title>') &&
                        bodySnippet.includes('base href="/m1/"')
                    ) {
                        logger.warn(
                            `Motor returned M1 SPA shell HTML for ${req.path} — wrong shard? ` +
                                'Use the models response contentSource (e.g. GeneralMotors vs MOTOR), not a guessed source.'
                        );
                    }
                    enqueueBackgroundParse(req, responseBuffer);
                }
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
                const isMetadata = req.path.includes('/years') || req.path.includes('/makes') || req.path.includes('/models') || req.path.includes('/engines');
                const isSilo = req.path.includes('/parts') || req.path.includes('/fluids') || req.path.includes('/specifications') || req.path.includes('/dtcs') || req.path.includes('/tsbs');
                const isCatalog = isArticleCatalog || isMetadata || isSilo;

                // Always normalize article catalogs (menu structure)
                if (isArticleCatalog) {
                    try {
                        let parsedJson = JSON.parse(normalizedData);
                        parsedJson = normalizeMotorResponse(parsedJson);
                        normalizedData = JSON.stringify(parsedJson);
                        logger.info(`Normalized menu structure for ${req.path}`);
                    } catch (e) {
                        logger.warn('Failed to normalize article catalog:', e);
                    }
                }

                if (!isCatalog && normalizedData && normalizedData.length >= 1000) {
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

                // Enqueue for background AI parsing and caching to Cloud SQL
                enqueueBackgroundParse(req, responseBuffer);

                // Warm in-memory metadata cache from Motor responses so the next request skips Cloud SQL entirely
                if (isMetadata && proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
                    try {
                        setMetadataMemCache(req.path, JSON.parse(normalizedData));
                    } catch { /* best-effort */ }
                }
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
        const cid = req.correlationId || req.requestId || 'unknown';
        logger.error('Proxy error:', { message: err?.message, stack: err?.stack, correlationId: cid, path: req.path });
        if (!res.headersSent) {
            res.status(500).setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
                error: 'Upstream proxy error',
                message: err?.code || err?.message || 'Unknown',
                correlationId: cid,
                path: req.path
            }));
        }
    }
}));

app.use((err, req, res, _next) => {
    const cid = req.correlationId || req.requestId || 'unknown';
    const uid = req.userId || null;
    logger.error('Unhandled error', {
        message: err?.message,
        stack: err?.stack,
        path: req.path,
        method: req.method,
        correlationId: cid,
        userId: uid,
        status: err.status || 500
    });
    if (!res.headersSent) {
        res.status(err.status || 500).json({ error: 'Internal server error', correlationId: cid });
    }
});

export { app };
export default app;
