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
    }));
})();

const CONCURRENCY = Number(arg('concurrency') || sessions.length);
console.log(`✓ Cloud SQL connected`);
console.log(`✓ Loaded ${sessions.length} session(s): ${sessions.map(s => s.name).join(', ')}`);
console.log(`  years=${YEARS_FILTER || 'all'} concurrency=${CONCURRENCY} delay=${DELAY_MS}ms max=${MAX_VEHICLES === Infinity ? 'unlimited' : MAX_VEHICLES} dry=${DRY_RUN} force=${FORCE}\n`);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Roll the per-session 6-min window forward
function rollWindow(session) {
    const now = Date.now();
    if (now - session.windowStart >= PERIOD_MS) {
        session.windowStart = now;
        session.windowCalls = 0;
    }
}

// Try to re-auth a session in place (only ebsco-primary supports this).
// Returns true on success.
async function reauthSession(session) {
    if (session.name !== 'ebsco-primary') return false;
    try {
        await authManager.invalidateSession();
        const cookie = await authManager.getCookieHeader();
        if (cookie && cookie.length > 200) {
            session.cookie = cookie;
            session.errors = 0;
            session.windowStart = Date.now();
            session.windowCalls = 0;
            session.reauths++;
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

    const url = `${M1_BASE}${urlPath}`;
    const res = await fetch(url, {
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
    });
    session.calls++;
    session.windowCalls++;

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
