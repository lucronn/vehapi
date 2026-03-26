#!/usr/bin/env node
/**
 * Pre-seed vehicle_metadata with YMME index data (years + per-year makes) via local proxy.
 * Requires vehapiproxi running (`npm start`) so Motor session + background_worker persist responses.
 *
 * Usage:
 *   cd vehapiproxi && npm run seed:ymme
 *   node scripts/seed-ymme.js --base=http://localhost:3001
 *
 * Env: SEED_YMME_BASE_URL (default http://localhost:3001)
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

async function main() {
    console.log(`[seed-ymme] base=${base}`);
    const yearsUrl = `${base}/api/years`;
    let res;
    let yearsJson;
    try {
        res = await fetch(yearsUrl, { headers: { Accept: 'application/json' } });
        yearsJson = await res.json();
    } catch (e) {
        console.error(`[seed-ymme] Fetch failed (${e.cause?.code || e.message}). Is vehapiproxi listening on ${base}?`);
        console.error('  cd vehapiproxi && npm start');
        process.exit(1);
    }
    if (!res.ok) {
        console.error(`[seed-ymme] HTTP ${res.status} ${yearsUrl}`);
        process.exit(1);
    }

    const r = await insertMetadata('/years', yearsJson);
    if (!r.success) {
        console.error('[seed-ymme] insertMetadata /years failed:', r.error);
        process.exit(1);
    }
    console.log('[seed-ymme] stored /years');

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
        const makesUrl = `${base}/api${makesPath}`;
        await delay(500);
        try {
            const mRes = await fetch(makesUrl, { headers: { Accept: 'application/json' } });
            const makesJson = await mRes.json();
            if (!mRes.ok) {
                console.warn(`[seed-ymme] ${makesUrl} HTTP ${mRes.status} (skip)`);
                continue;
            }
            const ins = await insertMetadata(makesPath, makesJson);
            if (!ins.success) {
                console.warn(`[seed-ymme] insertMetadata ${makesPath} failed:`, ins.error);
            } else {
                console.log(`[seed-ymme] [${i}/${sorted.length}] stored ${makesPath}`);
            }
        } catch (e) {
            console.warn(`[seed-ymme] ${makesUrl} error:`, e?.message || e);
        }
    }
    console.log('[seed-ymme] done.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
