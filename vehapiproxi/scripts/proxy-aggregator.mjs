#!/usr/bin/env node
/**
 * Proxy aggregator — fetches free proxy lists from multiple GitHub sources,
 * optionally probes each proxy for liveness, and serves a JSON array of
 * proxy URLs on a local HTTP endpoint consumed by proxy-pool.js.
 *
 * Usage:
 *   node scripts/proxy-aggregator.mjs [--port=3848] [--probe] [--probe-timeout=4000]
 *
 * proxy-pool.js consumes:
 *   OUTBOUND_PROXY_REFRESH_URL=http://127.0.0.1:3848/proxies
 *   OUTBOUND_PROXY_REFRESH_INTERVAL_MS=180000
 *
 * Sources refresh every REFRESH_INTERVAL_MS (default 10 min).
 * Probe pass (optional, slow) runs every PROBE_INTERVAL_MS (default 30 min).
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { SocksProxyAgent } from 'socks-proxy-agent';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Source list — raw URLs that return newline-separated host:port proxies
// ---------------------------------------------------------------------------

const SOURCES = [
    // TheSpeedX/PROXY-List — updated daily, large lists
    { proto: 'socks5', url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt' },
    { proto: 'socks4', url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt' },
    { proto: 'http',   url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt' },

    // proxifly/free-proxy-list — validated every 5 min
    { proto: 'socks5', url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt' },
    { proto: 'socks4', url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks4/data.txt' },
    { proto: 'http',   url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt' },

    // clarketm/proxy-list — updated daily
    { proto: 'http',   url: 'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt' },

    // officialputuid/KangProxy — daily validated
    { proto: 'socks5', url: 'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/socks5/socks5.txt' },
    { proto: 'socks4', url: 'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/socks4/socks4.txt' },
    { proto: 'http',   url: 'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/http/http.txt' },

    // vakhov/fresh-proxy-list — multiple protocols
    { proto: 'socks5', url: 'https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/socks5.txt' },
    { proto: 'socks4', url: 'https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/socks4.txt' },
    { proto: 'http',   url: 'https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/http.txt' },

    // VPSLabCloud — updated every 15 min
    { proto: 'socks5', url: 'https://raw.githubusercontent.com/VPSLabCloud/VPSLab-Free-Proxy-List/main/socks5.txt' },
    { proto: 'http',   url: 'https://raw.githubusercontent.com/VPSLabCloud/VPSLab-Free-Proxy-List/main/http.txt' },

    // ClearProxy/checked-proxy-list — verified every 5 min
    { proto: 'socks5', url: 'https://raw.githubusercontent.com/ClearProxy/checked-proxy-list/main/socks5.txt' },
    { proto: 'http',   url: 'https://raw.githubusercontent.com/ClearProxy/checked-proxy-list/main/http.txt' },
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function argv(name, fallback = '') {
    const eq = process.argv.find(a => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const ix = process.argv.indexOf(`--${name}`);
    if (ix >= 0 && process.argv[ix + 1] && !process.argv[ix + 1].startsWith('-')) return process.argv[ix + 1];
    return process.env[name.replace(/-/g, '_').toUpperCase()] || fallback;
}
function argvFlag(name) {
    return process.argv.includes(`--${name}`);
}

const PORT = Number(argv('port', '3848')) || 3848;
const PROBE = argvFlag('probe');
const PROBE_TIMEOUT_MS = Number(argv('probe-timeout', '4000')) || 4000;
const PROBE_TARGET_HOST = argv('probe-target', '1.1.1.1');
const PROBE_TARGET_PORT = Number(argv('probe-target-port', '80')) || 80;
const REFRESH_INTERVAL_MS = Number(argv('refresh-interval', '600000')) || 600000;  // 10 min
const PROBE_INTERVAL_MS   = Number(argv('probe-interval',   '1800000')) || 1800000; // 30 min
// Max proxies to keep per protocol after probe (prevents serving 50k broken proxies)
const MAX_PER_PROTO = Number(argv('max-per-proto', '500')) || 500;

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

function fetchText(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { headers: { 'User-Agent': 'vehapi-proxy-aggregator/1.0' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchText(res.headers.location).then(resolve, reject);
            }
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
    });
}

/** Parse raw text lines into host:port strings. */
function parseLines(text) {
    return text.split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(l));
}

/** Build a proxy:// URL from protocol + host:port string. */
function toUrl(proto, hostPort) {
    return `${proto}://${hostPort}`;
}

// ---------------------------------------------------------------------------
// Prober — TCP connect through proxy to PROBE_TARGET_HOST:PROBE_TARGET_PORT
// ---------------------------------------------------------------------------

function probeProxy(proxyUrl) {
    return new Promise((resolve) => {
        const u = new URL(proxyUrl);
        const isSocks = u.protocol.startsWith('socks');
        const timeout = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);

        if (isSocks) {
            // For SOCKS: just try a raw TCP connect to the proxy host:port
            // (full SOCKS handshake probe would need the agent; TCP connect is a fast pre-filter)
            const s = net.createConnection({ host: u.hostname, port: Number(u.port), timeout: PROBE_TIMEOUT_MS });
            s.on('connect', () => { clearTimeout(timeout); s.destroy(); resolve(true); });
            s.on('error', () => { clearTimeout(timeout); resolve(false); });
            s.on('timeout', () => { clearTimeout(timeout); s.destroy(); resolve(false); });
        } else {
            // For HTTP proxies: CONNECT tunnel attempt
            const req = http.request({
                method: 'CONNECT',
                host: u.hostname,
                port: Number(u.port),
                path: `${PROBE_TARGET_HOST}:${PROBE_TARGET_PORT}`,
                timeout: PROBE_TIMEOUT_MS,
            });
            req.on('connect', () => { clearTimeout(timeout); req.destroy(); resolve(true); });
            req.on('error', () => { clearTimeout(timeout); resolve(false); });
            req.on('timeout', () => { clearTimeout(timeout); req.destroy(); resolve(false); });
            req.end();
        }
    });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {Map<string, string[]>} proto → proxy URL list */
const byProto = new Map();
let lastRefresh = null;
let lastProbe = null;
let probing = false;

// ---------------------------------------------------------------------------
// Refresh: fetch all sources
// ---------------------------------------------------------------------------

async function refreshSources() {
    console.error(`[proxy-agg] Refreshing ${SOURCES.length} sources…`);
    /** @type {Map<string, Set<string>>} */
    const sets = new Map();

    await Promise.allSettled(SOURCES.map(async ({ proto, url }) => {
        try {
            const text = await fetchText(url);
            const lines = parseLines(text);
            if (!sets.has(proto)) sets.set(proto, new Set());
            for (const l of lines) sets.get(proto).add(toUrl(proto, l));
        } catch (e) {
            console.error(`[proxy-agg] Source failed (${proto} ${url.slice(0, 60)}…): ${e.message}`);
        }
    }));

    for (const [proto, set] of sets) {
        byProto.set(proto, [...set]);
    }

    lastRefresh = new Date().toISOString();
    const totals = [...sets.entries()].map(([p, s]) => `${p}:${s.size}`).join(' ');
    console.error(`[proxy-agg] Refresh done. ${totals}`);
}

// ---------------------------------------------------------------------------
// Probe: filter to live proxies
// ---------------------------------------------------------------------------

async function probeAll() {
    if (probing) return;
    probing = true;
    console.error(`[proxy-agg] Probe pass starting (timeout=${PROBE_TIMEOUT_MS}ms)…`);
    for (const [proto, urls] of byProto) {
        // Probe in batches of 50 concurrently
        const live = [];
        const batch = 50;
        for (let i = 0; i < urls.length; i += batch) {
            const slice = urls.slice(i, i + batch);
            const results = await Promise.all(slice.map(u => probeProxy(u)));
            for (let j = 0; j < slice.length; j++) {
                if (results[j]) live.push(slice[j]);
            }
            if (live.length >= MAX_PER_PROTO) break;
        }
        byProto.set(proto, live.slice(0, MAX_PER_PROTO));
        console.error(`[proxy-agg] ${proto}: ${live.length} live`);
    }
    lastProbe = new Date().toISOString();
    probing = false;
    console.error('[proxy-agg] Probe pass complete.');
}

// ---------------------------------------------------------------------------
// Serve
// ---------------------------------------------------------------------------

/** Build the combined proxy URL list to return, socks5 first. */
function buildList() {
    const order = ['socks5', 'socks4', 'http'];
    const out = [];
    for (const p of order) {
        const arr = byProto.get(p) || [];
        // Cap per-proto to avoid overwhelming the pool with 10k unverified proxies
        out.push(...arr.slice(0, MAX_PER_PROTO));
    }
    return out;
}

async function main() {
    // Initial load
    await refreshSources();
    if (PROBE) await probeAll();

    // Periodic refresh
    setInterval(async () => {
        await refreshSources();
    }, REFRESH_INTERVAL_MS).unref();

    // Periodic probe (only if enabled)
    if (PROBE) {
        setInterval(async () => {
            await probeAll();
        }, PROBE_INTERVAL_MS).unref();
    }

    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

        if (url.pathname === '/proxies') {
            const list = buildList();
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(list));
            return;
        }

        if (url.pathname === '/status') {
            const counts = {};
            for (const [p, arr] of byProto) counts[p] = arr.length;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ lastRefresh, lastProbe, probing, counts, total: buildList().length }));
            return;
        }

        res.writeHead(404).end();
    });

    server.listen(PORT, '127.0.0.1', () => {
        console.error(`[proxy-agg] Listening on http://127.0.0.1:${PORT}/proxies`);
        console.error(`[proxy-agg] Status: http://127.0.0.1:${PORT}/status`);
        console.error(`[proxy-agg] Probe mode: ${PROBE ? 'ON' : 'OFF (pass --probe to enable)'}`);
    });
}

main().catch(e => {
    console.error('[proxy-agg] fatal:', e.message);
    process.exitCode = 1;
});
