/**
 * Rotating outbound proxy pool for Motor.com requests.
 *
 * Config env vars:
 *   OUTBOUND_PROXY_LIST          Comma-separated proxy URLs
 *                                e.g. socks5://user:pass@host:port,http://host2:port2
 *   OUTBOUND_PROXY_REFRESH_URL   HTTP endpoint that returns JSON array or newline-sep list of proxy URLs.
 *                                Polled every OUTBOUND_PROXY_REFRESH_INTERVAL_MS.
 *   OUTBOUND_PROXY_REFRESH_INTERVAL_MS  Default: 300000 (5 min)
 *   OUTBOUND_PROXY_ROTATE_ON_FAILURE    true|false (default true) — rotate proxy on 429/403/error
 *   OUTBOUND_PROXY_MAX_FAILURES         Failures before disabling a proxy (default 3)
 */

import https from 'https';
import http from 'http';
import { createRequire } from 'module';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import logger from './logger.js';

const _require = createRequire(import.meta.url);
const { HttpProxyAgent } = _require('http-proxy-agent');

/**
 * Build an Agent for a given proxy URL.
 * @param {string} proxyUrl
 * @param {boolean} secure  true = HTTPS target, false = HTTP target
 */
function buildAgent(proxyUrl, secure = true) {
    const u = new URL(proxyUrl);
    const proto = u.protocol.toLowerCase();
    if (proto === 'socks5:' || proto === 'socks4:' || proto === 'socks:') {
        return new SocksProxyAgent(proxyUrl);
    }
    if (secure) return new HttpsProxyAgent(proxyUrl);
    return new HttpProxyAgent(proxyUrl);
}

/** Parse a raw string (JSON array or newline-sep) into an array of URLs. */
function parseProxyList(raw) {
    raw = raw.trim();
    if (raw.startsWith('[')) {
        try {
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
        } catch { /* fall through */ }
    }
    return raw.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
}

class ProxyEntry {
    /** @param {string} url */
    constructor(url) {
        this.url = url;
        this.failures = 0;
        this.disabled = false;
        this.lastFailAt = 0;
    }
}

/**
 * A custom https.Agent that delegates createConnection to a ProxyPool-selected
 * sub-agent. Passed once to createProxyMiddleware; rotates per connection.
 */
class RotatingProxyAgent extends https.Agent {
    /** @param {ProxyPool} pool */
    constructor(pool) {
        super({ keepAlive: false });
        this.pool = pool;
    }

    /** @override */
    createConnection(options, callback) {
        const entry = this.pool._pick();
        if (!entry) {
            return super.createConnection(options, callback);
        }
        try {
            const sub = buildAgent(entry.url, true);
            return sub.createConnection(options, callback);
        } catch (err) {
            logger.warn(`[ProxyPool] createConnection failed for ${entry.url}: ${err.message}`);
            this.pool.reportFailure(entry.url);
            return super.createConnection(options, callback);
        }
    }
}

export class ProxyPool {
    constructor() {
        /** @type {ProxyEntry[]} */
        this.entries = [];
        this._cursor = 0;
        this._refreshTimer = null;
        this._rotatingAgent = null;
        this._maxFailures = Number.parseInt(process.env.OUTBOUND_PROXY_MAX_FAILURES || '3', 10) || 3;
        this._rotateOnFailure = String(process.env.OUTBOUND_PROXY_ROTATE_ON_FAILURE ?? 'true').toLowerCase() !== 'false';
        /** URL of the proxy pinned for the current session, or null if unpinned. */
        this._pinnedUrl = null;
    }

    /** Load proxies from OUTBOUND_PROXY_LIST env var. */
    loadFromEnv() {
        const raw = process.env.OUTBOUND_PROXY_LIST || '';
        if (!raw.trim()) return;
        const urls = parseProxyList(raw);
        this._loadUrls(urls, 'env');
    }

    /** @param {string[]} urls @param {string} source */
    _loadUrls(urls, source = 'refresh') {
        if (!urls.length) return;
        // Keep failure counts for URLs that persist
        const existing = new Map(this.entries.map(e => [e.url, e]));
        const newEntries = urls.map(u => {
            const prev = existing.get(u);
            if (prev) return prev;
            return new ProxyEntry(u);
        });
        // If we have a pinned proxy that isn't in the new list, keep it so _pick() can still return it
        if (this._pinnedUrl && !urls.includes(this._pinnedUrl)) {
            const prev = existing.get(this._pinnedUrl);
            if (prev && !prev.disabled) newEntries.push(prev);
        }
        this.entries = newEntries;
        this._cursor = 0;
        this._rotatingAgent = null; // force rebuild
        logger.info(`[ProxyPool] Loaded ${this.entries.length} proxies from ${source}`);
    }

    get active() {
        return this.entries.some(e => !e.disabled);
    }

    get size() {
        return this.entries.length;
    }

    /** Pick the next non-disabled proxy in round-robin fashion (or return the pinned one). */
    _pick() {
        if (this._pinnedUrl) {
            const pinned = this.entries.find(e => e.url === this._pinnedUrl && !e.disabled);
            if (pinned) {
                logger.debug(`[ProxyPool] Using pinned proxy: ${this._maskUrl(this._pinnedUrl)}`);
                return pinned;
            }
            // Pinned proxy was disabled or not found — fall through to round-robin
            const inEntries = this.entries.find(e => e.url === this._pinnedUrl);
            logger.warn(`[ProxyPool] Pinned proxy ${this._maskUrl(this._pinnedUrl)} ${inEntries ? `disabled (failures=${inEntries.failures})` : 'not in entries'}; unpinning`);
            this._pinnedUrl = null;
        }
        const enabled = this.entries.filter(e => !e.disabled);
        if (!enabled.length) return null;
        const entry = enabled[this._cursor % enabled.length];
        this._cursor = (this._cursor + 1) % enabled.length;
        return entry;
    }

    /**
     * Pin a specific proxy URL for all subsequent requests (session-IP binding).
     * Call after successful auth so all Motor API requests use the same IP as auth.
     */
    pinProxy(url) {
        if (!url) return;
        this._pinnedUrl = url;
        logger.info(`[ProxyPool] Pinned outbound proxy to: ${this._maskUrl(url)}`);
    }

    /** Unpin the session proxy (call before re-auth to allow fresh proxy selection). */
    unpinProxy() {
        if (this._pinnedUrl) {
            logger.info(`[ProxyPool] Unpinned proxy: ${this._maskUrl(this._pinnedUrl)}`);
            this._pinnedUrl = null;
        }
    }

    /** Get an Agent for a single outbound request (non-rotating, picks current). */
    getCurrentAgent(secure = true) {
        const entry = this._pick();
        if (!entry) return undefined;
        return buildAgent(entry.url, secure);
    }

    /**
     * Pick ONE proxy and build a sticky {agent, url} pair for an entire auth chain.
     * The caller must use this same object for every httpsRequest() in the chain,
     * then call reportFailure(url) if the chain fails.
     * Returns null if no proxies are available.
     */
    buildStickyAgent(secure = true) {
        const entry = this._pick();
        if (!entry) return null;
        try {
            return { agent: buildAgent(entry.url, secure), url: entry.url };
        } catch (err) {
            logger.warn(`[ProxyPool] buildStickyAgent failed for ${entry.url}: ${err.message}`);
            this.reportFailure(entry.url);
            return null;
        }
    }

    /** Like getCurrentAgent but also returns the proxy URL for failure reporting. */
    getCurrentAgentWithUrl(secure = true) {
        const entry = this._pick();
        if (!entry) return { agent: undefined, url: null };
        try {
            return { agent: buildAgent(entry.url, secure), url: entry.url };
        } catch (err) {
            logger.warn(`[ProxyPool] buildAgent failed for ${entry.url}: ${err.message}`);
            this.reportFailure(entry.url);
            return { agent: undefined, url: null };
        }
    }

    /**
     * Returns a RotatingProxyAgent that delegates createConnection per request.
     * Safe to pass once to createProxyMiddleware.
     */
    getRotatingAgent() {
        if (!this._rotatingAgent) {
            this._rotatingAgent = new RotatingProxyAgent(this);
        }
        return this._rotatingAgent;
    }

    /** Call on 403/429/connection error for a specific proxy URL. */
    reportFailure(proxyUrl) {
        if (!this._rotateOnFailure) return;
        const entry = this.entries.find(e => e.url === proxyUrl);
        if (!entry) return;
        entry.failures++;
        entry.lastFailAt = Date.now();
        if (entry.failures >= this._maxFailures) {
            entry.disabled = true;
            logger.warn(`[ProxyPool] Proxy disabled after ${entry.failures} failures: ${proxyUrl}`);
        }
        this.rotate();
    }

    /** Call on success — optionally re-enable proxies that have cooled down. */
    reportSuccess(proxyUrl) {
        const entry = this.entries.find(e => e.url === proxyUrl);
        if (entry) {
            entry.failures = Math.max(0, entry.failures - 1);
        }
        // Re-enable disabled proxies that haven't been used in 10 min
        const cooldown = 10 * 60 * 1000;
        for (const e of this.entries) {
            if (e.disabled && Date.now() - e.lastFailAt > cooldown) {
                e.disabled = false;
                e.failures = 0;
                logger.info(`[ProxyPool] Re-enabled proxy after cooldown: ${e.url}`);
            }
        }
    }

    /** Advance the cursor to skip the current proxy. */
    /** Re-enable all disabled proxies and reset failure counters. */
    resetFailures() {
        let count = 0;
        for (const e of this.entries) {
            if (e.disabled) { e.disabled = false; e.failures = 0; count++; }
        }
        logger.info(`[ProxyPool] resetFailures: re-enabled ${count} proxies`);
        return count;
    }

    rotate() {
        const enabledCount = this.entries.filter(e => !e.disabled).length;
        if (enabledCount > 0) {
            this._cursor = (this._cursor + 1) % enabledCount;
        }
        const next = this._pick();
        if (next) logger.info(`[ProxyPool] Rotated to: ${this._maskUrl(next.url)}`);
    }

    /** Fetch fresh proxy list from OUTBOUND_PROXY_REFRESH_URL. */
    async refresh() {
        const url = process.env.OUTBOUND_PROXY_REFRESH_URL;
        if (!url) return;
        try {
            const client = url.startsWith('https') ? https : http;
            const raw = await new Promise((resolve, reject) => {
                const req = client.get(url, { headers: { 'User-Agent': 'vehapiproxi/proxy-pool' } }, (res) => {
                    let body = '';
                    res.on('data', c => body += c);
                    res.on('end', () => resolve(body));
                });
                req.on('error', reject);
                req.setTimeout(10000, () => { req.destroy(new Error('timeout')); });
            });
            const urls = parseProxyList(raw);
            if (urls.length) this._loadUrls(urls, 'refresh');
        } catch (err) {
            logger.warn(`[ProxyPool] Refresh failed: ${err.message}`);
        }
    }

    /** Start periodic refresh loop. */
    startRefreshInterval() {
        const ms = Number.parseInt(process.env.OUTBOUND_PROXY_REFRESH_INTERVAL_MS || '300000', 10) || 300000;
        if (!process.env.OUTBOUND_PROXY_REFRESH_URL) return;
        this._refreshTimer = setInterval(() => this.refresh(), ms);
        if (this._refreshTimer.unref) this._refreshTimer.unref();
        logger.info(`[ProxyPool] Auto-refresh every ${ms / 1000}s from ${process.env.OUTBOUND_PROXY_REFRESH_URL}`);
    }

    stopRefreshInterval() {
        if (this._refreshTimer) clearInterval(this._refreshTimer);
        this._refreshTimer = null;
    }

    /** Redact credentials from URL for logging. */
    _maskUrl(url) {
        try {
            const u = new URL(url);
            if (u.password) u.password = '***';
            if (u.username) u.username = u.username.slice(0, 3) + '***';
            return u.toString();
        } catch {
            return url.slice(0, 20) + '…';
        }
    }

    /** Status snapshot for the dashboard. */
    getStatus() {
        return {
            active: this.active,
            total: this.entries.length,
            enabled: this.entries.filter(e => !e.disabled).length,
            cursor: this._cursor,
            pinnedUrl: this._pinnedUrl ? this._maskUrl(this._pinnedUrl) : null,
            proxies: this.entries.map(e => ({
                url: this._maskUrl(e.url),
                failures: e.failures,
                disabled: e.disabled,
                lastFailAt: e.lastFailAt || null,
            })),
        };
    }
}

export const proxyPool = new ProxyPool();

/** Bootstrap: load from env, start refresh loop, trigger initial async refresh. */
export function initProxyPool() {
    proxyPool.loadFromEnv();
    proxyPool.startRefreshInterval();
    // Non-blocking initial refresh — pool may be empty until this resolves
    proxyPool.refresh().then(() => {
        if (proxyPool.active) {
            logger.info(`[ProxyPool] Initialized with ${proxyPool.entries.length} proxies`);
        }
    }).catch(() => {});
    if (!proxyPool.active && !process.env.OUTBOUND_PROXY_LIST && !process.env.OUTBOUND_PROXY_REFRESH_URL) {
        logger.info('[ProxyPool] No outbound proxies configured (OUTBOUND_PROXY_LIST / OUTBOUND_PROXY_REFRESH_URL)');
    }
}
