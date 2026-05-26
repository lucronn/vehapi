import https from 'https';
import { URL } from 'url';
import { config } from './config.js';
import logger from './logger.js';
import { proxyPool } from './proxy-pool.js';
import { dbQuery, isDbConfigured } from './db.js';

const SESSION_DOC_ID = 'motor_proxy_v3'; // Bump version to invalidate old sessions

// Simple cookie jar to track cookies across redirects
class CookieJar {
    constructor() {
        this.cookies = new Map();
    }

    setCookie(setCookieHeader, domain) {
        if (!setCookieHeader) return;

        // Parse Set-Cookie header: "name=value; path=/; domain=.example.com"
        const parts = setCookieHeader.split(';');
        const [nameValue] = parts;
        const [name, value] = nameValue.trim().split('=');
        if (name && value) {
            this.cookies.set(name, { value, domain });
        }
    }

    getCookieHeader(hostname) {
        const relevant = Array.from(this.cookies.entries())
            .filter(([_, cookie]) => {
                // Match domain (including subdomains)
                return hostname.includes(cookie.domain.replace(/^\./, '')) ||
                    cookie.domain.includes(hostname);
            })
            .map(([name, cookie]) => `${name}=${cookie.value}`);
        return relevant.join('; ');
    }

    getAllCookies() {
        return Array.from(this.cookies.entries()).map(([name, cookie]) => ({
            name,
            value: cookie.value,
            domain: cookie.domain
        }));
    }
}

// Helper to make HTTP request and handle redirects with cookie tracking
// Pass stickyAgent to reuse the same proxy across a multi-hop auth chain.
function httpsRequest(url, options = {}, stickyAgent = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const requestOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': config.userAgent,
                ...options.headers
            }
        };

        let activeProxyUrl = null;
        if (stickyAgent) {
            requestOptions.agent = stickyAgent.agent;
            activeProxyUrl = stickyAgent.url;
            // Public socks5 proxies may present expired/self-signed certs during tunneling
            requestOptions.rejectUnauthorized = false;
        } else {
            const picked = proxyPool.getCurrentAgentWithUrl(true);
            if (picked.agent) requestOptions.agent = picked.agent;
            activeProxyUrl = picked.url;
        }

        const req = https.request(requestOptions, (res) => {
            const cookies = [];
            const setCookieHeaders = res.headers['set-cookie'] || [];

            setCookieHeaders.forEach(header => {
                cookies.push(header);
            });

            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    cookies,
                    data,
                    url: url
                });
            });
        });

        req.on('error', (err) => {
            if (activeProxyUrl) proxyPool.reportFailure(activeProxyUrl);
            reject(err);
        });
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

class AuthManager {
    constructor() {
        this.cookies = [];
        this.lastAuthTime = null;
        this.authPromise = null;
        // Progress tracking for UI polling
        this.authProgress = {
            status: 'idle', // 'idle' | 'authenticating' | 'success' | 'error'
            step: null,
            message: null,
            progress: 0, // 0-100
            error: null,
            startedAt: null,
            completedAt: null
        };
    }

    /**
     * Get current authentication progress
     */
    getProgress() {
        return { ...this.authProgress };
    }

    /**
     * Update progress state
     */
    _updateProgress(status, step, message, progress = null) {
        this.authProgress = {
            ...this.authProgress,
            status,
            step,
            message,
            progress: progress !== null ? progress : this.authProgress.progress,
            startedAt: this.authProgress.startedAt || Date.now()
        };
    }

    /**
     * Check if session is valid
     */
    isSessionValid() {
        if (!this.cookies.length || !this.lastAuthTime) {
            return false;
        }

        const age = Date.now() - this.lastAuthTime;
        return age < config.maxSessionAge;
    }

    /**
     * Load saved session cookies from Cloud SQL
     */
    async loadSession() {
        if (!isDbConfigured()) {
            logger.info('DB not configured, skipping session load — will authenticate fresh');
            return false;
        }
        try {
            const { rows } = await dbQuery(
                `SELECT data FROM system_sessions WHERE id = $1 LIMIT 1`,
                [SESSION_DOC_ID]
            );
            if (rows.length === 0) {
                logger.info('No saved session found in DB, will authenticate');
                return false;
            }
            const session = rows[0].data;
            this.cookies = session.cookies;
            this.lastAuthTime = session.timestamp;
            if (this.isSessionValid()) {
                logger.info('✓ Loaded valid session from DB');
                return true;
            }
            logger.info('Session expired, re-authenticating...');
            return false;
        } catch (error) {
            logger.error('Error loading session from DB:', error);
            return false;
        }
    }

    /**
     * Save session cookies to Cloud SQL
     */
    async saveSession() {
        if (!isDbConfigured()) return;
        const session = {
            cookies: this.cookies,
            timestamp: this.lastAuthTime,
            updatedAt: new Date().toISOString(),
        };
        try {
            await dbQuery(
                `INSERT INTO system_sessions (id, data, updated_at)
                 VALUES ($1, $2::jsonb, NOW())
                 ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
                [SESSION_DOC_ID, JSON.stringify(session)]
            );
            logger.info('✓ Session saved to DB');
        } catch (e) {
            logger.error('Could not save session to DB', e);
        }
    }

    /**
     * Delete session from Cloud SQL
     */
    async deleteSession() {
        if (!isDbConfigured()) return;
        try {
            await dbQuery(`DELETE FROM system_sessions WHERE id = $1`, [SESSION_DOC_ID]);
            logger.info('✓ Session deleted from DB');
        } catch (e) {
            logger.error('Could not delete session from DB', e);
        }
    }

    /**
     * Invalidate session (clears in-memory and deletes from DB)
     */
    async invalidateSession() {
        this.lastAuthTime = 0;
        this.cookies = [];
        proxyPool.unpinProxy();
        await this.deleteSession();
        logger.info('✓ Session invalidated and deleted (proxy unpinned)');
    }

    /**
     * CPID (community patron / zip code) auth flow via Rhode Island library network.
     * Entry: search.ebscohost.com → login.ebsco.com (extract params) → POST next-step with zip
     * → logon.ebsco.zone → search.ebscohost.com/webauth → sites.motor.com/connector
     *
     * Config env vars:
     *   EBSCO_CPID_CUST_ID   Customer ID (default: ns145344)
     *   EBSCO_CPID_GROUP_ID  Group ID (default: main)
     *   EBSCO_CPID_ZIPS      Comma-sep RI zip codes to rotate (default: 02903,02906,02908,02940)
     */
    async _authenticateCpid(stickyProxy) {
        const custId = process.env.EBSCO_CPID_CUST_ID || 'ns145344';
        const groupId = process.env.EBSCO_CPID_GROUP_ID || 'main';
        const zips = (process.env.EBSCO_CPID_ZIPS || '02903,02906,02908,02909,02910,02914,02919,02940').split(',').map(z => z.trim());
        const zip = zips[Math.floor(Math.random() * zips.length)];

        logger.info(`[CPID] Starting zip-code auth: custId=${custId} zip=${zip}`);

        const cookieJar = new CookieJar();
        // Entry point that triggers the cpid prompted flow for this library
        const entryUrl = `https://search.ebscohost.com/login.aspx?authtype=uid&custid=${custId}&groupid=${groupId}&profile=autorepso&ref=https%3a%2f%2fwww.askri.org%2f`;

        let currentUrl = entryUrl;
        let loginEbscoUrl = null;

        // Step 1: follow redirects until we reach login.ebsco.com to harvest params
        for (let i = 0; i < 12; i++) {
            const urlObj = new URL(currentUrl);
            const cookieHeader = cookieJar.getCookieHeader(urlObj.hostname);
            const res = await httpsRequest(currentUrl, { headers: cookieHeader ? { Cookie: cookieHeader } : {} }, stickyProxy);
            res.cookies.forEach(c => cookieJar.setCookie(c, urlObj.hostname));
            logger.info(`[CPID] Step1 redirect ${i}: ${res.statusCode} ${currentUrl.substring(0, 80)}`);

            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const next = new URL(res.headers.location, currentUrl).href;
                if (next.includes('login.ebsco.com')) loginEbscoUrl = next;
                currentUrl = next;
                continue;
            }
            // Non-redirect — check if we already have what we need
            break;
        }

        if (!loginEbscoUrl) throw new Error('[CPID] Did not reach login.ebsco.com in redirect chain');

        const loginParams = new URL(loginEbscoUrl).searchParams;
        const requestIdentifier = loginParams.get('requestIdentifier');
        const redirectUri = loginParams.get('redirect_uri');
        const authRequest = loginParams.get('authRequest') || '';

        if (!requestIdentifier) throw new Error(`[CPID] Missing requestIdentifier in login.ebsco.com URL`);
        logger.info(`[CPID] Got requestIdentifier=${requestIdentifier.substring(0, 8)}...`);

        // Step 2: POST next-step with zip code
        const nextStepBody = JSON.stringify({
            action: 'signin',
            context: {
                original: {
                    authType: 'cpid,uid',
                    customerId: custId,
                    groupId,
                    profId: 'autorepso',
                    opid: null,
                    language: '',
                    requestIdentifier,
                    redirectUri: redirectUri || '',
                    showonlyspecifiedtypes: false,
                    isSimplified: false,
                    authRequest,
                    authToken: ''
                }
            },
            values: { prompt: zip, passwordPrompt: '' }
        });

        const loginCookies = cookieJar.getCookieHeader('login.ebsco.com');
        const nextStepRes = await httpsRequest(
            'https://login.ebsco.com/api/login/v1/prompted/next-step',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': String(Buffer.byteLength(nextStepBody)),
                    'Origin': 'https://login.ebsco.com',
                    'Referer': loginEbscoUrl.substring(0, 500),
                    ...(loginCookies ? { Cookie: loginCookies } : {})
                },
                body: nextStepBody
            },
            stickyProxy
        );

        if (nextStepRes.statusCode !== 200) {
            throw new Error(`[CPID] next-step returned ${nextStepRes.statusCode}: ${nextStepRes.data.substring(0, 200)}`);
        }

        let continueUrl;
        try {
            const parsed = JSON.parse(nextStepRes.data);
            continueUrl = parsed.redirect || parsed.redirectUrl || parsed.url || parsed.location;
        } catch (e) {
            throw new Error(`[CPID] next-step response not JSON: ${nextStepRes.data.substring(0, 200)}`);
        }

        if (!continueUrl) throw new Error(`[CPID] next-step returned no redirect URL: ${nextStepRes.data.substring(0, 200)}`);
        logger.info(`[CPID] next-step OK, continuing to: ${continueUrl.substring(0, 80)}`);

        // Step 3: follow redirects from next-step result to Motor connector/m1
        currentUrl = continueUrl;
        for (let i = 0; i < 12; i++) {
            const urlObj = new URL(currentUrl);
            const cookieHeader = cookieJar.getCookieHeader(urlObj.hostname);
            const res = await httpsRequest(currentUrl, { headers: cookieHeader ? { Cookie: cookieHeader } : {} }, stickyProxy);
            res.cookies.forEach(c => cookieJar.setCookie(c, urlObj.hostname));
            logger.info(`[CPID] Step3 redirect ${i}: ${res.statusCode} ${currentUrl.substring(0, 80)}`);

            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                currentUrl = new URL(res.headers.location, currentUrl).href;
                continue;
            }

            if (currentUrl.includes('motor.com')) {
                logger.info(`[CPID] Reached motor.com at: ${currentUrl}`);
                // If we landed on /connector, follow one more hop to /m1
                if (currentUrl.includes('/connector') && res.statusCode !== 200) {
                    throw new Error(`[CPID] Motor connector returned ${res.statusCode} — subscription may not allow access`);
                }
                // Make sure we have /m1 cookies
                if (!currentUrl.includes('/m1')) {
                    const m1Res = await httpsRequest('https://sites.motor.com/m1', { headers: cookieJar.getCookieHeader('sites.motor.com') ? { Cookie: cookieJar.getCookieHeader('sites.motor.com') } : {} }, stickyProxy);
                    m1Res.cookies.forEach(c => cookieJar.setCookie(c, 'sites.motor.com'));
                }
                break;
            }
            break;
        }

        const motorCookies = cookieJar.getAllCookies().filter(c => c.domain.includes('motor.com'));
        if (!motorCookies.length) throw new Error('[CPID] No Motor cookies after auth');
        return motorCookies;
    }

    /**
     * UID auth flow: search.ebscohost.com/login.aspx?authtype=uid with username+password
     */
    async _authenticateUid(stickyProxy) {
        const ebscoUser = (config.ebscoUser || '').trim();
        const ebscoPassword = (config.ebscoPassword || '').trim();
        if (!ebscoUser || !ebscoPassword) {
            throw new Error('UID auth requires EBSCO_USER and EBSCO_PASSWORD env vars');
        }
        const profile = config.ebscoProfile || 'autorepso';
        const groupId = config.ebscoGroupId || 'remote';
        const ebscoLoginUrl =
            `https://search.ebscohost.com/login.aspx?authtype=uid&user=${encodeURIComponent(ebscoUser)}` +
            `&password=${encodeURIComponent(ebscoPassword)}&profile=${profile}&groupid=${groupId}`;

        const cookieJar = new CookieJar();
        let currentUrl = ebscoLoginUrl;

        for (let i = 0; i < 10; i++) {
            const urlObj = new URL(currentUrl);
            const cookieHeader = cookieJar.getCookieHeader(urlObj.hostname);
            const res = await httpsRequest(currentUrl, { headers: cookieHeader ? { Cookie: cookieHeader } : {} }, stickyProxy);
            res.cookies.forEach(c => cookieJar.setCookie(c, urlObj.hostname));
            logger.info(`[UID] Redirect ${i}: ${res.statusCode} ${currentUrl.substring(0, 80)}`);

            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                currentUrl = new URL(res.headers.location, currentUrl).href;
                continue;
            }
            if (currentUrl.includes('motor.com')) {
                // Final request to /m1 if needed
                if (!currentUrl.includes('/m1')) {
                    const m1 = await httpsRequest('https://sites.motor.com/m1', {}, stickyProxy);
                    m1.cookies.forEach(c => cookieJar.setCookie(c, 'sites.motor.com'));
                }
                break;
            }
            break;
        }

        const motorCookies = cookieJar.getAllCookies().filter(c => c.domain.includes('motor.com'));
        if (!motorCookies.length) {
            // Fall back to all cookies
            const all = cookieJar.getAllCookies();
            if (!all.length) throw new Error('[UID] No cookies after auth');
            return all;
        }
        return motorCookies;
    }

    /**
     * Auth flow dispatcher: tries UID first, then CPID (zip code) if UID fails.
     * Returns Motor cookies on success, throws on total failure.
     */
    async _runAuthAttempt(stickyProxy, attemptNum) {
        const hasCpid = !!(process.env.EBSCO_CPID_CUST_ID || true); // cpid always available (uses default custId)
        const hasUid = !!(config.ebscoUser && config.ebscoPassword);

        // Alternate strategies: even attempts → uid, odd → cpid (or skip if not configured)
        const strategies = [];
        if (hasUid) strategies.push('uid');
        if (hasCpid) strategies.push('cpid');

        const strategy = strategies[attemptNum % strategies.length];
        logger.info(`[Auth] Attempt ${attemptNum + 1}: strategy=${strategy}`);

        if (strategy === 'cpid') {
            return await this._authenticateCpid(stickyProxy);
        } else {
            return await this._authenticateUid(stickyProxy);
        }
    }

    /**
     * Main authenticate() — retries across strategies and proxies.
     */
    async authenticate() {
        // If authentication is already in progress, return the existing promise
        if (this.authPromise) {
            logger.info('Authentication already in progress, waiting for result...');
            try {
                await this.authPromise;
                return;
            } catch (err) {
                throw err;
            }
        }

        // Reset progress state for new authentication
        this.resetProgress();

        // Create a new auth promise
        this.authPromise = (async () => {
            logger.info('Starting authentication...');
            this._updateProgress('authenticating', 'init', 'Starting authentication...', 0);

            try {
                const MAX_PROXY_ATTEMPTS = 10;
                let authSuccess = false;
                let lastError = null;

                for (let proxyAttempt = 0; proxyAttempt < MAX_PROXY_ATTEMPTS && !authSuccess; proxyAttempt++) {
                    const stickyProxy = proxyPool.buildStickyAgent(true);
                    if (stickyProxy) {
                        logger.info(`[Auth] Attempt ${proxyAttempt + 1}/${MAX_PROXY_ATTEMPTS} proxy: ${stickyProxy.url.substring(0, 40)}`);
                    } else {
                        logger.info(`[Auth] Attempt ${proxyAttempt + 1}/${MAX_PROXY_ATTEMPTS} (no proxy)`);
                    }

                    this._updateProgress('authenticating', 'connecting', `Auth attempt ${proxyAttempt + 1}...`, 10 + proxyAttempt * 8);

                    try {
                        const motorCookies = await this._runAuthAttempt(stickyProxy, proxyAttempt);

                        this.cookies = motorCookies;
                        this.lastAuthTime = Date.now();
                        logger.info(`✓ Authentication successful! Got ${this.cookies.length} cookies: ${this.cookies.map(c => c.name).join(', ')}`);

                        if (stickyProxy) proxyPool.pinProxy(stickyProxy.url);

                        this._updateProgress('authenticating', 'saving', 'Saving session...', 95);
                        await this.saveSession();

                        this._updateProgress('success', 'complete', 'Authentication successful!', 100);
                        this.authProgress.completedAt = Date.now();
                        authSuccess = true;

                    } catch (attemptErr) {
                        lastError = attemptErr;
                        if (stickyProxy) proxyPool.reportFailure(stickyProxy.url);
                        proxyPool.unpinProxy();
                        logger.warn(`[Auth] Attempt ${proxyAttempt + 1} failed: ${attemptErr.message} — trying next proxy/strategy`);
                    }
                }

                if (!authSuccess) {
                    throw lastError || new Error('All auth attempts exhausted');
                }

            } catch (error) {
                logger.error('Authentication failed:', error);
                this._updateProgress('error', 'failed', `Authentication failed: ${error.message}`, 0);
                this.authProgress.error = error.message;
                this.authProgress.completedAt = Date.now();
                throw error;
            }
        })();

        try {
            await this.authPromise;
        } finally {
            this.authPromise = null;
        }
    }

    /**
     * Get session cookies (authenticate if needed)
     */
    async getCookies() {
        if (!this.isSessionValid()) {
            await this.authenticate();
        }
        return this.cookies;
    }

    /**
     * Reset progress state (call before starting new authentication)
     */
    resetProgress() {
        this.authProgress = {
            status: 'idle',
            step: null,
            message: null,
            progress: 0,
            error: null,
            startedAt: null,
            completedAt: null
        };
    }

    /**
     * Get cookies as a Cookie header string
     */
    async getCookieHeader() {
        const cookies = await this.getCookies();
        return cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
}

// Singleton instance
export const authManager = new AuthManager();

/**
 * Verify Firebase ID Token (lazy-loads firebase-admin; unused in credits flow)
 * @param {string} token
 * @returns {Promise<import('firebase-admin/auth').DecodedIdToken | null>}
 */
export async function verifyFirebaseIdToken(token) {
    try {
        const { getAuth } = await import('firebase-admin/auth');
        const auth = getAuth();
        const decodedToken = await auth.verifyIdToken(token);
        return decodedToken;
    } catch (error) {
        logger.error('Error verifying Firebase ID token:', error);
        return null;
    }
}
