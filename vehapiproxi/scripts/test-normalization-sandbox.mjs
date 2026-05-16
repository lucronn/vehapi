#!/usr/bin/env node
/**
 * Sandbox normalization test — fetches all sandbox YMME vehicles, stores them in Cloud SQL,
 * then fetches and stores fluids + parts for each engine.
 *
 * Uses MOTOR_SANDBOX_* keys (api.motor.com test dataset: 2010 Honda Civic / Mercedes-Benz / Nissan).
 * Uses MOTOR_FLUIDS_* keys for fluids/parts (sandbox keys may not cover those endpoints).
 *
 * Run: node scripts/test-normalization-sandbox.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { fetchDaasYears, fetchDaasMakes, fetchDaasModels, fetchDaasFluids, fetchDaasParts, getDaasConfig } from '../src/motor_daas_api.js';
import { dbQuery, isDbConfigured } from '../src/db.js';

const SANDBOX = true;

function check(label, cfg) {
    if (!cfg.enabled) {
        console.error(`✗ ${label} not configured`);
        process.exit(1);
    }
    console.log(`✓ ${label}: ${cfg.publicKey}`);
}

// ── Preflight ──────────────────────────────────────────────────────────────
check('Sandbox keys', getDaasConfig('en-US', true));
check('Fluids keys',  getDaasConfig('en-US', false));
if (!isDbConfigured()) { console.error('✗ DATABASE_URL not set'); process.exit(1); }
console.log('✓ Cloud SQL connected\n');

// ── Fetch years ────────────────────────────────────────────────────────────
console.log('Fetching sandbox years...');
const yearsData = await fetchDaasYears(SANDBOX);
console.log(`  Years: ${yearsData.body.join(', ')}`);
await dbQuery(
    `INSERT INTO vehicle_metadata (path, data, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    ['/years', JSON.stringify(yearsData)]
);

let vehicleCount = 0;
let fluidCount = 0;
let partCount = 0;

for (const year of yearsData.body) {
    // ── Makes ────────────────────────────────────────────────────────────
    const makesData = await fetchDaasMakes(year, SANDBOX);
    if (!makesData.body.length) { console.log(`  ${year}: no makes`); continue; }
    console.log(`\n${year} — ${makesData.body.length} make(s): ${makesData.body.map(m => m.makeName).join(', ')}`);

    await dbQuery(
        `INSERT INTO vehicle_metadata (path, data, updated_at) VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [`/year/${year}/makes`, JSON.stringify(makesData)]
    );

    for (const make of makesData.body) {
        // ── Models ────────────────────────────────────────────────────
        const modelsRaw = await fetchDaasModels(year, make.makeId, SANDBOX);
        if (!modelsRaw.body.length) { console.log(`  ${make.makeName}: no models`); continue; }

        const modelsData = {
            header: modelsRaw.header,
            body: { contentSource: 'MOTOR', models: modelsRaw.body },
        };
        await dbQuery(
            `INSERT INTO vehicle_metadata (path, data, updated_at) VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
            [`/year/${year}/make/${encodeURIComponent(make.makeName)}/models`, JSON.stringify(modelsData)]
        );

        for (const model of modelsRaw.body) {
            vehicleCount++;
            const bvId = model.baseVehicleId;
            const engines = model.engines || [];
            console.log(`  ${make.makeName} ${model.model} (bvId=${bvId}, engines=${engines.length})`);

            // Upsert into vehicles table
            if (bvId) {
                await dbQuery(
                    `INSERT INTO vehicles (external_id, content_source, year, make, model, updated_at)
                     VALUES ($1, 'MOTOR', $2, $3, $4, NOW())
                     ON CONFLICT (external_id) DO UPDATE SET year=EXCLUDED.year, make=EXCLUDED.make,
                     model=EXCLUDED.model, updated_at=NOW()`,
                    [`${year}:${make.makeName}:${model.model}`, year, make.makeName, model.model]
                ).catch(e => console.warn(`    vehicles upsert: ${e.message}`));
            }

            for (const engine of engines) {
                // ── Fluids (use FLUIDS keys, not sandbox) ─────────────
                if (bvId && engine.id) {
                    try {
                        const fluidsData = await fetchDaasFluids(bvId, engine.id, false);
                        const apps = fluidsData.body?.Applications || [];
                        const fluidItems = apps.flatMap(a => a.Items || []);
                        fluidCount += fluidItems.length;
                        console.log(`    engine ${engine.name}: ${fluidItems.length} fluid product(s)`);

                        // Store fluids in vehicle_metadata for inspection
                        await dbQuery(
                            `INSERT INTO vehicle_metadata (path, data, updated_at) VALUES ($1, $2::jsonb, NOW())
                             ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
                            [`/fluids/${bvId}/${engine.id}`, JSON.stringify(fluidsData)]
                        );
                    } catch (e) {
                        console.warn(`    fluids error: ${e.message}`);
                    }

                    // ── Parts ──────────────────────────────────────────
                    try {
                        const partsData = await fetchDaasParts(bvId, engine.id, false);
                        const partApps = partsData.body?.Applications || [];
                        const partItems = partApps.flatMap(a => a.Items || []);
                        partCount += partItems.length;
                        if (partItems.length) {
                            console.log(`    engine ${engine.name}: ${partItems.length} part(s)`);
                            await dbQuery(
                                `INSERT INTO vehicle_metadata (path, data, updated_at) VALUES ($1, $2::jsonb, NOW())
                                 ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
                                [`/parts/${bvId}/${engine.id}`, JSON.stringify(partsData)]
                            );
                        }
                    } catch (e) {
                        console.warn(`    parts error: ${e.message}`);
                    }
                }
            }
        }
    }
}

console.log(`
════════════════════════════════════
Sandbox normalization test complete
  Vehicles processed : ${vehicleCount}
  Fluid products     : ${fluidCount}
  Parts              : ${partCount}
════════════════════════════════════`);

// Verify what landed in Cloud SQL
const { rows } = await dbQuery(
    `SELECT path, updated_at FROM vehicle_metadata ORDER BY updated_at DESC LIMIT 20`
);
console.log('\nCloud SQL vehicle_metadata (latest 20):');
rows.forEach(r => console.log(`  ${r.path.padEnd(50)} ${r.updated_at}`));

process.exit(0);
