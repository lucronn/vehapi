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
     * Simplified authentication flow using direct GET request
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
            logger.info('Starting simplified authentication flow...');
            this._updateProgress('authenticating', 'init', 'Starting authentication...', 0);

            try {
                const ebscoUser = (config.ebscoUser || '').trim();
                const ebscoPassword = (config.ebscoPassword || '').trim();
                if (!ebscoUser || !ebscoPassword) {
                    throw new Error(
                        'EBSCO authentication requires EBSCO_USER and EBSCO_PASSWORD environment variables. ' +
                            'Set them in vehapiproxi/.env (see .env.example).'
                    );
                }
                const profile = config.ebscoProfile || 'autorepso';
                const groupId = config.ebscoGroupId || 'remote';
                const ebscoLoginUrl =
                    `https://search.ebscohost.com/login.aspx?authtype=uid&user=${encodeURIComponent(ebscoUser)}` +
                    `&password=${encodeURIComponent(ebscoPassword)}&profile=${profile}&groupid=${groupId}`;

                logger.info(`Step 1: Making GET request to EBSCO login URL...`);
                this._updateProgress('authenticating', 'ebsco_login', 'Connecting to EBSCO...', 10);

                const MAX_PROXY_ATTEMPTS = 8;
                const maxRedirects = 10;

                // Outer loop: retry the entire auth chain with a fresh sticky proxy on failure.
                // EBSCO/Motor ties the session to the originating IP — all httpsRequest() calls
                // in one attempt must use the same proxy.
                let authSuccess = false;
                let lastError = null;

                for (let proxyAttempt = 0; proxyAttempt < MAX_PROXY_ATTEMPTS && !authSuccess; proxyAttempt++) {
                    // Pick ONE proxy entry for the entire chain — EBSCO/Motor ties session to originating IP
                    const stickyProxy = proxyPool.buildStickyAgent(true);
                    if (stickyProxy) {
                        logger.info(`[Auth] Attempt ${proxyAttempt + 1}/${MAX_PROXY_ATTEMPTS} using proxy: ${stickyProxy.url}`);
                    } else {
                        logger.info(`[Auth] Attempt ${proxyAttempt + 1}/${MAX_PROXY_ATTEMPTS} (no proxy)`);
                    }

                    try {
                        const cookieJar = new CookieJar();
                        let currentUrl = ebscoLoginUrl;
                        let redirectCount = 0;

                        // Follow redirects manually — all requests use stickyProxy
                        while (redirectCount < maxRedirects) {
                            const urlObj = new URL(currentUrl);
                            const cookieHeader = cookieJar.getCookieHeader(urlObj.hostname);

                            const response = await httpsRequest(
                                currentUrl,
                                { headers: cookieHeader ? { 'Cookie': cookieHeader } : {} },
                                stickyProxy
                            );

                            // Store cookies from this response
                            response.cookies.forEach(cookie => {
                                cookieJar.setCookie(cookie, urlObj.hostname);
                            });

                            logger.info(`Response status: ${response.statusCode}, URL: ${currentUrl}`);
                            logger.info(`Cookies received: ${response.cookies.length}`);

                            // Update progress based on redirect count
                            const progressPercent = Math.min(10 + (redirectCount * 15), 70);
                            this._updateProgress('authenticating', 'redirecting', `Following redirect ${redirectCount + 1}...`, progressPercent);

                            // Handle redirect
                            if (response.statusCode >= 300 && response.statusCode < 400) {
                                const location = response.headers.location;
                                if (location) {
                                    currentUrl = new URL(location, currentUrl).href;
                                    redirectCount++;
                                    logger.info(`Redirect ${redirectCount} to: ${currentUrl}`);
                                    continue;
                                }
                            }

                            // Check if we've reached motor.com
                            if (currentUrl.includes('motor.com')) {
                                logger.info(`✓ Reached motor.com at: ${currentUrl}`);
                                this._updateProgress('authenticating', 'motor_connect', 'Connecting to Motor.com...', 75);

                                // Make a final request to motor.com/m1 — same sticky proxy
                                const motorUrl = 'https://sites.motor.com/m1';
                                const cookieHeaderForMotor = cookieJar.getCookieHeader('sites.motor.com');

                                logger.info('Step 2: Making final request to motor.com/m1...');
                                this._updateProgress('authenticating', 'motor_auth', 'Authenticating with Motor.com...', 85);
                                const finalResponse = await httpsRequest(
                                    motorUrl,
                                    { headers: cookieHeaderForMotor ? { 'Cookie': cookieHeaderForMotor } : {} },
                                    stickyProxy
                                );

                                // Store any additional cookies from motor.com
                                finalResponse.cookies.forEach(cookie => {
                                    cookieJar.setCookie(cookie, 'sites.motor.com');
                                });

                                logger.info(`Final response status: ${finalResponse.statusCode}`);
                                break;
                            }

                            // No redirect and not motor.com — done
                            break;
                        }

                        // Extract all motor.com cookies
                        const motorCookies = cookieJar.getAllCookies().filter(c => c.domain.includes('motor.com'));
                        this.cookies = motorCookies.length > 0 ? motorCookies : cookieJar.getAllCookies();
                        if (motorCookies.length === 0) {
                            logger.warn(`No motor.com cookies found, using all cookies: ${this.cookies.length}`);
                        }

                        this.lastAuthTime = Date.now();
                        logger.info(`✓ Authentication successful! Got ${this.cookies.length} cookies`);
                        logger.info(`Cookies: ${this.cookies.map(c => c.name).join(', ')}`);

                        // Pin the outbound proxy used for auth so all subsequent Motor API
                        // requests go through the same IP (Motor binds sessions to originating IP).
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
                        logger.warn(`[Auth] Attempt ${proxyAttempt + 1} failed: ${attemptErr.message} — trying next proxy`);
                    }
                } // end proxy retry loop

                if (!authSuccess) {
                    throw lastError || new Error('All proxy attempts exhausted during authentication');
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
