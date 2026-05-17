#!/usr/bin/env node
/**
 * Populate Cloud SQL with the M1 article catalog (NOT individual article content).
 *
 * Multi-session: rotates through `sessions.json` so concurrent workers each use a
 * different Motor session and get an independent rate-limit bucket. Each worker
 * sticks to one session for the run; on persistent 401 the session is retired.
 *
 * Calls sites.motor.com/m1 directly (bypasses local proxy) and invokes
 * ingestArticlesCatalogFromMotorJson() in-process to persist.
 *
 * Resume strategy:
 *   - Phase 1: skip year/make pairs already cached at /motor/year/{y}/make/{m}/models
 *   - Phase 2: skip M1 vehicleIds that already have any row in `articles`
 *             (i.e. "completed only" — fully missing vehicles get re-ingested)
 *
 * Usage:
 *   node scripts/seed-articles-catalog.mjs                       # full run, all sessions
 *   node scripts/seed-articles-catalog.mjs --years=2024,2023
 *   node scripts/seed-articles-catalog.mjs --concurrency=4
 *   node scripts/seed-articles-catalog.mjs --max=100
 *   node scripts/seed-articles-catalog.mjs --sessions=path/to/sessions.json
 *   node scripts/seed-articles-catalog.mjs --dry-run             # discover only
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { ProxyAgent, Agent as UndiciAgent } from 'undici';
import { SocksClient } from 'socks';
import tls from 'node:tls';
import net from 'node:net';
import { dbQuery, isDbConfigured } from '../src/db.js';
import { ingestArticlesCatalogFromMotorJson } from '../src/ingest/ingest_articles_catalog.js';
import { authManager } from '../src/auth.js';

const M1_BASE = 'https://sites.motor.com/m1';
const QUOTA_PER_PERIOD = 5000;     // Motor M1 rate limit
const QUOTA_SOFT_CAP = 4800;       // pause before hitting hard limit
const PERIOD_MS = 6 * 60 * 1000;   // 6-min rolling window

const argv = process.argv.slice(2);
const arg = (n) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`) || a === `--${n}`);
    return hit ? (hit.includes('=') ? hit.split('=')[1] : true) : null;
};
const YEARS_FILTER   = arg('years')?.split(',').map(Number).filter(Boolean) || null;
const DELAY_MS       = Number(arg('delay') || 250);
const MAX_VEHICLES   = Number(arg('max') || 0) || Infinity;
const DRY_RUN        = Boolean(arg('dry-run'));
const FORCE          = Boolean(arg('force'));
const SESSIONS_PATH  = arg('sessions') || path.join(__dirname, '..', 'sessions.json');
const USE_PROXIES    = !arg('no-proxies');
// Aggregate from multiple free sources — single sources often return <10
// proxies; the seed needs dozens of survivors. URLs return plain text or simple
// host:port lists.
const PROXY_SOURCES = [
    // ProxyScrape API (HTTP + SOCKS)
    'https://api.proxyscrape.com/v3/free-proxy-list/get?request=getproxies&protocol=http&proxy_format=ipport&format=text',
    'https://api.proxyscrape.com/v3/free-proxy-list/get?request=getproxies&protocol=socks4&proxy_format=ipport&format=text',
    'https://api.proxyscrape.com/v3/free-proxy-list/get?request=getproxies&protocol=socks5&proxy_format=ipport&format=text',
    // GitHub aggregators — these refresh hourly, big lists, fairly reliable
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
    'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
    'https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/proxies.txt',
    'https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/http.txt',
    'https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/socks5.txt',
    'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.txt',
    'https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt',
    'https://raw.githubusercontent.com/zloi-user/hideip.me/main/https.txt',
    'https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks4.txt',
    'https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks5.txt',
    'https://raw.githubusercontent.com/Anonym0usWork1221/Free-Proxies/main/proxy_files/http_proxies.txt',
    'https://raw.githubusercontent.com/Anonym0usWork1221/Free-Proxies/main/proxy_files/socks4_proxies.txt',
    'https://raw.githubusercontent.com/Anonym0usWork1221/Free-Proxies/main/proxy_files/socks5_proxies.txt',
    'https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/http.txt',
    'https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/socks4.txt',
    'https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/socks5.txt',
    'https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt',
    'https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS4_RAW.txt',
    'https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt',
    'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/http/http.txt',
    'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/socks4/socks4.txt',
    'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/socks5/socks5.txt',
    'https://raw.githubusercontent.com/saisuiu/Lionkings-Http-Proxys-Proxies/main/free.txt',
    // Geonode API (different format — pure JSON, requires parsing)
    'https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc',
];
const PROXY_LIST_URL = arg('proxy-list');  // optional override (single URL)

if (!isDbConfigured()) { console.error('✗ DATABASE_URL not set'); process.exit(1); }

// ─── Load sessions ───────────────────────────────────────────────────────────
const sessions = (() => {
    const raw = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
    const list = (raw.sessions || []).filter(s => s.cookie && s.cookie.trim());
    if (!list.length) {
        console.error(`✗ No sessions with cookies in ${SESSIONS_PATH}`);
        process.exit(1);
    }
    return list.map(s => ({
        name: s.name,
        cookie: s.cookie.trim(),
        dead: false,
        calls: 0,         // total
        errors: 0,
        windowStart: Date.now(),
        windowCalls: 0,   // calls in current 6-min window
        cooldownUntil: 0, // ms timestamp
        reauths: 0,
        proxy: null,      // current ProxyAgent (rotated on ban)
        proxyRotations: 0,
    }));
})();

const CONCURRENCY = Number(arg('concurrency') || sessions.length * 4);
console.log(`✓ Cloud SQL connected`);
console.log(`✓ Loaded ${sessions.length} session(s): ${sessions.map(s => s.name).join(', ')}`);
console.log(`  years=${YEARS_FILTER || 'all'} concurrency=${CONCURRENCY} delay=${DELAY_MS}ms max=${MAX_VEHICLES === Infinity ? 'unlimited' : MAX_VEHICLES} dry=${DRY_RUN} force=${FORCE} proxies=${USE_PROXIES}\n`);


const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Proxy pool ──────────────────────────────────────────────────────────────
// Free HTTP proxies from proxyscrape. We validate each by calling a cheap
// public-facing Motor endpoint; only proxies that get a non-403 response from
// Motor are kept. Each session is assigned its own proxy and rotates when its
// proxy gets banned.
const proxyPool = []; // { url, agent, dead }
const PROXY_PROBE_URL = 'https://sites.motor.com/m1/'; // returns 200 even without auth
const PROXY_PROBE_TIMEOUT_MS = 6000;

async function fetchProxyList() {
    const sources = PROXY_LIST_URL ? [PROXY_LIST_URL] : PROXY_SOURCES;
    // Each candidate is { hostPort, protocol } so we can dispatch the right
    // Undici agent. HTTP-only sources tag everything 'http'; SOCKS sources tag
    // 'socks5' (treating socks4 ≈ socks5 client-side is good enough for probing).
    const all = new Map(); // key=hostPort:proto → {hostPort, protocol}
    const addEntry = (hostPort, protocol) => {
        const key = `${hostPort}|${protocol}`;
        if (!all.has(key)) all.set(key, { hostPort, protocol });
    };
    await Promise.all(sources.map(async (url) => {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
            const ctype = res.headers.get('content-type') || '';
            // Geonode JSON
            if (url.includes('geonode.com') || ctype.includes('json')) {
                const json = await res.json();
                for (const p of json.data || []) {
                    const hp = `${p.ip}:${p.port}`;
                    const protos = (p.protocols || []).map(x => x.toLowerCase());
                    if (protos.includes('http') || protos.includes('https')) addEntry(hp, 'http');
                    if (protos.includes('socks5')) addEntry(hp, 'socks5');
                    if (protos.includes('socks4')) addEntry(hp, 'socks4');
                }
                return;
            }
            const text = await res.text();
            // Infer protocol from source URL
            const proto = /socks5/i.test(url) ? 'socks5'
                : /socks4/i.test(url) ? 'socks4'
                : 'http';
            for (const tok of text.split(/\s+/)) {
                let clean = tok.trim();
                if (!clean) continue;
                // Strip scheme prefix if present (some sources prepend http:// or socks5://)
                const m = clean.match(/^(https?|socks[45]):\/\/(.+)$/i);
                let candidateProto = proto;
                if (m) { candidateProto = m[1].toLowerCase().replace(/^https$/, 'http'); clean = m[2]; }
                if (/^[\d.]+:\d+$/.test(clean)) addEntry(clean, candidateProto);
            }
        } catch (e) {
            console.warn(`  ⚠ source ${url.slice(0,60)}… failed: ${e.message}`);
        }
    }));
    return [...all.values()];
}

function makeAgent({ hostPort, protocol }) {
    if (protocol === 'http' || protocol === 'https') {
        return new ProxyAgent({ uri: `http://${hostPort}`, requestTls: { rejectUnauthorized: false } });
    }
    // SOCKS4/5: build an Undici Agent whose connect() routes the socket
    // through the SOCKS proxy. Works for HTTPS by layering TLS on top.
    const [pHost, pPort] = hostPort.split(':');
    const socksType = protocol === 'socks4' ? 4 : 5;
    return new UndiciAgent({
        connect: async (opts, callback) => {
            try {
                const dstHost = opts.hostname || opts.host;
                const dstPort = Number(opts.port) || (opts.protocol === 'https:' ? 443 : 80);
                const { socket } = await SocksClient.createConnection({
                    proxy: { host: pHost, port: Number(pPort), type: socksType },
                    command: 'connect',
                    destination: { host: dstHost, port: dstPort },
                    timeout: PROXY_PROBE_TIMEOUT_MS,
                });
                if (opts.protocol === 'https:') {
                    const tlsSock = tls.connect({
                        socket,
                        servername: dstHost,
                        rejectUnauthorized: false,
                        ALPNProtocols: ['http/1.1'],
                    });
                    tlsSock.once('secureConnect', () => callback(null, tlsSock));
                    tlsSock.once('error', callback);
                } else {
                    callback(null, socket);
                }
            } catch (e) { callback(e); }
        },
    });
}

async function validateProxy(candidate) {
    const { hostPort, protocol } = typeof candidate === 'string'
        ? { hostPort: candidate, protocol: 'http' }
        : candidate;
    const url = `${protocol}://${hostPort}`;
    let agent;
    try { agent = makeAgent({ hostPort, protocol }); }
    catch { return null; }
    try {
        const res = await fetch(PROXY_PROBE_URL, {
            dispatcher: agent,
            signal: AbortSignal.timeout(PROXY_PROBE_TIMEOUT_MS),
            headers: { 'User-Agent': 'Mozilla/5.0' },
            redirect: 'manual',
        });
        if (res.status === 200 || res.status === 302 || res.status === 301) {
            return { url, agent, dead: false };
        }
    } catch { /* timeout / refused / refused-by-motor */ }
    return null;
}

const PROXY_CANDIDATE_CAP = Number(arg('proxy-candidates') || 2000);
const PROXY_TARGET        = Number(arg('proxy-target')     || 100);
async function refillPool(target = 30) {
    if (proxyPool.filter(p => !p.dead).length >= target) return;
    const all = await fetchProxyList();
    // Priority order: proxyscrape API candidates first (best hit rate), then
    // the curated GitHub repos, then everything else random.
    const score = (c) => {
        if (c.protocol === 'http') return 0;        // prefer http (works with both ProxyAgent + Undici)
        if (c.protocol === 'socks5') return 1;
        return 2;
    };
    const candidates = all.sort((a, b) => score(a) - score(b))
        .slice(0, PROXY_CANDIDATE_CAP);
    if (!candidates.length) return;
    const protoBreakdown = candidates.reduce((acc, c) => { acc[c.protocol] = (acc[c.protocol]||0)+1; return acc; }, {});
    console.log(`\n  → validating ${candidates.length} of ${all.length} candidates  (by protocol: ${JSON.stringify(protoBreakdown)})`);
    const BATCH = 200;
    for (let i = 0; i < candidates.length && proxyPool.filter(p => !p.dead).length < target; i += BATCH) {
        const batch = candidates.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(validateProxy));
        let added = 0;
        for (const r of results) if (r) { proxyPool.push(r); added++; }
        console.log(`  → batch ${i/BATCH+1} (${batch[0]?.protocol}): +${added} live (total: ${proxyPool.filter(p=>!p.dead).length})`);
    }
    const live = proxyPool.filter(p => !p.dead).length;
    console.log(`  → proxy pool: ${live} live (of ${proxyPool.length} survived validation)\n`);
}

function leaseProxy() {
    if (!USE_PROXIES) return null;
    const live = proxyPool.filter(p => !p.dead);
    if (!live.length) return null;
    return live[Math.floor(Math.random() * live.length)];
}

function retireProxy(proxy) {
    if (proxy) proxy.dead = true;
}

const PROXY_REFILL_INTERVAL_MS = Number(arg('proxy-refill-min') || 5) * 60_000;
if (USE_PROXIES) {
    console.log('=== Building proxy pool ===');
    await refillPool(PROXY_TARGET);
    if (!proxyPool.filter(p => !p.dead).length) {
        console.warn('  ⚠ no live proxies — falling back to direct connection');
    }
    // Proactive background refill: free proxies die constantly, so top the
    // pool back up every few minutes whether we asked or not. Also evicts
    // dead entries so proxyPool[] doesn't grow unboundedly.
    setInterval(async () => {
        // Garbage-collect dead entries before checking target
        const dead = proxyPool.filter(p => p.dead);
        for (const d of dead) {
            const i = proxyPool.indexOf(d);
            if (i >= 0) proxyPool.splice(i, 1);
        }
        const liveBefore = proxyPool.length;
        try { await refillPool(PROXY_TARGET); } catch (e) {
            console.warn(`\n  ⚠ scheduled refill failed: ${e.message}`);
        }
        const liveAfter = proxyPool.filter(p => !p.dead).length;
        console.log(`\n  ⟳ scheduled refill: ${liveBefore} → ${liveAfter} live (gc'd ${dead.length} dead)\n`);
    }, PROXY_REFILL_INTERVAL_MS).unref();
    console.log(`  ⟳ scheduled refills every ${PROXY_REFILL_INTERVAL_MS/60_000}min\n`);
}

// Roll the per-session 6-min window forward
function rollWindow(session) {
    const now = Date.now();
    if (now - session.windowStart >= PERIOD_MS) {
        session.windowStart = now;
        session.windowCalls = 0;
    }
}

// Try to re-auth a session in place (only ebsco-primary supports this).
// Returns true on success. Guards:
//   - min 60s between reauth attempts (no tight loop)
//   - if the newly-minted session also gets 401/403, give up — IP is blocked,
//     reauth can't help. Mark dead and let the other sessions continue.
const REAUTH_MIN_INTERVAL_MS = 60_000;
async function reauthSession(session) {
    if (session.name !== 'ebsco-primary') return false;
    const now = Date.now();
    if (session.lastReauthAt && now - session.lastReauthAt < REAUTH_MIN_INTERVAL_MS) {
        // Too soon — fresh auth from <60s ago is also failing. IP likely blocked.
        if (!session._reauthSpammed) {
            console.warn(`\n  ⏸  ${session.name} reauth on cooldown (fresh session also failing — IP likely blocked); pausing 5min`);
            session._reauthSpammed = true;
        }
        await sleep(5 * 60_000);
        session._reauthSpammed = false;
        return false;
    }
    session.lastReauthAt = now;
    try {
        await authManager.invalidateSession();
        const cookie = await authManager.getCookieHeader();
        if (cookie && cookie.length > 200) {
            session.cookie = cookie;
            session.errors = 0;
            session.windowStart = Date.now();
            session.windowCalls = 0;
            session.reauths++;
            session._postReauthAttempt = true;  // mark next call to detect loop
            console.log(`\n  ↻ ${session.name} re-authed (reauth #${session.reauths})`);
            return true;
        }
    } catch (e) {
        console.warn(`\n  ✗ ${session.name} re-auth failed: ${e.message}`);
    }
    return false;
}

// ─── M1 fetch with per-session pacing + re-auth ──────────────────────────────
async function m1Fetch(urlPath, session, attempt = 0) {
    // Quota soft cap: if this session has used 4800/5000, wait for window roll
    rollWindow(session);
    if (session.windowCalls >= QUOTA_SOFT_CAP) {
        const waitMs = (session.windowStart + PERIOD_MS) - Date.now() + 2000;
        if (waitMs > 0) {
            console.log(`\n  ⏸  ${session.name} at ${session.windowCalls}/${QUOTA_PER_PERIOD} — pausing ${Math.round(waitMs/1000)}s for window roll`);
            await sleep(waitMs);
            rollWindow(session);
        }
    }
    if (session.cooldownUntil > Date.now()) {
        await sleep(session.cooldownUntil - Date.now());
    }

    // Lease a proxy if we don't have one for this session
    if (USE_PROXIES && !session.proxy) {
        session.proxy = leaseProxy();
        if (session.proxy) {
            session.proxyRotations++;
            console.log(`\n  🔀 ${session.name} → proxy ${session.proxy.url} (rotation #${session.proxyRotations})`);
        }
    }

    const url = `${M1_BASE}${urlPath}`;
    const fetchOpts = {
        headers: {
            Accept: 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            Origin: 'https://sites.motor.com',
            Referer: 'https://sites.motor.com/m1/',
            'X-Requested-With': 'XMLHttpRequest',
            Cookie: session.cookie,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
    };
    if (session.proxy) fetchOpts.dispatcher = session.proxy.agent;

    let res;
    try {
        res = await fetch(url, fetchOpts);
    } catch (e) {
        // Proxy timeout / network failure: retire proxy, retry with a new one
        if (session.proxy && attempt < 8) {
            console.warn(`\n  ✗ proxy ${session.proxy.url} failed (${e.message}) — retiring`);
            retireProxy(session.proxy);
            session.proxy = null;
            if (proxyPool.filter(p => !p.dead).length < 5) await refillPool();
            return m1Fetch(urlPath, session, attempt + 1);
        }
        throw e;
    }
    session.calls++;
    session.windowCalls++;

    // Proxy IP banned by Motor: rotate to a fresh proxy and retry — same
    // session cookie, different exit IP. This is the whole point of the pool.
    if ((res.status === 401 || res.status === 403 || res.status === 429) && session.proxy) {
        console.warn(`\n  🔀 ${session.name}: ${res.status} via proxy ${session.proxy.url} — rotating`);
        retireProxy(session.proxy);
        session.proxy = null;
        if (proxyPool.filter(p => !p.dead).length < 5) await refillPool();
        if (attempt < 10 && leaseProxy()) {
            return m1Fetch(urlPath, session, attempt + 1);
        }
        // Pool exhausted: fall through to original handling below
    }

    // 429 = quota hit. Use x-rate-limit-reset if present, else wait full period.
    if (res.status === 429) {
        const reset = res.headers.get('x-rate-limit-reset');
        let waitMs;
        if (reset && /^\d+$/.test(reset)) {
            waitMs = Math.max(Number(reset) * 1000 - Date.now(), 5000) + 2000;
        } else {
            waitMs = PERIOD_MS + 5000;
        }
        console.warn(`\n  🚦 ${session.name} hit 429 (calls=${session.calls}) — cooldown ${Math.round(waitMs/1000)}s`);
        session.cooldownUntil = Date.now() + waitMs;
        session.windowCalls = 0;
        session.windowStart = Date.now() + waitMs;
        // After cooldown, try re-auth for ebsco-primary (refreshes the API token too)
        await sleep(waitMs);
        if (session.name === 'ebsco-primary') await reauthSession(session);
        return m1Fetch(urlPath, session, attempt + 1);
    }

    // 401/403 = session expired. Try re-auth (ebsco-primary only).
    if (res.status === 401 || res.status === 403) {
        session.errors++;
        // If we *just* re-authed and the brand-new session also returns 401/403,
        // the IP is blocked — reauth can't help. Mark dead immediately.
        if (session._postReauthAttempt) {
            session._postReauthAttempt = false;
            session.dead = true;
            console.warn(`\n  ✗ ${session.name} disabled — fresh session also rejected (IP block suspected)`);
            return { status: res.status, json: null, sessionDead: true };
        }
        if (await reauthSession(session)) {
            return m1Fetch(urlPath, session, attempt + 1);
        }
        if (session.errors >= 5) {
            session.dead = true;
            console.warn(`\n  ✗ session "${session.name}" disabled after ${session.errors} auth failures`);
        }
        return { status: res.status, json: null, sessionDead: true };
    }

    if (res.status >= 300 && res.status < 400) {
        session.dead = true;
        console.warn(`\n  ✗ session "${session.name}" redirected to ${res.headers.get('location')}`);
        return { status: res.status, json: null, sessionDead: true };
    }

    if (res.status >= 500 && attempt < 6) {
        const delay = 1000 * Math.pow(2, attempt);
        console.warn(`\n  ${res.status} on ${urlPath} (${session.name}) — retry in ${Math.round(delay/1000)}s`);
        await sleep(delay);
        return m1Fetch(urlPath, session, attempt + 1);
    }

    // Successful response: clear the post-reauth tripwire.
    session._postReauthAttempt = false;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
}

// ─── DB helpers ──────────────────────────────────────────────────────────────
async function loadYearMakePairs() {
    const filter = YEARS_FILTER ? `WHERE year = ANY($1::int[])` : '';
    const params = YEARS_FILTER ? [YEARS_FILTER] : [];
    const { rows } = await dbQuery(
        `SELECT DISTINCT year, make FROM vehicles ${filter} ORDER BY year DESC, make`,
        params
    );
    return rows;
}

async function getCachedModels(year, make) {
    if (FORCE) return null;
    const { rows } = await dbQuery(
        `SELECT data FROM vehicle_metadata WHERE path = $1`,
        [`/motor/year/${year}/make/${encodeURIComponent(make)}/models`]
    );
    return rows[0]?.data || null;
}

async function cacheModels(year, make, data) {
    if (DRY_RUN) return;
    await dbQuery(
        `INSERT INTO vehicle_metadata (path, data, updated_at) VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [`/motor/year/${year}/make/${encodeURIComponent(make)}/models`, JSON.stringify(data)]
    );
}

async function isCatalogIngested(vehicleId) {
    if (FORCE) return false;
    // articles.vehicle_id is persisted URL-encoded (e.g. "240542%3A15305")
    const { rows } = await dbQuery(
        `SELECT 1 FROM articles WHERE vehicle_id IN ($1, $2) LIMIT 1`,
        [vehicleId, encodeURIComponent(vehicleId)]
    );
    return rows.length > 0;
}

function extractVehicleIds(json) {
    const models = Array.isArray(json?.body) ? json.body : (json?.body?.models || []);
    const ids = [];
    for (const m of models) {
        for (const e of (m.engines || [])) {
            if (e.id && /^\d+:\d+$/.test(String(e.id))) ids.push(e.id);
        }
    }
    return ids;
}

// ─── Session pool ────────────────────────────────────────────────────────────
let cursor = 0;
function nextSession() {
    for (let i = 0; i < sessions.length; i++) {
        const s = sessions[(cursor + i) % sessions.length];
        if (!s.dead) { cursor = (cursor + i + 1) % sessions.length; return s; }
    }
    return null;
}

// ─── Stats ───────────────────────────────────────────────────────────────────
const stats = { yearMakes: 0, discovered: 0, ingested: 0, articles: 0, skipped: 0, errors: 0, start: Date.now() };

// ═══ Phase 1: discover M1 vehicleIds ═════════════════════════════════════════
console.log('=== Phase 1: discover M1 vehicleIds ===');
const yearMakes = await loadYearMakePairs();
console.log(`Year/make pairs: ${yearMakes.length}\n`);

const allVehicleIds = new Set();
const sessionForDiscovery = sessions.find(s => !s.dead);
if (!sessionForDiscovery) { console.error('✗ no live sessions'); process.exit(1); }

for (let i = 0; i < yearMakes.length; i++) {
    const { year, make } = yearMakes[i];
    const cached = await getCachedModels(year, make);
    if (cached) {
        for (const id of extractVehicleIds(cached)) allVehicleIds.add(id);
        stats.skipped++;
        process.stdout.write(`\r[${i+1}/${yearMakes.length}] ${year} ${make} (cached) — ${allVehicleIds.size} total       `);
        continue;
    }
    const s = nextSession();
    if (!s) { console.error('\n✗ all sessions dead'); break; }
    const urlPath = `/api/year/${year}/make/${encodeURIComponent(make)}/models`;
    const { status, json } = await m1Fetch(urlPath, s);
    if (status !== 200 || !json?.body) {
        stats.errors++;
        console.log(`\n[${i+1}/${yearMakes.length}] ${year} ${make} — ✗ status=${status}`);
        continue;
    }
    await cacheModels(year, make, json);
    const ids = extractVehicleIds(json);
    for (const id of ids) allVehicleIds.add(id);
    stats.yearMakes++;
    process.stdout.write(`\r[${i+1}/${yearMakes.length}] ${year} ${make} (+${ids.length}) — ${allVehicleIds.size} total       `);
    await sleep(DELAY_MS);
}
console.log(`\n\nDiscovered ${allVehicleIds.size} unique M1 vehicleIds`);
stats.discovered = allVehicleIds.size;

if (DRY_RUN) {
    console.log('\n[dry-run] skipping phase 2');
    process.exit(0);
}

// ═══ Phase 2: per-session catalog ingestion ══════════════════════════════════
console.log(`\n=== Phase 2: ingest catalogs (${sessions.filter(s=>!s.dead).length} live sessions) ===`);
const vehicleIdList = [...allVehicleIds].slice(0, MAX_VEHICLES);
console.log(`Targets: ${vehicleIdList.length}\n`);

let processed = 0;
let nextIdx = 0;

async function worker(session) {
    while (true) {
        if (session.dead) return;
        const idx = nextIdx++;
        if (idx >= vehicleIdList.length) return;
        const vehicleId = vehicleIdList[idx];
        try {
            if (await isCatalogIngested(vehicleId)) {
                processed++;
                stats.skipped++;
                process.stdout.write(`\r[${processed}/${vehicleIdList.length}] ${vehicleId} (cached) [${session.name}]            `);
                continue;
            }
            const urlPath = `/api/source/MOTOR/vehicle/${encodeURIComponent(vehicleId)}/articles/v2`;
            const { status, json, text, sessionDead } = await m1Fetch(urlPath, session);
            if (sessionDead) {
                // Re-queue this vehicleId
                nextIdx = Math.min(nextIdx, idx);
                vehicleIdList.push(vehicleId);
                return;
            }
            processed++;
            if (status !== 200 || !json) {
                stats.errors++;
                console.log(`\n[${processed}/${vehicleIdList.length}] ${vehicleId} ✗ status=${status} [${session.name}]`);
                continue;
            }
            const result = await ingestArticlesCatalogFromMotorJson({
                urlPath,
                rawUtf8: text,
                skipCatalogVerification: true,
            });
            if (!result.success) {
                stats.errors++;
                console.log(`\n[${processed}/${vehicleIdList.length}] ${vehicleId} ✗ ingest: ${result.error}`);
                continue;
            }
            stats.ingested++;
            stats.articles += result.articleCount || 0;
            process.stdout.write(`\r[${processed}/${vehicleIdList.length}] ${vehicleId} (+${result.articleCount}) [${session.name}]            `);
        } catch (e) {
            processed++;
            stats.errors++;
            console.log(`\n[${processed}/${vehicleIdList.length}] ${vehicleId} ✗ ${e.message} [${session.name}]`);
        }
        if (DELAY_MS) await sleep(DELAY_MS);
    }
}

// Spawn one worker per live session (extra workers per session if CONCURRENCY > sessions)
const liveSessions = sessions.filter(s => !s.dead);
const workersPerSession = Math.max(1, Math.ceil(CONCURRENCY / liveSessions.length));
const workers = [];
for (const s of liveSessions) {
    for (let i = 0; i < workersPerSession; i++) workers.push(worker(s));
}
await Promise.all(workers);
console.log();

// ═══ Summary ═════════════════════════════════════════════════════════════════
const totalSec = ((Date.now() - stats.start) / 1000).toFixed(1);
const [{ rows: aRows }, { rows: vRows }] = await Promise.all([
    dbQuery(`SELECT COUNT(*) AS n, COUNT(DISTINCT vehicle_id) AS v FROM articles`),
    dbQuery(`SELECT COUNT(*) AS n FROM vehicles WHERE is_normalized IS TRUE`),
]);
console.log(`
════════════════════════════════════════════════
Article catalog seed complete (${totalSec}s)
  Year/make pairs        : ${stats.yearMakes}
  Unique vehicleIds      : ${stats.discovered}
  Catalogs ingested      : ${stats.ingested}
  Articles fetched       : ${stats.articles}
  Skipped (completed)    : ${stats.skipped}
  Errors                 : ${stats.errors}

Per-session stats:`);
for (const s of sessions) {
    console.log(`  ${s.name.padEnd(20)} calls=${s.calls} errors=${s.errors} ${s.dead ? '(DEAD)' : ''}`);
}
console.log(`
Cloud SQL totals:
  articles               : ${aRows[0].n} (${aRows[0].v} vehicles)
  is_normalized vehicles : ${vRows[0].n}
════════════════════════════════════════════════`);

process.exit(stats.errors > 0 ? 1 : 0);
