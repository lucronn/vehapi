#!/usr/bin/env node
/**
 * Pre-seed vehicle_metadata with YMME index data (years + per-year makes + models + engines) via local proxy.
 * Requires vehapiproxi running (`npm start`) so Motor session + background_worker persist responses.
 */
import process from 'node:process';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { insertMetadata } from '../src/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config();

function arg(name) {
    const p = `--${name}=`;
    const hit = process.argv.find((a) => a.startsWith(p));
    return hit ? hit.slice(p.length) : process.env[`SEED_YMME_${name.toUpperCase()}`] || '';
}

const base = (arg('base') || process.env.SEED_YMME_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let requestCount = 0;
const MAX_REQUESTS_PER_SESSION = 4800;

async function checkSession() {
    if (requestCount >= MAX_REQUESTS_PER_SESSION) {
        console.warn(`[seed-ymme] Approaching Motor API session limit (${requestCount} requests). Forcing a new session via /auth/reset...`);
        try {
            await fetch(`${base}/auth/reset`, { method: 'POST' });
            console.log(`[seed-ymme] Session reset requested. Waiting 10 seconds for re-authentication to settle...`);
            await delay(10000);
        } catch (resetErr) {
            console.error(`[seed-ymme] Failed to reset session:`, resetErr);
        }
        requestCount = 0;
    }
}

async function main() {
    console.log(`[seed-ymme] base=${base}`);

    const { dbQuery, isDbConfigured } = await import('../src/db.js');
    if (!isDbConfigured()) {
        console.error('[seed-ymme] DATABASE_URL is not set. Set it in .env and retry.');
        process.exit(1);
    }

    console.log(`[seed-ymme] Fetching existing metadata paths from Cloud SQL...`);
    const existingPaths = new Set();
    let offset = 0;
    const batchSize = 1000;
    while (true) {
        const { rows } = await dbQuery(
            `SELECT path FROM vehicle_metadata ORDER BY path LIMIT $1 OFFSET $2`,
            [batchSize, offset]
        );
        if (!rows || rows.length === 0) break;
        rows.forEach(r => existingPaths.add(r.path));
        offset += rows.length;
        if (rows.length < batchSize) break;
    }
    console.log(`[seed-ymme] Found ${existingPaths.size} existing paths. Will skip these.`);

    const yearsUrl = `${base}/api/years`;
    let yearsJson;

    if (existingPaths.has('/years')) {
        console.log('[seed-ymme] stored /years (already exists, loading from DB...)');
        const { rows } = await dbQuery(`SELECT data FROM vehicle_metadata WHERE path = $1 LIMIT 1`, ['/years']);
        yearsJson = rows[0]?.data;
    } else {
        try {
            await checkSession();
            requestCount++;
            const res = await fetch(yearsUrl, { headers: { Accept: 'application/json' } });
            if (!res.ok) {
                console.error(`[seed-ymme] HTTP ${res.status} ${yearsUrl}`);
                process.exit(1);
            }
            yearsJson = await res.json();
            const r = await insertMetadata('/years', yearsJson);
            if (!r.success) {
                console.error('[seed-ymme] insertMetadata /years failed:', r.error);
                process.exit(1);
            }
            console.log('[seed-ymme] stored /years');
            existingPaths.add('/years');
        } catch (e) {
            console.error(`[seed-ymme] Fetch failed (${e.cause?.code || e.message}).`);
            process.exit(1);
        }
    }

    const years = Array.isArray(yearsJson?.body) ? yearsJson.body : [];
    if (years.length === 0) {
        console.warn('[seed-ymme] no years in response body; done.');
        return;
    }

    const sorted = [...years].sort((a, b) => a - b);
    let i = 0;

    for (const y of sorted) {
        i += 1;
        const makesPath = `/year/${y}/makes`;
        let makesJson = null;

        if (existingPaths.has(makesPath)) {
            console.log(`[seed-ymme] [${i}/${sorted.length}] stored ${makesPath} (exists)`);
            const { rows: mRows } = await dbQuery(`SELECT data FROM vehicle_metadata WHERE path = $1 LIMIT 1`, [makesPath]);
            makesJson = mRows[0]?.data;
        } else {
            await checkSession();
            await delay(100);
            requestCount++;
            try {
                const makesUrl = `${base}/api${makesPath}`;
                const mRes = await fetch(makesUrl, { headers: { Accept: 'application/json' } });
                if (!mRes.ok) {
                    console.warn(`[seed-ymme] ${makesUrl} HTTP ${mRes.status} (skip)`);
                    continue;
                }
                makesJson = await mRes.json();
                const ins = await insertMetadata(makesPath, makesJson);
                if (!ins.success) {
                    console.warn(`[seed-ymme] insertMetadata ${makesPath} failed:`, ins.error);
                } else {
                    console.log(`[seed-ymme] [${i}/${sorted.length}] stored ${makesPath}`);
                    existingPaths.add(makesPath);
                }
            } catch (e) {
                console.warn(`[seed-ymme] ${makesPath} error:`, e?.message || e);
                continue;
            }
        }

        // Seed Models + Engines for this Make
        const makesArr = Array.isArray(makesJson?.body) ? makesJson.body : [];
        for (const m of makesArr) {
            const makeName = m.make_name || m.makeName;
            if (!makeName) continue;
            const modelsPath = `/year/${y}/make/${encodeURIComponent(makeName)}/models`;
            let modJson = null;

            if (existingPaths.has(modelsPath)) {
                // Skips model iteration since engines are embedded
            } else {
                await checkSession();
                await delay(250);
                requestCount++;
                try {
                    const modelsUrl = `${base}/api${modelsPath}`;
                    const modRes = await fetch(modelsUrl, { headers: { Accept: 'application/json' } });
                    if (!modRes.ok) {
                        console.warn(`[seed-ymme] ${modelsUrl} HTTP ${modRes.status} (skip)`);
                        continue;
                    }
                    modJson = await modRes.json();
                    const mIns = await insertMetadata(modelsPath, modJson);
                    if (!mIns.success) {
                        console.warn(`[seed-ymme] insertMetadata ${modelsPath} failed:`, mIns.error);
                    } else {
                        console.log(`[seed-ymme]   -> stored ${modelsPath}`);
                        existingPaths.add(modelsPath);
                    }
                } catch (err) {
                    console.warn(`[seed-ymme] ${modelsPath} error:`, err?.message || err);
                    continue;
                }
            }

            // Motor Information API `/models` returns engines nested in `engines: []` so there is NO extra engine endpoint for index caching!
            // But Motor Information API (/api/motor-information/ymme/engines) exists!
            // Wait, does `vehicle_metadata` need an engine path, or is the nested engines inside the models enough?
            // Let's check `home.component.ts`. `home.component.ts` calls `/api/year/.../make/.../models` and reads `.engines` from the items.
            // So we DO NOT need to call another endpoint! The engines are fully seeded as part of the models path!
        }
    }
    console.log('[seed-ymme] done.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
