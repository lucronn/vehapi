#!/usr/bin/env node
/**
 * Populate Cloud SQL with full YMME catalog from api.motor.com DaaS.
 *
 * Writes to:
 *   - vehicle_metadata  (paths: /years, /year/:year/makes, /year/:year/make/:make/models)
 *   - vehicles          (one row per year:make:model, external_id format)
 *
 * Behavior:
 *   - Resumable: skips paths already present in vehicle_metadata
 *   - Concurrent: processes up to MAKE_CONCURRENCY makes per year in parallel
 *   - Throttled: optional MIN_DELAY_MS between requests to be polite
 *   - Idempotent: ON CONFLICT updates existing rows
 *
 * Usage:
 *   node scripts/seed-ymme-cloudsql.mjs                # full run
 *   node scripts/seed-ymme-cloudsql.mjs --years=2022,2023  # specific years
 *   node scripts/seed-ymme-cloudsql.mjs --force        # ignore cache, re-fetch all
 *   node scripts/seed-ymme-cloudsql.mjs --dry-run      # show plan, don't write
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { fetchDaasYears, fetchDaasMakes, fetchDaasModels, getDaasConfig } from '../src/motor_daas_api.js';
import { dbQuery, isDbConfigured } from '../src/db.js';

// ─── Config ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`) || a === `--${name}`);
    if (!hit) return null;
    return hit.includes('=') ? hit.split('=')[1] : true;
};
const FORCE       = Boolean(arg('force'));
const DRY_RUN     = Boolean(arg('dry-run'));
const YEARS_FILTER = arg('years')?.split(',').map(Number).filter(Boolean) || null;
const MAKE_CONCURRENCY = Number(arg('concurrency') || 4);
const MIN_DELAY_MS = Number(arg('delay') || 0);

// ─── Preflight ──────────────────────────────────────────────────────────────
const cfg = getDaasConfig();
if (!cfg.enabled) { console.error('✗ MOTOR_FLUIDS_PUBLIC_KEY / MOTOR_FLUIDS_PRIVATE_KEY not set'); process.exit(1); }
if (!isDbConfigured()) { console.error('✗ DATABASE_URL not set'); process.exit(1); }
console.log(`✓ DaaS keys: ${cfg.publicKey}`);
console.log(`✓ Cloud SQL connected`);
console.log(`  force=${FORCE} dry-run=${DRY_RUN} concurrency=${MAKE_CONCURRENCY} delay=${MIN_DELAY_MS}ms years=${YEARS_FILTER || 'all'}\n`);

// ─── Cache lookup ───────────────────────────────────────────────────────────
async function loadExistingPaths() {
    if (FORCE) return new Set();
    const { rows } = await dbQuery(`SELECT path FROM vehicle_metadata WHERE path LIKE '/year%' OR path = '/years'`);
    return new Set(rows.map(r => r.path));
}

async function upsertMetadata(path, data) {
    if (DRY_RUN) return;
    await dbQuery(
        `INSERT INTO vehicle_metadata (path, data, updated_at) VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [path, JSON.stringify(data)]
    );
}

async function upsertVehicle(year, make, model) {
    if (DRY_RUN) return;
    const extId = `${year}:${make}:${model}`;
    await dbQuery(
        `INSERT INTO vehicles (external_id, content_source, year, make, model, updated_at)
         VALUES ($1, 'MOTOR', $2, $3, $4, NOW())
         ON CONFLICT (external_id) DO UPDATE SET year=EXCLUDED.year, make=EXCLUDED.make, model=EXCLUDED.model, updated_at=NOW()`,
        [extId, year, make, model]
    );
}

// ─── Throttle helper ────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Concurrency-limited map ────────────────────────────────────────────────
async function plimit(items, limit, fn) {
    const results = [];
    let cursor = 0;
    const workers = Array.from({ length: limit }, async () => {
        while (cursor < items.length) {
            const i = cursor++;
            try { results[i] = await fn(items[i], i); }
            catch (e) { results[i] = { error: e.message }; }
            if (MIN_DELAY_MS) await sleep(MIN_DELAY_MS);
        }
    });
    await Promise.all(workers);
    return results;
}

// ─── Stats ──────────────────────────────────────────────────────────────────
const stats = {
    yearsProcessed: 0, makesProcessed: 0, modelsProcessed: 0,
    vehiclesCreated: 0, pathsCached: 0, skipped: 0, errors: 0,
    startTime: Date.now(),
};
function eta(done, total) {
    if (!done) return '?';
    const elapsed = (Date.now() - stats.startTime) / 1000;
    const rate = done / elapsed;
    const remaining = (total - done) / rate;
    return `${Math.floor(remaining/60)}m${Math.round(remaining%60)}s`;
}

// ─── Main ───────────────────────────────────────────────────────────────────
const existingPaths = await loadExistingPaths();
console.log(`Cached paths: ${existingPaths.size}\n`);

// 1. Years
let yearsData;
if (existingPaths.has('/years') && !FORCE) {
    const { rows } = await dbQuery(`SELECT data FROM vehicle_metadata WHERE path = '/years'`);
    yearsData = rows[0].data;
    console.log(`[/years] ✓ cached (${yearsData.body.length} years)`);
} else {
    console.log(`[/years] fetching...`);
    yearsData = await fetchDaasYears();
    await upsertMetadata('/years', yearsData);
    stats.pathsCached++;
    console.log(`[/years] ✓ stored (${yearsData.body.length} years)`);
}

const allYears = yearsData.body;
const years = YEARS_FILTER ? allYears.filter(y => YEARS_FILTER.includes(y)) : allYears;
console.log(`Processing ${years.length} year(s): ${years.slice(0,5).join(', ')}${years.length>5?', ...':''}\n`);

// 2. Per year: makes → per make: models (with engines + baseVehicleId)
for (const year of years) {
    const yearStart = Date.now();
    const makesPath = `/year/${year}/makes`;
    let makesData;
    if (existingPaths.has(makesPath) && !FORCE) {
        const { rows } = await dbQuery(`SELECT data FROM vehicle_metadata WHERE path = $1`, [makesPath]);
        makesData = rows[0].data;
        stats.skipped++;
    } else {
        try {
            makesData = await fetchDaasMakes(year);
            await upsertMetadata(makesPath, makesData);
            stats.pathsCached++;
        } catch (e) {
            console.warn(`[${year}] ✗ makes fetch failed: ${e.message} — skipping year`);
            stats.errors++;
            continue;
        }
    }
    const makes = makesData.body || [];
    console.log(`\n[${year}] ${makes.length} make(s)${existingPaths.has(makesPath) && !FORCE ? ' (cached)' : ''}`);

    // Process makes in parallel
    const results = await plimit(makes, MAKE_CONCURRENCY, async (make) => {
        const makePath = `/year/${year}/make/${encodeURIComponent(make.makeName)}/models`;
        if (existingPaths.has(makePath) && !FORCE) {
            // Still upsert vehicles from cached data
            const { rows } = await dbQuery(`SELECT data FROM vehicle_metadata WHERE path = $1`, [makePath]);
            const models = rows[0]?.data?.body?.models || [];
            for (const m of models) await upsertVehicle(year, make.makeName, m.model_name || m.model);
            stats.skipped++;
            return { skipped: true, count: models.length };
        }
        try {
            const raw = await fetchDaasModels(year, make.makeId);
            const wrapped = {
                header: raw.header,
                body: { contentSource: 'MOTOR', models: raw.body },
            };
            await upsertMetadata(makePath, wrapped);
            for (const m of raw.body) {
                await upsertVehicle(year, make.makeName, m.model_name || m.model);
                stats.vehiclesCreated++;
            }
            stats.pathsCached++;
            stats.modelsProcessed += raw.body.length;
            return { count: raw.body.length };
        } catch (e) {
            stats.errors++;
            return { error: e.message };
        }
    });

    const counts = results.map(r => r?.count ?? 0);
    const totalModels = counts.reduce((a, b) => a + b, 0);
    const cached = results.filter(r => r?.skipped).length;
    const errored = results.filter(r => r?.error).length;
    stats.makesProcessed += makes.length;
    stats.yearsProcessed++;

    const yearMs = Date.now() - yearStart;
    console.log(`[${year}] ✓ ${totalModels} models | ${cached} cached makes | ${errored} errors | ${(yearMs/1000).toFixed(1)}s | ETA ${eta(stats.yearsProcessed, years.length)}`);
}

// 3. Summary
const totalSec = ((Date.now() - stats.startTime) / 1000).toFixed(1);
console.log(`
════════════════════════════════════════════════
YMME seed complete (${totalSec}s)
  Years processed   : ${stats.yearsProcessed}
  Makes processed   : ${stats.makesProcessed}
  Models fetched    : ${stats.modelsProcessed}
  Vehicles upserted : ${stats.vehiclesCreated}
  Paths cached new  : ${stats.pathsCached}
  Cached/skipped    : ${stats.skipped}
  Errors            : ${stats.errors}
════════════════════════════════════════════════`);

// Final DB counts
const [{ rows: vmRows }, { rows: vRows }] = await Promise.all([
    dbQuery(`SELECT COUNT(*) FROM vehicle_metadata`),
    dbQuery(`SELECT COUNT(*) FROM vehicles`),
]);
console.log(`\nCloud SQL totals:`);
console.log(`  vehicle_metadata rows : ${vmRows[0].count}`);
console.log(`  vehicles rows         : ${vRows[0].count}`);

process.exit(stats.errors > 0 ? 1 : 0);
