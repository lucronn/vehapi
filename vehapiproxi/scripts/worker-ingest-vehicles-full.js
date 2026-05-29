#!/usr/bin/env node
/**
 * Bulk Motor ingest: L0 raw JSON under `<repo>/data/raw/…` plus L1 Supabase.
 *
 * **Surface (default)** — all catalog + reference “metadata” for the vehicle:
 *   `articles/v2?torqueCatalogSync=1` → `articles` / `content_item` (list-level fields only),
 *   fluids → `specifications`, parts → `parts`, maintenance intervals/frequency →
 *   `maintenance_schedules` + `maintenance_task`. No per-article body fetch, no `ingestMotorProxyPayloadAwait`.
 *   Catalog article ids in `ingest_tracker.json` are marked `skipped_by_policy`.
 *
 * **Corpus (opt-in)** — pass `--with-articles` to fetch each `/article/:id` payload and run full normalization
 *   (individual article artifacts + AI pipeline as configured).
 *
 * Explicit surface mode: `--metadata-only` or `--surface-only` (same as default; ignores `--with-articles` if both given).
 * Env: `WORKER_INGEST_METADATA_ONLY=1` enables the same.
 *
 * Requires local or remote vehapiproxi (`--base=`). Loads `vehapiproxi/.env` + cwd `.env`.
 *
 * Example (surface):
 *   cd vehapiproxi && npm run worker:ingest-surface -- --base=http://localhost:3001 --limit=2
 *
 * Example (continuous metadata ingest, skip already-done vehicles): `npm run worker:ingest-loop -- --base=http://localhost:3001 --resume`
 *
 * Progress UI: `npm run ingest:dashboard` then http://127.0.0.1:3847/ (reads each vehicle's `data/raw/MOTOR/<sanitized-engine>/ingest_tracker.json`).
 *
 * Env: RELAXED_COMPLETION=true softens catalog L1 COUNT verification (prefer CLI `--relaxed-completion`).
 * Motor churn: proxy 401/403 + `authStatus: authenticating` → `fetchSave` backoff, then **`GET /auth/status`** until
 * `sessionValid` (optional **`POST /auth/start`** / **`POST /auth/reset`**). Tune **`WORKER_INGEST_AUTH_WAIT_MS`**,
 * **`WORKER_INGEST_AUTH_POLL_MS`**. Churn retries: **`WORKER_PROXY_SESSION_CHURN_*`**, **`--proxy-session-churn-*`**.
 * **`--continuous`**: loop CSV passes forever; **`--loop-gap-ms`** between passes; **`SIGINT`** / **`SIGTERM`**
 * to stop after current vehicle (`WORKER_INGEST_CONTINUOUS=1`). Prefer **`--resume`** with loops.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import pLimit from 'p-limit';

import { ingestArticlesCatalogFromMotorJson } from '../src/ingest/ingest_articles_catalog.js';
import {
    upsertFluidsFromMotorBody,
    upsertPartsFromMotorBody,
    upsertMaintenanceIntervalFromMotorBody,
    upsertMaintenanceFrequencyFromMotorBody
} from '../src/ingest/reference_data_ingest.js';
import { isDbConfigured } from '../src/db.js';
import { checkParsedArticle } from '../src/db.service.js';
import { ingestMotorProxyPayloadAwait } from '../src/background_worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config();

const REPO_ROOT_DEFAULT = path.resolve(__dirname, '..', '..');

const MaintIntervalsMi = [7500, 15000, 30000, 45000, 60000, 100000];
const MaintFreqCodes = ['F', 'N', 'R'];

const SCHEMA_VERSION = 1;

function motorSessionBudget() {
    const n = Number.parseInt(
        String(argvVal('session-budget', process.env.WORKER_MOTOR_SESSION_BUDGET || '4800') || '4800'),
        10
    );
    return Number.isFinite(n) && n > 0 ? n : 4800;
}

function argvFlag(name, def = false) {
    const hit = process.argv.some((a) => a === `--${name}` || a.startsWith(`${name}=`));
    if (!def && hit) return true;
    return def ? !process.argv.includes(`--no-${name}`) : hit;
}

function argvVal(name, fallback = '') {
    const p = `--${name}=`;
    const eq = process.argv.find((a) => a.startsWith(p));
    if (eq) return eq.slice(p.length);
    const u = `--${name}`;
    const ix = process.argv.indexOf(u);
    if (ix >= 0 && process.argv[ix + 1]) return process.argv[ix + 1];
    return process.env[name.replace(/-/g, '_').toUpperCase()] || fallback;
}

function sanitizeVehicleDir(id) {
    return String(id).replace(/[^\w\-.,@+]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 240);
}

/** Aligns with `motorVehicleRoute` in `motor-api.service.ts`. */
function motorProxyRoute(row) {
    const engineId = String(row.engine_id || '').trim();
    const cs = row.content_source || 'MOTOR';
    if (engineId.includes(':')) {
        return { pathSource: 'MOTOR', pathVehicleId: engineId, motorVehicleQuery: '' };
    }
    return { pathSource: cs, pathVehicleId: engineId, motorVehicleQuery: '' };
}

function parseCsvEngines(csvText) {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const header = lines[0].split(',');
    const idxEngine = header.indexOf('engine_id');
    const idxCs = header.indexOf('content_source');
    if (idxEngine < 0) throw new Error('CSV missing engine_id column');

    /** @type {{ engine_id: string, content_source: string }[]} */
    const rows = [];
    const seen = new Set();
    for (let li = 1; li < lines.length; li++) {
        const line = lines[li];
        if (!line.trim()) continue;
        const cells = [];
        let cur = '';
        let q = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"' && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else if (c === '"') q = !q;
            else if (c === ',' && !q) {
                cells.push(cur);
                cur = '';
            } else cur += c;
        }
        cells.push(cur);
        const engineId = (cells[idxEngine] || '').trim();
        if (!engineId || seen.has(engineId)) continue;
        seen.add(engineId);
        const contentSource =
            idxCs >= 0 && cells[idxCs] ? String(cells[idxCs]).trim() : 'MOTOR';
        rows.push({ engine_id: engineId, content_source: contentSource || 'MOTOR' });
    }
    return rows;
}

async function atomicWriteJson(filePath, obj) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const text = `${JSON.stringify(obj, null, 2)}\n`;
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, filePath);
}

async function appendManifest(dir, entry) {
    const p = path.join(dir, 'manifest.json');
    let doc = {
        entries: [],
        vehicle_id: dir,
        updated_at: new Date().toISOString()
    };
    try {
        const raw = await fs.readFile(p, 'utf8');
        doc = JSON.parse(raw);
    } catch {
        /* fresh */
    }
    doc.entries = doc.entries || [];
    doc.entries.push({
        ts: new Date().toISOString(),
        ...entry
    });
    doc.updated_at = new Date().toISOString();
    await atomicWriteJson(p, doc);
}

let requestCount = 0;
let _rotationInProgress = false;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** When Motor rejects cookies, proxy maps 401/403 to JSON with authStatus (see function.js response interceptor). */
function shouldRetryMotorSessionChurn(httpStatus, buf) {
    if ((httpStatus !== 401 && httpStatus !== 403) || !buf?.length) return false;
    const text = buf.toString('utf8').trim();
    if (!text.startsWith('{')) return false;
    try {
        const j = JSON.parse(text);
        if (j.authStatus === 'authenticating') return true;
        if (String(j.message || '').includes('Authentication in progress')) return true;
        return false;
    } catch {
        return false;
    }
}

function motorSessionChurnRetryParams() {
    const extra = Number.parseInt(
        String(
            argvVal('proxy-session-churn-retries', process.env.WORKER_PROXY_SESSION_CHURN_RETRIES || '5')
        ),
        10
    );
    const delayMs = Number.parseInt(
        String(
            argvVal('proxy-session-churn-delay-ms', process.env.WORKER_PROXY_SESSION_CHURN_DELAY_MS || '4000')
        ),
        10
    );
    return {
        maxAttempts: Math.max(1, 1 + Math.max(0, Number.isFinite(extra) ? extra : 5)),
        delayMs: Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 4000
    };
}

function authPollParams() {
    const waitMs = Number.parseInt(
        String(argvVal('auth-wait-ms', process.env.WORKER_INGEST_AUTH_WAIT_MS || '180000')),
        10
    );
    const pollMs = Number.parseInt(
        String(argvVal('auth-poll-ms', process.env.WORKER_INGEST_AUTH_POLL_MS || '2000')),
        10
    );
    return {
        waitMs: Number.isFinite(waitMs) && waitMs > 0 ? waitMs : 180000,
        pollMs: Number.isFinite(pollMs) && pollMs >= 300 ? pollMs : 2000
    };
}

/** Poll **`GET /auth/status`** until `sessionValid`, with **`POST /auth/start`** and optional **`POST /auth/reset`**. */
async function ensureMotorProxySessionReady(baseUrl, log = null) {
    const root = baseUrl.replace(/\/$/, '');
    const statusUrl = `${root}/auth/status`;
    const { waitMs, pollMs } = authPollParams();
    const deadline = Date.now() + waitMs;
    let triggeredStart = false;
    let triggeredReset = false;

    while (Date.now() < deadline) {
        /** @type {any} */
        let body = null;
        try {
            const r = await fetch(statusUrl, { headers: { Accept: 'application/json' } });
            if (r.ok) body = await r.json().catch(() => null);
        } catch {
            /* transient */
        }
        if (body?.sessionValid) {
            log?.('[ingest-worker] Motor proxy session valid\n');
            return true;
        }

        const st = String(body?.status ?? '');

        if (st === 'authenticating') {
            await sleep(pollMs);
            continue;
        }
        if (st === 'error' && !triggeredReset) {
            triggeredReset = true;
            log?.('[ingest-worker] Motor proxy auth error — POST /auth/reset …\n');
            try {
                await fetch(`${root}/auth/reset`, { method: 'POST', headers: { Accept: 'application/json' } });
            } catch {
                /* ignore */
            }
            await sleep(Math.min(10000, Math.max(pollMs * 3, 5000)));
            continue;
        }

        if (!triggeredStart) {
            triggeredStart = true;
            log?.('[ingest-worker] Motor proxy session missing — POST /auth/start …\n');
            try {
                await fetch(`${root}/auth/start`, { method: 'POST', headers: { Accept: 'application/json' } });
            } catch {
                /* ignore */
            }
            await sleep(pollMs);
            continue;
        }

        await sleep(pollMs);
    }

    log?.(`[ingest-worker] WARN: timed out (${waitMs}ms) waiting for Motor proxy session\n`);
    return false;
}

/** Serialize churn recovery when many `fetchSave` calls overlap. */
let motorRecoverChain = Promise.resolve();

function coalesceMotorRecovery(baseUrl) {
    motorRecoverChain = motorRecoverChain.then(() =>
        ensureMotorProxySessionReady(baseUrl, (msg) => process.stderr.write(msg))
    );
    return motorRecoverChain;
}

async function checkSessionCycle(baseUrl, delayMs) {
    const cap = motorSessionBudget();
    if (!cap || requestCount < cap) return;
    if (_rotationInProgress) {
        // Another concurrent task is already rotating — wait for it to finish
        await new Promise((r) => setTimeout(r, 15000));
        return;
    }
    _rotationInProgress = true;
    requestCount = 0;
    process.stderr.write(
        `[ingest-worker] Motor session rotation after ${cap} proxy requests...\n`
    );
    try {
        await fetch(`${baseUrl.replace(/\/$/, '')}/auth/reset`, { method: 'POST' });
        await new Promise((r) => setTimeout(r, delayMs >= 8000 ? delayMs : 10000));
    } catch (e) {
        process.stderr.write(`[ingest-worker] /auth/reset failed: ${e?.message}\n`);
    }
    _rotationInProgress = false;
}

/**
 * @param {{
 * baseUrl: string,
 * relPathQuery: string,
 * filePathRelative: string,
 * absDir: string,
 * headers: Record<string,string>,
 * dryRunManifestOnly?: boolean
 * }} _
 */
async function fetchSave({ baseUrl, relPathQuery, filePathRelative, absDir, headers }) {
    const url = `${baseUrl.replace(/\/$/, '')}${relPathQuery.startsWith('/') ? '' : '/'}${relPathQuery}`;
    const { maxAttempts, delayMs } = motorSessionChurnRetryParams();

    let res;
    /** @type {Buffer | null} */
    let buf = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await checkSessionCycle(baseUrl, 10000);
        requestCount++;

        try {
            res = await fetch(url, { headers });
            buf = Buffer.from(await res.arrayBuffer());
        } catch (e) {
            const err = /** @type {Error} */ (e);
            await appendManifest(absDir, {
                url,
                http_status: 0,
                error: err.message || String(err),
                bytes: 0,
                saved_path: filePathRelative
            });
            return { ok: false, status: 0, buf: null, url };
        }

        const churn = shouldRetryMotorSessionChurn(res.status, buf);
        if (churn && attempt < maxAttempts - 1) {
            process.stderr.write(
                `[ingest-worker] HTTP ${res.status} Motor/proxy session churn (attempt ${attempt + 1}/${maxAttempts}); ` +
                    `waiting ${delayMs}ms for re-auth…\n`
            );
            await sleep(delayMs);
            await coalesceMotorRecovery(baseUrl);
            continue;
        }

        const fullPath = path.join(absDir, filePathRelative);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, buf);

        const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
        await appendManifest(absDir, {
            url,
            http_status: res.status,
            sha256,
            bytes: buf.length,
            saved_path: filePathRelative
        });
        return { ok: res.ok, status: res.status, buf, url };
    }

    return { ok: false, status: 0, buf: null, url };
}

async function aiLogLatestStatus(normPathRaw) {
    if (!isDbConfigured()) return null;
    const { dbQuery: pgQuery } = await import('../src/db.js');
    /** @see normalizeSourcePathForDedup — trim /html duplicate */
    const norm =
        typeof normPathRaw === 'string'
            ? normPathRaw.replace(/(\/article\/[^/?]+)\/html$/i, '$1')
            : '';
    const variants = [...new Set([normPathRaw, norm].filter(Boolean))];
    for (const vp of variants) {
        try {
            const { rows } = await pgQuery(
                `SELECT status, processed_at, error_message FROM ai_processing_logs WHERE source_file = $1 ORDER BY processed_at DESC LIMIT 1`,
                [vp]
            );
            if (rows[0]?.status) return rows[0].status;
        } catch {
            /* continue */
        }
    }
    return null;
}

function defaultTrackerSkeleton(vehicleId, contentSource, runId, routingMotorVehicleId) {
    /** @type {Record<string, any>} */
    const scopes = {
        catalog: { state: 'pending', verify_ok: false, last_error: null },
        reference_fluids: { state: 'pending', verify_ok: false, last_error: null },
        reference_parts: { state: 'pending', verify_ok: false, last_error: null }
    };
    for (const mi of MaintIntervalsMi) {
        scopes[`reference_maintenance_interval_${mi}`] = {
            state: 'pending',
            verify_ok: false,
            last_error: null,
            meta: { miles: mi }
        };
    }
    for (const code of MaintFreqCodes) {
        scopes[`reference_maintenance_frequency_${code}`] = {
            state: 'pending',
            verify_ok: false,
            last_error: null,
            meta: { code }
        };
    }

    return {
        schema_version: SCHEMA_VERSION,
        vehicle_id: vehicleId,
        content_source: contentSource,
        routing: {
            engine_id: vehicleId,
            content_source_wizard: contentSource,
            motor_vehicle_id_query: routingMotorVehicleId || null
        },
        run_id: runId,
        updated_at: new Date().toISOString(),
        scopes,
        articles: {},
        summary: {
            catalog_complete: false,
            corpus_articles_normalized: 0,
            corpus_articles_total: 0
        }
    };
}

function summarizeTracker(t, quiet = false, mode = 'corpus') {
    if (quiet) return;
    const arts = t.articles || {};
    const total = Object.keys(arts).length;
    let norm = 0;
    let skipped = 0;
    for (const v of Object.values(arts)) {
        const row = /** @type {any} */ (v);
        if (row.status === 'normalized') norm++;
        if (row.status === 'skipped_by_policy') skipped++;
    }
    const cat = /** @type {any} */ (t.scopes?.catalog || {});
    if (mode === 'surface') {
        process.stderr.write(
            `tracker: catalog=${cat.state}${cat.verify_ok ? '(ok)' : ''} ` +
                `corpus=off (surface) catalog_rows=${total} skipped_by_policy=${skipped}\n`
        );
        return;
    }
    process.stderr.write(
        `tracker: catalog=${cat.state}${cat.verify_ok ? '(ok)' : ''} corpus=${norm}/${total} normalized\n`
    );
}

async function ingestOneVehicle(opts) {
    const {
        baseUrl,
        outRoot,
        engineId,
        contentSource,
        runId,
        dryRun,
        resume,
        retryFailed,
        quiet = false,
        withArticles,
        articleConcurrency,
        relaxedCompletion,
        token,
        pathSource,
        pathVehicleId,
        motorVehicleQuery,
        delayMs,
        forceCatalog,
        forceArticleId
    } = opts;

    const safeDir = sanitizeVehicleDir(engineId);
    const log = (msg) => {
        if (!quiet) process.stderr.write(msg);
    };

    /** L0 layout: `data/raw/MOTOR/<safeId>/` (plan); CSV `content_source` is still recorded on the tracker. */
    const absDir = path.join(outRoot, 'MOTOR', safeDir);

    /** @type {Record<string,string>} */
    const headers = {
        Accept: 'application/json, text/plain, */*',
        'x-vehapi-verify': '1',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    };

    let trackerPath = path.join(absDir, 'ingest_tracker.json');
    /** @type {any} */
    let tracker;

    try {
        tracker = JSON.parse(await fs.readFile(trackerPath, 'utf8'));
        if (
            tracker.schema_version !== SCHEMA_VERSION ||
            typeof tracker !== 'object' ||
            tracker.vehicle_id !== engineId
        ) {
            tracker = defaultTrackerSkeleton(engineId, contentSource, runId, motorVehicleQuery || '');
        }
    } catch {
        tracker = defaultTrackerSkeleton(engineId, contentSource, runId, motorVehicleQuery || '');
    }

    tracker.run_id = runId;
    tracker.updated_at = new Date().toISOString();
    tracker.routing = tracker.routing || {};
    tracker.routing.proxy_path_source = pathSource;
    tracker.routing.proxy_path_vehicle_id = pathVehicleId;

    // retryFailed resets article-level failures only. Scope failures (catalog, reference_*)
    // are typically subscription 403s that won't heal by retrying; leave them unchanged.
    // (Articles with skipped_by_policy are handled by the article filter logic below.)

    const mvExtra =
        motorVehicleQuery && String(motorVehicleQuery).trim().length > 0
            ? `motorVehicleId=${encodeURIComponent(String(motorVehicleQuery).trim())}`
            : '';

    const qp = encodeURIComponent(pathSource);
    const qv = encodeURIComponent(pathVehicleId);

    const withMvQs = mvExtra ? `?${mvExtra}` : '';

    // --- Catalog
    const catalogState = tracker.scopes.catalog?.state;
    // With --resume, skip failed catalogs — subscription 403s won't heal by retrying.
    // retryFailed only applies to article-level failures, not catalog-level.
    let catalogSkipped = resume && !forceCatalog && (
        catalogState === 'complete' || catalogState === 'failed'
    );
    if (!catalogSkipped) {
        tracker.scopes.catalog.state = 'fetched';
        await atomicWriteJson(trackerPath = path.join(absDir, 'ingest_tracker.json'), tracker);

        const relArticles = `/api/source/${qp}/vehicle/${qv}/articles/v2${
            mvExtra ? `?${mvExtra}` : ''
        }`;
        const r = await fetchSave({
            baseUrl,
            relPathQuery: relArticles,
            filePathRelative: 'articles_v2.json',
            absDir,
            headers: { ...headers, Accept: 'application/json' }
        });

        if (delayMs > 0) await sleep(delayMs);

        if (!r.buf || !(r.ok || r.status === 429)) {
            tracker.scopes.catalog.state = 'failed';
            tracker.scopes.catalog.last_error = `HTTP ${r.status} ${relArticles}`;
            await atomicWriteJson(trackerPath, tracker);
            return { ok: false, error: tracker.scopes.catalog.last_error };
        }
        if (!r.ok && r.status === 429) {
            tracker.scopes.catalog.state = 'rate_limited';
            tracker.scopes.catalog.last_error = 'HTTP 429';
            await atomicWriteJson(trackerPath, tracker);
            return { ok: false, error: tracker.scopes.catalog.last_error };
        }

        const rawUtf8 = r.buf.toString('utf8');
        const ingestRes = await ingestArticlesCatalogFromMotorJson({
            urlPath: `/api/source/${pathSource}/vehicle/${pathVehicleId}/articles/v2`,
            rawUtf8,
            dryRun,
            skipCatalogVerification: relaxedCompletion
        });

        if (!ingestRes.success) {
            tracker.scopes.catalog.state = 'failed';
            tracker.scopes.catalog.last_error = ingestRes.error || 'catalog ingest';
            await atomicWriteJson(trackerPath, tracker);
            return { ok: false, error: ingestRes.error };
        }

        tracker.scopes.catalog.state = 'complete';
        tracker.scopes.catalog.verify_ok = !relaxedCompletion;
        tracker.scopes.catalog.last_error = null;
        tracker.summary.catalog_complete = true;

        // Seed article map (strict status machine)
        let parsed;
        try {
            parsed = JSON.parse(rawUtf8);
        } catch {
            parsed = null;
        }
        const details = parsed?.body?.articleDetails;
        if (Array.isArray(details)) {
            for (const a of details) {
                const id = a?.id != null ? String(a.id).trim() : '';
                if (!id) continue;
                const prev = tracker.articles[id] || {};
                if (prev.status === 'normalized' && !retryFailed && !forceArticleId) {
                    tracker.articles[id] = prev;
                    continue;
                }
                if (forceArticleId && forceArticleId !== id) continue;
                if (resume && prev.status === 'normalized' && !retryFailed && !forceArticleId) continue;
                if (resume && prev.status === 'failed' && !retryFailed && !forceArticleId) continue;
                tracker.articles[id] = {
                    ...(typeof prev === 'object' ? prev : {}),
                    title: String(a.title || ''),
                    status:
                        retryFailed &&
                        (prev.status === 'failed' ||
                            prev.status === 'stuck_normalize' ||
                            prev.status === 'rate_limited')
                            ? 'pending'
                            : prev.status &&
                                ['verifying', 'normalized', 'fetched'].includes(prev.status)
                              ? prev.status
                              : 'pending',
                    last_error: retryFailed ? null : prev.last_error || null,
                    incomplete_reason: null
                };
            }
        }

        tracker.summary.corpus_articles_total = Object.keys(tracker.articles).length;

        await atomicWriteJson(path.join(absDir, 'ingest_tracker.json'), tracker);
    } else if (resume) {
        log(`[resume] skipping catalog (${engineId}) [${catalogState}]\n`);
    }

    try {
        tracker = JSON.parse(await fs.readFile(path.join(absDir, 'ingest_tracker.json'), 'utf8'));
        tracker.summary = tracker.summary || {};
        tracker.summary.corpus_articles_total = Object.keys(tracker.articles || {}).length;
    } catch {
        /* missing */
    }

    // --- Reference data
    const refSpecs = [];

    const runRef = async (scopeKey, relPath, fileName, fn) => {
        if (resume && tracker.scopes[scopeKey]?.state === 'complete') {
            log(`[resume] skip ${scopeKey}\n`);
            return;
        }
        // Don't retry reference scopes for catalog-failed vehicles — same subscription block applies.
        if (resume && catalogState === 'failed') {
            log(`[resume] skip ${scopeKey}\n`);
            return;
        }
        tracker.scopes[scopeKey] = tracker.scopes[scopeKey] || { state: 'pending' };
        tracker.scopes[scopeKey].state = 'fetched';
        await atomicWriteJson(path.join(absDir, 'ingest_tracker.json'), tracker);

        const fr = await fetchSave({
            baseUrl,
            relPathQuery: relPath,
            filePathRelative: fileName,
            absDir,
            headers: { ...headers, Accept: 'application/json' }
        });
        if (!fr.ok) {
            tracker.scopes[scopeKey].state = 'failed';
            tracker.scopes[scopeKey].last_error = `HTTP ${fr.status} ${relPath}`;
            await atomicWriteJson(path.join(absDir, 'ingest_tracker.json'), tracker);
            if (!relaxedCompletion) throw new Error(tracker.scopes[scopeKey].last_error);
            return;
        }
        const bodyText = (fr.buf || Buffer.from('')).toString('utf8');
        let bodyJson;
        try {
            bodyJson = JSON.parse(bodyText);
        } catch {
            bodyJson = bodyText;
        }
        if (dryRun) {
            tracker.scopes[scopeKey].state = 'complete';
            tracker.scopes[scopeKey].verify_ok = false;
            await atomicWriteJson(path.join(absDir, 'ingest_tracker.json'), tracker);
            return;
        }
        const up = await fn(bodyJson);
        if (!up.success) {
            tracker.scopes[scopeKey].state = 'failed';
            tracker.scopes[scopeKey].last_error = String(up.error || 'upsert');
            await atomicWriteJson(path.join(absDir, 'ingest_tracker.json'), tracker);
            if (!relaxedCompletion) throw new Error(tracker.scopes[scopeKey].last_error);
            return;
        }
        tracker.scopes[scopeKey].state = 'complete';
        tracker.scopes[scopeKey].verify_ok = true;
        tracker.scopes[scopeKey].last_error = null;
        refSpecs.push({ scopeKey, count: up.count });
        await atomicWriteJson(path.join(absDir, 'ingest_tracker.json'), tracker);
    };

    // Run each reference scope independently so one failure doesn't abort the rest.
    // Errors are collected; if any failed and !relaxedCompletion, we return after all scopes run.
    const refErrors = [];
    const safeRunRef = async (...args) => {
        try { await runRef(...args); } catch (e) { refErrors.push(/** @type {Error} */ (e).message); }
    };

    const colonIdx = engineId.indexOf(':');
    const fluidsQs =
        colonIdx > 0
            ? `?baseVehicleId=${encodeURIComponent(engineId.slice(0, colonIdx))}&engineId=${encodeURIComponent(engineId.slice(colonIdx + 1))}`
            : withMvQs;
    const fluidsPath = `/api/source/${qp}/vehicle/${qv}/fluids${fluidsQs}`;
    await safeRunRef('reference_fluids', fluidsPath, 'fluids.json', (b) =>
        upsertFluidsFromMotorBody(engineId, b, { dryRun: false })
    );

    const partsPath = `/api/source/${qp}/vehicle/${qv}/parts${withMvQs}`;
    await safeRunRef('reference_parts', partsPath, 'parts.json', (b) =>
        upsertPartsFromMotorBody(engineId, b, { dryRun: false })
    );

    for (const mi of MaintIntervalsMi) {
        const sk = `reference_maintenance_interval_${mi}`;
        const qMs = mvExtra
            ? `intervalType=Miles&interval=${mi}&searchTerm=&${mvExtra}`
            : `intervalType=Miles&interval=${mi}&searchTerm=`;
        const q =
            `/api/source/${qp}/vehicle/${qv}/maintenanceSchedules/intervals` + `?${qMs}`;
        await safeRunRef(sk, q, `maintenance_interval_${mi}.json`, (b) =>
            upsertMaintenanceIntervalFromMotorBody(engineId, mi, b, { dryRun: false })
        );
    }

    for (const code of MaintFreqCodes) {
        const sk = `reference_maintenance_frequency_${code}`;
        const qFreq = mvExtra
            ? `frequencyTypeCode=${code}&severity=All&searchTerm=&${mvExtra}`
            : `frequencyTypeCode=${code}&severity=All&searchTerm=`;
        const q =
            `/api/source/${qp}/vehicle/${qv}/maintenanceSchedules/frequency` + `?${qFreq}`;
        await safeRunRef(sk, q, `maintenance_frequency_${code}.json`, (b) =>
            upsertMaintenanceFrequencyFromMotorBody(engineId, code, b, { dryRun: false })
        );
    }

    if (refErrors.length && !relaxedCompletion) {
        return { ok: false, error: refErrors.join('; ') };
    }

    // --- Corpus
    try {
        tracker = JSON.parse(await fs.readFile(path.join(absDir, 'ingest_tracker.json'), 'utf8'));
    } catch {
        return { ok: false, error: `missing ingest_tracker (${engineId}) — run catalog first` };
    }

    // Skip corpus pass for vehicles where catalog access was denied — articles won't be fetchable either.
    if (resume && tracker.scopes?.catalog?.state === 'failed') {
        summarizeTracker(tracker, quiet, 'surface');
        return { ok: true };
    }

    if (!withArticles) {
        for (const k of Object.keys(tracker.articles || {})) {
            const row = tracker.articles[k];
            if (row && row.status === 'pending') {
                tracker.articles[k] = {
                    ...row,
                    status: 'skipped_by_policy'
                };
            }
        }
        tracker.summary.corpus_articles_normalized = Object.values(tracker.articles || {}).filter(
            /** @returns {boolean} */
            (a) =>
                typeof a === 'object' &&
                a !== null &&
                /** @type {any} */ (a).status === 'normalized'
        ).length;
        await atomicWriteJson(path.join(absDir, 'ingest_tracker.json'), tracker);
        summarizeTracker(tracker, quiet, 'surface');
        return { ok: true };
    }

    if (forceArticleId) {
        tracker.articles = tracker.articles || {};
        tracker.articles[forceArticleId] = {
            ...(tracker.articles[forceArticleId] || {}),
            title: String(tracker.articles[forceArticleId]?.title || ''),
            status: 'pending'
        };
        await atomicWriteJson(path.join(absDir, 'ingest_tracker.json'), tracker);
    }

    const articleLimit = pLimit(Math.max(1, articleConcurrency));

    // Serialize tracker writes: concurrent article tasks share the same tracker object.
    // Without serialization, concurrent atomicWriteJson calls can race — the rename of
    // an older snapshot can overwrite a newer one. Chain writes through a single promise.
    const trackerFilePath = path.join(absDir, 'ingest_tracker.json');
    let _writeChain = Promise.resolve();
    const writeTracker = () => {
        _writeChain = _writeChain.then(() => atomicWriteJson(trackerFilePath, tracker));
        return _writeChain;
    };

    /** @type {string[]} */
    const ids = forceArticleId
        ? [forceArticleId]
        : Object.keys(tracker.articles || {}).filter((id) => {
              const row = tracker.articles[id];
              const st = row?.status || 'pending';
              if (retryFailed && (st === 'failed' || st === 'stuck_normalize' || st === 'skipped_by_policy')) return true;
              if (resume && (st === 'normalized' || st === 'skipped_by_policy')) {
                  return false;
              }
              return st !== 'normalized';
          });

    let normalized = 0;

    const tasks = ids.map((articleId) =>
        articleLimit(async () => {
            const urlPath = `/api/source/${pathSource}/vehicle/${pathVehicleId}/article/${encodeURIComponent(articleId)}`;
            const fr = await fetchSave({
                baseUrl,
                relPathQuery: `${urlPath}${withMvQs}`,
                filePathRelative: `article_${sanitizeVehicleDir(articleId)}.json`,
                absDir,
                headers: { ...headers, Accept: 'application/json' }
            });

            if (fr.status === 429) {
                tracker.articles[articleId] = {
                    ...tracker.articles[articleId],
                    status: 'rate_limited',
                    last_error: 'HTTP 429'
                };
                await writeTracker();
                await new Promise((r) => setTimeout(r, delayMs * 5));
                return;
            }

            if (!fr.ok || !fr.buf) {
                tracker.articles[articleId] = {
                    ...tracker.articles[articleId],
                    status: 'failed',
                    last_error: `fetch ${fr.status}`
                };
                await writeTracker();
                return;
            }

            const raw = fr.buf.toString('utf8');
            tracker.articles[articleId] = {
                ...tracker.articles[articleId],
                status: 'fetched',
                raw_path: `article_${sanitizeVehicleDir(articleId)}.json`,
                content_sha256: crypto.createHash('sha256').update(fr.buf).digest('hex')
            };
            await writeTracker();

            if (dryRun) return;

            tracker.articles[articleId].status = 'verifying';
            await writeTracker();

            const taskId = `cli-${crypto.randomBytes(6).toString('hex')}`;
            try {
                const outcome = await ingestMotorProxyPayloadAwait(urlPath, raw, { taskId });
                if (outcome.status !== 'COMPLETED') {
                    throw new Error(outcome.errorMessage || outcome.status || 'ingest incomplete');
                }
            } catch (e) {
                tracker.articles[articleId] = {
                    ...tracker.articles[articleId],
                    status: 'failed',
                    last_error: /** @type {Error} */ (e).message || String(e)
                };
                await writeTracker();
                return;
            }

            if (relaxedCompletion) {
                const parsedRow = await checkParsedArticle(articleId);
                tracker.articles[articleId] = {
                    ...tracker.articles[articleId],
                    status: parsedRow ? 'normalized' : 'failed',
                    last_error: parsedRow ? null : 'relaxed: no L1 row',
                    verify_stamp: new Date().toISOString()
                };
            } else {
                const st = await aiLogLatestStatus(urlPath);
                const parsedRow = await checkParsedArticle(articleId);
                const ok = st === 'COMPLETED' && parsedRow;

                tracker.articles[articleId] = {
                    ...tracker.articles[articleId],
                    status: ok ? 'normalized' : 'stuck_normalize',
                    last_error:
                        ok
                            ? null
                            : `ai_log=${st || 'NONE'} parsed=${parsedRow ? 'yes' : 'no'}`,
                    verify_stamp: new Date().toISOString(),
                    incomplete_reason: ok ? null : ['COMPLETED+L1_ROW']
                };
            }

            await writeTracker();
            await new Promise((r) => setTimeout(r, delayMs));
        })
    );

    await Promise.all(tasks);

    try {
        tracker = JSON.parse(await fs.readFile(path.join(absDir, 'ingest_tracker.json'), 'utf8'));
        normalized = Object.values(tracker.articles || {}).filter(
            /** @returns {boolean} */ (row) =>
                typeof row === 'object' &&
                /** @type {any} */ (row).status === 'normalized'
        ).length;

        tracker.summary.corpus_articles_normalized = normalized;
        tracker.updated_at = new Date().toISOString();
        await atomicWriteJson(path.join(absDir, 'ingest_tracker.json'), tracker);
    } catch {
        /* best-effort summary */
    }

    summarizeTracker(tracker, quiet, 'corpus');

    return { ok: true };
}

async function main() {
    const runId =
        argvVal('run-id') ||
        (typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `run-${crypto.randomBytes(8).toString('hex')}`);

    let vehiclesFile =
        argvVal('vehicles-file') ||
        argvVal('csv') ||
        path.resolve(__dirname, '..', 'motor-ymme-full.csv');
    vehiclesFile =
        typeof vehiclesFile === 'string' &&
        !(vehiclesFile.startsWith('/') || vehiclesFile.includes(':\\')) &&
        /^\.|^\.\.\/|^_/.test(vehiclesFile)
            ? path.resolve(process.cwd(), vehiclesFile)
            : path.resolve(vehiclesFile);

    const baseUrl = argvVal('base') || argvVal('ingest-base') || 'http://localhost:3001';

    /** Default repo-root `data/raw` regardless of cwd */
    const outRootRaw = argvVal('out-dir', path.join(REPO_ROOT_DEFAULT, 'data', 'raw'));
    const outRoot = path.isAbsolute(outRootRaw)
        ? outRootRaw
        : path.resolve(REPO_ROOT_DEFAULT, outRootRaw);

    const limitN = argvVal('limit');
    const offsetN = argvVal('offset');
    const shardRaw = argvVal('shard', '');   // e.g. "0/8" → take every 8th vehicle starting at index 0
    const [shardIdx, shardCount] = shardRaw.includes('/')
        ? shardRaw.split('/').map(Number)
        : [0, 1];
    const quiet = argvFlag('quiet', false);
    const say = (msg) => {
        if (!quiet) process.stderr.write(msg);
    };

    const envSurface =
        String(process.env.WORKER_INGEST_METADATA_ONLY || '').trim() === '1' ||
        String(process.env.WORKER_INGEST_SURFACE_ONLY || '').trim() === '1';
    const metadataOnly =
        envSurface || argvFlag('metadata-only', false) || argvFlag('surface-only', false);
    let withArticles = argvFlag('with-articles', false);
    if (metadataOnly && withArticles) {
        say('[worker-ingest-full] ignoring --with-articles (--metadata-only / --surface-only active)\n');
        withArticles = false;
    }
    if (metadataOnly) {
        say('[worker-ingest-full] mode=surface (catalog + reference; no per-article corpus)\n');
    }

    const relaxedCompletion = argvFlag('relaxed-completion', false);
    const retryFailed = argvFlag('retry-failed', false);
    const resume = argvFlag('resume', false);
    const autoResetFailed = argvFlag('auto-reset-failed', false);
    const dryRun = argvFlag('dry-run', false);
    const delayMs =
        Number(argvVal('delay-ms') || argvVal('delay') || process.env.INGEST_DELAY_MS || '50') || 50;
    const articleConcurrency =
        Number(argvVal('article-concurrency', '3')) ||
        Number.parseInt(process.env.ARTICLE_CONCURRENCY || '3', 10) ||
        3;
    const token = argvVal('token') || process.env.SYNC_AUTH_BEARER || '';
    const motorVm = argvVal('motor-vehicle-id') || '';
    say(`[worker-ingest-full] base=${baseUrl}\n`);
    say(`[worker-ingest-full] out=${outRoot} csv=${vehiclesFile}\n`);
    if (relaxedCompletion) {
        say('[worker-ingest-full] RELAXED completion (debug — not for CI)\n');
    }
    if (dryRun) say('[worker-ingest-full] DRY-RUN (no Supabase writes)\n');

    if (relaxedCompletion) {
        process.env.RELAXED_COMPLETION = '1';
    }

    const forceCatalog = argvFlag('force-catalog', false);
    const forceArticleId = argvVal('force-article') || '';

    const continuous =
        argvFlag('continuous', false) ||
        String(process.env.WORKER_INGEST_CONTINUOUS || '').trim() === '1';
    const loopGapParsed = Number.parseInt(
        String(argvVal('loop-gap-ms', process.env.WORKER_LOOP_GAP_MS || '5000')),
        10
    );
    const loopGapMs = Number.isFinite(loopGapParsed) && loopGapParsed >= 0 ? loopGapParsed : 5000;

    let stopRequested = false;
    const onStop = () => {
        stopRequested = true;
        process.stderr.write('\n[worker-ingest-full] stop signal — exiting after current vehicle…\n');
    };
    process.on('SIGINT', onStop);
    process.on('SIGTERM', onStop);

    if (continuous) {
        say(
            '[worker-ingest-full] CONTINUOUS: CSV re-loaded each pass; Ctrl+C exits cleanly; `--resume` skips completed vehicles.\n'
        );
    }

    let passIdx = 0;
    let okAnyEver = false;

    /** @note `break ingestLoop` exits the outer CSV pass cycle (not inner `for` over rows). */
    ingestLoop:
    while (!stopRequested) {
        passIdx++;

        /** @type {{ engine_id: string, content_source: string }[]} */
        let vehicles;
        try {
            const csvText = await fs.readFile(vehiclesFile, 'utf8');
            vehicles = parseCsvEngines(csvText);
        } catch (e) {
            const msg = /** @type {Error} */ (e).message || String(e);
            say(`[worker-ingest-full] CSV read failed: ${msg}\n`);
            if (!relaxedCompletion) process.exitCode = 1;
            if (!continuous) break ingestLoop;
            await sleep(loopGapMs);
            continue ingestLoop;
        }

        const off = Number(offsetN) || 0;
        const lim = limitN ? Number(limitN) : vehicles.length;
        vehicles = vehicles.slice(off, off + lim);
        if (shardCount > 1) {
            vehicles = vehicles.filter((_, i) => i % shardCount === shardIdx);
        }

        say(
            continuous
                ? `pass ${passIdx}: vehicles(distinct engine_id): ${vehicles.length}\n`
                : `vehicles(distinct engine_id): ${vehicles.length}\n`
        );

        // Auto-reset failed catalog states so they get retried this pass
        if (autoResetFailed) {
            let resetCount = 0;
            for (const row of vehicles) {
                const safeDir = sanitizeVehicleDir(row.engine_id);
                const tp = path.join(outRoot, 'MOTOR', safeDir, 'ingest_tracker.json');
                try {
                    const t = JSON.parse(await fs.readFile(tp, 'utf8'));
                    if (t?.scopes?.catalog?.state === 'failed') {
                        t.scopes.catalog.state = 'pending';
                        await atomicWriteJson(tp, t);
                        resetCount++;
                    }
                } catch { /* tracker not yet created */ }
            }
            if (resetCount > 0) say(`[auto-reset] reset ${resetCount} failed catalogs → pending\n`);
        }

        let okAny = false;

        for (const row of vehicles) {
            if (stopRequested) break;
            try {
                const route = motorProxyRoute(row);
                const res = await ingestOneVehicle({
                    baseUrl,
                    outRoot,
                    engineId: row.engine_id,
                    contentSource: row.content_source || 'MOTOR',
                    pathSource: route.pathSource,
                    pathVehicleId: route.pathVehicleId,
                    runId,
                    dryRun,
                    resume,
                    retryFailed,
                    withArticles,
                    articleConcurrency,
                    relaxedCompletion,
                    token,
                    motorVehicleQuery: (motorVm && motorVm.trim()) || route.motorVehicleQuery || '',
                    delayMs,
                    forceCatalog,
                    forceArticleId,
                    quiet
                });
                if (res?.ok) okAny = true;
                okAnyEver = okAnyEver || !!res?.ok;
                say(
                    `[done] engine_id=${row.engine_id} (${row.content_source || 'MOTOR'}) ${res?.ok ? 'OK' : `ERR ${res?.error}`}\n`
                );
            } catch (e) {
                say(`[error] engine_id=${row.engine_id}: ${/** @type {Error} */ (e).message || e}\n`);
                if (!relaxedCompletion) process.exitCode = 1;
            }
        }

        if (!continuous || stopRequested) {
            say(
                okAny
                    ? 'worker finished\n'
                    : okAnyEver
                      ? 'worker finished (prior passes had successes)\n'
                      : 'worker finished with issues\n'
            );
            break ingestLoop;
        }

        say(`pass ${passIdx} done; pause ${loopGapMs}ms before next CSV read…\n`);
        await sleep(loopGapMs);
    }

    if (stopRequested && continuous) {
        say(`[worker-ingest-full] stopped after pass ${passIdx}\n`);
    }

    process.exit(process.exitCode || 0);
}

main();
