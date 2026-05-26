#!/usr/bin/env node
/**
 * Local ingest progress UI: scans data/raw/MOTOR/<dir>/ingest_tracker.json (worker L0 layout)
 * under the repo root and serves a small SPA.
 *
 * Usage: npm run ingest:dashboard (run from vehapiproxi/).
 *
 * Binds to 127.0.0.1 by default (--host override at your risk).
 */

import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Same default raw root as worker-ingest-vehicles-full.js: <repo>/data/raw */
const DEFAULT_RAW = path.resolve(__dirname, '..', '..', 'data', 'raw');

/** Express backend URL */
const BACKEND_BASE = process.env.BACKEND_BASE || 'http://localhost:3001';

/** Worker script path */
const WORKER_SCRIPT = path.resolve(__dirname, 'worker-ingest-vehicles-full.js');

function argvVal(name, fallback = '') {
    const p = `--${name}=`;
    const eq = process.argv.find((a) => a.startsWith(p));
    if (eq) return eq.slice(p.length);
    const u = `--${name}`;
    const ix = process.argv.indexOf(u);
    if (ix >= 0 && process.argv[ix + 1]) return process.argv[ix + 1];
    return process.env[name.replace(/-/g, '_').toUpperCase()] || fallback;
}

/**
 * @param {Record<string, any> | undefined} scopes
 */
function rollupScopes(scopes) {
    const out = {
        total: 0,
        complete: 0,
        failed: 0,
        inProgress: 0,
        pending: 0,
        catalog: '—'
    };
    if (!scopes || typeof scopes !== 'object') return out;
    /** @type {any} */
    const cat = scopes.catalog;
    if (cat?.state && typeof cat.state === 'string') out.catalog = cat.state;
    for (const [, raw] of Object.entries(scopes)) {
        /** @type {any} */
        const v = raw;
        if (!v || typeof v !== 'object') continue;
        out.total++;
        const st = String(v.state ?? 'pending');
        if (st === 'complete') out.complete++;
        else if (st === 'failed' || st === 'rate_limited') out.failed++;
        else if (st === 'fetched') out.inProgress++;
        else out.pending++;
    }
    return out;
}

/**
 * @param {Record<string, any> | undefined} articles
 */
function articleCounts(articles) {
    /** @type {Record<string, number>} */
    const c = {};
    if (!articles || typeof articles !== 'object') return c;
    for (const row of Object.values(articles)) {
        if (!row || typeof row !== 'object') continue;
        const st = String(/** @type {any} */ (row).status ?? 'unknown');
        c[st] = (c[st] || 0) + 1;
    }
    return c;
}

function sumArticleCounts(map) {
    let n = 0;
    for (const v of Object.values(map)) n += v;
    return n;
}

/**
 * @param {string} rawRoot
 */
async function scanTrackers(rawRoot) {
    const motorRoot = path.join(rawRoot, 'MOTOR');
    let dirs = [];
    try {
        dirs = await fs.readdir(motorRoot, { withFileTypes: true });
    } catch {
        return { motorRoot, vehicles: [] };
    }
    /** @type {any[]} */
    const vehicles = [];
    for (const ent of dirs) {
        if (!ent.isDirectory()) continue;
        const safeDir = ent.name;
        if (!safeDir || safeDir === '.' || safeDir === '..') continue;
        const tp = path.join(motorRoot, safeDir, 'ingest_tracker.json');
        let txt;
        try {
            txt = await fs.readFile(tp, 'utf8');
        } catch {
            continue;
        }
        /** @type {any} */
        let t;
        try {
            t = JSON.parse(txt);
        } catch {
            continue;
        }
        const counts = articleCounts(t.articles);
        const sr = rollupScopes(t.scopes);
        vehicles.push({
            safeDir,
            vehicle_id: t.vehicle_id ?? safeDir,
            content_source: t.content_source ?? 'MOTOR',
            updated_at: t.updated_at ?? null,
            summary: t.summary ?? {},
            scopesRollup: sr,
            articleCounts: counts,
            articleTotalFromSummary: t.summary?.corpus_articles_total,
            articleNormFromSummary: t.summary?.corpus_articles_normalized
        });
    }
    vehicles.sort((a, b) => {
        const ta = new Date(a.updated_at || 0).getTime();
        const tb = new Date(b.updated_at || 0).getTime();
        return tb - ta;
    });
    return { motorRoot, vehicles };
}

function buildSummaryPayload(rawRoot, scan) {
    const { vehicles } = scan;
    let scopeCompleteSum = 0;
    let scopeFailedSum = 0;
    let articleNormalizedSum = 0;
    let articleTrackedSum = 0;
    for (const v of vehicles) {
        scopeCompleteSum += v.scopesRollup.complete;
        scopeFailedSum += v.scopesRollup.failed;
        articleNormalizedSum += Number(v.summary?.corpus_articles_normalized ?? 0) || 0;
        const at =
            Number(v.summary?.corpus_articles_total ?? 0) ||
            sumArticleCounts(v.articleCounts) ||
            0;
        articleTrackedSum += at;
    }
    return {
        rawRoot: path.resolve(rawRoot),
        generatedAt: new Date().toISOString(),
        summary: {
            vehicleCount: vehicles.length,
            scopeCompleteSum,
            scopeFailedSum,
            articleNormalizedSum,
            articleTrackedSum
        },
        vehicles
    };
}

// ---------------------------------------------------------------------------
// Worker management — track spawned workers in memory
// ---------------------------------------------------------------------------

/** @type {Map<number, { pid: number, flags: string[], startedAt: string, proc: import('node:child_process').ChildProcess, logLines: string[] }>} */
const workers = new Map();

function spawnWorker(flags) {
    const args = [WORKER_SCRIPT, ...flags];
    const proc = spawn('node', args, {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const logLines = [];
    const onData = (chunk) => {
        const lines = String(chunk).split('\n');
        for (const l of lines) {
            if (l.trim()) logLines.push(l);
            if (logLines.length > 500) logLines.shift();
        }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('exit', (code) => {
        logLines.push(`[exit code ${code ?? '?'}]`);
    });
    const entry = {
        pid: proc.pid,
        flags,
        startedAt: new Date().toISOString(),
        proc,
        logLines
    };
    workers.set(proc.pid, entry);
    proc.on('exit', () => {
        // Keep the entry for a while so the UI can show exit status
        setTimeout(() => workers.delete(proc.pid), 60_000);
    });
    return entry;
}

function listWorkers() {
    return [...workers.values()].map(({ pid, flags, startedAt, logLines, proc }) => ({
        pid,
        flags,
        startedAt,
        alive: proc.exitCode === null,
        exitCode: proc.exitCode,
        lastLines: logLines.slice(-20)
    }));
}

// ---------------------------------------------------------------------------
// Backend proxy helpers
// ---------------------------------------------------------------------------

async function proxyGet(path) {
    const url = `${BACKEND_BASE}${path}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        const text = await res.text();
        return { ok: res.ok, status: res.status, body: text };
    } catch (e) {
        clearTimeout(t);
        return { ok: false, status: 0, body: JSON.stringify({ error: e.message }) };
    }
}

async function proxyPost(path, data) {
    const url = `${BACKEND_BASE}${path}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data ?? {}),
            signal: ctrl.signal
        });
        clearTimeout(t);
        const text = await res.text();
        return { ok: res.ok, status: res.status, body: text };
    } catch (e) {
        clearTimeout(t);
        return { ok: false, status: 0, body: JSON.stringify({ error: e.message }) };
    }
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let s = '';
        req.on('data', c => { s += c; if (s.length > 1e5) reject(new Error('too large')); });
        req.on('end', () => {
            try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); }
        });
        req.on('error', reject);
    });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

async function main() {
    const port =
        Number.parseInt(String(argvVal('port', process.env.INGEST_DASHBOARD_PORT || '3847')), 10) ||
        3847;
    const host = (
        argvVal('host', process.env.INGEST_DASHBOARD_HOST || '127.0.0.1') || '127.0.0.1'
    ).trim();
    const rawArg = argvVal('raw-dir', process.env.INGEST_DASHBOARD_RAW || '');
    const rawRoot = path.resolve(rawArg || DEFAULT_RAW);

    const htmlPath = path.join(__dirname, 'ingest-progress-dashboard.html');
    const html = await fs.readFile(htmlPath, 'utf8').catch(() => {
        return '<!DOCTYPE html><html><body><p>Missing ingest-progress-dashboard.html next to this script.</p></body></html>';
    });

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${host}:${port}`);

        // ── Helpers ──────────────────────────────────────────────────────────
        const send = (status, body, ct = 'application/json; charset=utf-8') => {
            const s = typeof body === 'string' ? body : JSON.stringify(body);
            res.writeHead(status, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
            res.end(s);
        };

        // ── Static UI ────────────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/') {
            send(200, html, 'text/html; charset=utf-8');
            return;
        }

        // ── Tracker data ─────────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/api/summary') {
            try {
                const scan = await scanTrackers(rawRoot);
                send(200, buildSummaryPayload(rawRoot, scan));
            } catch (e) {
                send(500, { error: e.message || String(e) });
            }
            return;
        }

        if (req.method === 'GET' && url.pathname.startsWith('/api/trackers/')) {
            const enc = url.pathname.slice('/api/trackers/'.length);
            let safeDir;
            try { safeDir = decodeURIComponent(enc); } catch { res.writeHead(400).end('bad path'); return; }
            if (safeDir.includes('..') || safeDir.includes('/') || safeDir.includes('\\')) {
                res.writeHead(400).end('invalid id'); return;
            }
            const tp = path.join(rawRoot, 'MOTOR', safeDir, 'ingest_tracker.json');
            try {
                const txt = await fs.readFile(tp, 'utf8');
                send(200, txt, 'application/json; charset=utf-8');
            } catch {
                res.writeHead(404).end('not found');
            }
            return;
        }

        // ── Worker management ────────────────────────────────────────────────
        if (url.pathname === '/api/workers') {
            if (req.method === 'GET') {
                send(200, listWorkers());
                return;
            }
            if (req.method === 'POST') {
                let body;
                try { body = await readBody(req); } catch { send(400, { error: 'bad body' }); return; }
                const flags = Array.isArray(body.flags) ? body.flags.map(String) : ['--continuous', '--resume', '--metadata-only'];
                // Validate flags — no shell injection; only allow known safe chars
                for (const f of flags) {
                    if (!/^[a-zA-Z0-9\-_.=/:]+$/.test(f)) {
                        send(400, { error: `Unsafe flag: ${f}` }); return;
                    }
                }
                const entry = spawnWorker(flags);
                send(200, { pid: entry.pid, flags: entry.flags, startedAt: entry.startedAt });
                return;
            }
        }

        const pidMatch = url.pathname.match(/^\/api\/workers\/(\d+)(\/logs)?$/);
        if (pidMatch) {
            const pid = Number(pidMatch[1]);
            const logsOnly = Boolean(pidMatch[2]);
            const w = workers.get(pid);
            if (!w) { send(404, { error: 'worker not found' }); return; }
            if (req.method === 'GET') {
                if (logsOnly) {
                    send(200, { pid, lines: w.logLines.slice(-100) });
                } else {
                    send(200, { pid: w.pid, flags: w.flags, startedAt: w.startedAt, alive: w.proc.exitCode === null, exitCode: w.proc.exitCode });
                }
                return;
            }
            if (req.method === 'DELETE') {
                if (w.proc.exitCode === null) {
                    w.proc.kill('SIGTERM');
                    send(200, { pid, killed: true });
                } else {
                    send(200, { pid, killed: false, reason: 'already exited' });
                }
                return;
            }
        }

        // ── Proxy to backend ─────────────────────────────────────────────────
        if (url.pathname === '/api/proxy/status' && req.method === 'GET') {
            const r = await proxyGet('/auth/status');
            send(r.status || 502, r.body, 'application/json; charset=utf-8');
            return;
        }
        if (url.pathname === '/api/proxy/start' && req.method === 'POST') {
            const r = await proxyPost('/auth/start', {});
            send(r.status || 502, r.body, 'application/json; charset=utf-8');
            return;
        }
        if (url.pathname === '/api/proxy/reset' && req.method === 'POST') {
            const r = await proxyPost('/auth/reset', {});
            send(r.status || 502, r.body, 'application/json; charset=utf-8');
            return;
        }
        if (url.pathname === '/api/db-stats' && req.method === 'GET') {
            const r = await proxyGet('/admin/db-stats');
            send(r.status || 502, r.body, 'application/json; charset=utf-8');
            return;
        }
        if (url.pathname === '/api/proxy-pool/status' && req.method === 'GET') {
            const r = await proxyGet('/proxy-pool/status');
            send(r.status || 502, r.body, 'application/json; charset=utf-8');
            return;
        }
        if (url.pathname === '/api/proxy-pool/rotate' && req.method === 'POST') {
            const r = await proxyPost('/proxy-pool/rotate', {});
            send(r.status || 502, r.body, 'application/json; charset=utf-8');
            return;
        }
        if (url.pathname === '/api/proxy-pool/refresh' && req.method === 'POST') {
            const r = await proxyPost('/proxy-pool/refresh', {});
            send(r.status || 502, r.body, 'application/json; charset=utf-8');
            return;
        }

        res.writeHead(404).end();
    });

    server.listen(port, host, () => {
        process.stderr.write(
            `[ingest-dashboard] http://${host}:${port}/   (scanning ${path.join(rawRoot, 'MOTOR')})\n` +
                `[ingest-dashboard] Ctrl+C to stop\n`
        );
    });
}

main().catch((err) => {
    process.stderr.write(`[ingest-dashboard] fatal: ${err?.message || err}\n`);
    process.exitCode = 1;
});
