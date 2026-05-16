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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Same default raw root as worker-ingest-vehicles-full.js: <repo>/data/raw */
const DEFAULT_RAW = path.resolve(__dirname, '..', '..', 'data', 'raw');

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

        if (req.method === 'GET' && url.pathname === '/') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end(html);
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/summary') {
            try {
                const scan = await scanTrackers(rawRoot);
                const body = JSON.stringify(buildSummaryPayload(rawRoot, scan));
                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': 'no-store'
                });
                res.end(body);
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: /** @type {Error} */ (e).message || String(e) }));
            }
            return;
        }

        if (req.method === 'GET' && url.pathname.startsWith('/api/trackers/')) {
            const enc = url.pathname.slice('/api/trackers/'.length);
            let safeDir;
            try {
                safeDir = decodeURIComponent(enc);
            } catch {
                res.writeHead(400).end('bad path');
                return;
            }
            if (safeDir.includes('..') || safeDir.includes('/') || safeDir.includes('\\')) {
                res.writeHead(400).end('invalid id');
                return;
            }
            const tp = path.join(rawRoot, 'MOTOR', safeDir, 'ingest_tracker.json');
            try {
                const txt = await fs.readFile(tp, 'utf8');
                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': 'no-store'
                });
                res.end(txt);
            } catch {
                res.writeHead(404).end('not found');
            }
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
