#!/usr/bin/env node
/**
 * One-shot script: extract DTC articles from already-downloaded articles_v2.json files
 * and upsert into the dtcs table.
 *
 * Usage: node scripts/ingest-dtcs-from-local.mjs [--dry-run]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOTOR_ROOT = path.resolve(__dirname, '..', '..', 'data', 'raw', 'MOTOR');
const DRY_RUN = process.argv.includes('--dry-run');

const envPath = path.resolve(__dirname, '..', '.env');
try {
    const { config } = await import('dotenv');
    config({ path: envPath });
} catch { /* dotenv optional */ }

const { dbQuery } = await import('../src/db.js');
const { ensureVehicleExists } = await import('../src/db.service.js');

async function upsertDtcBatch(rows) {
    if (!rows.length) return { ok: true, count: 0 };
    // Build VALUES list
    const vals = [];
    const params = [];
    let i = 1;
    for (const r of rows) {
        vals.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
        params.push(r.vehicle_id, r.code, r.description ?? null, r.external_id ?? null);
    }
    const sql = `
        INSERT INTO dtcs (vehicle_id, code, description, external_id)
        VALUES ${vals.join(',')}
        ON CONFLICT (vehicle_id, code) DO UPDATE SET
            description = EXCLUDED.description,
            external_id = COALESCE(EXCLUDED.external_id, dtcs.external_id),
            updated_at = now()
    `;
    await dbQuery(sql, params);
    return { ok: true, count: rows.length };
}

async function main() {
    const dirs = await fs.readdir(MOTOR_ROOT, { withFileTypes: true });
    let processed = 0, skipped = 0, errors = 0, totalDtcs = 0;

    for (const ent of dirs) {
        if (!ent.isDirectory()) continue;
        const safeDir = ent.name;
        const f = path.join(MOTOR_ROOT, safeDir, 'articles_v2.json');
        let rawUtf8;
        try {
            rawUtf8 = await fs.readFile(f, 'utf8');
        } catch {
            continue;
        }

        if (!rawUtf8.includes('"Diagnostic Trouble Codes"')) {
            skipped++;
            continue;
        }

        let parsed;
        try { parsed = JSON.parse(rawUtf8); } catch { continue; }
        const details = parsed?.body?.articleDetails;
        if (!Array.isArray(details)) { skipped++; continue; }

        const vehicleId = safeDir.replace('_', ':');

        const dtcMap = new Map();
        for (const a of details) {
            if (!a?.bucket?.toLowerCase?.().includes('diagnostic trouble')) continue;
            const code = String(a.code ?? a.title ?? '').trim();
            if (!code || dtcMap.has(code)) continue;
            dtcMap.set(code, {
                vehicle_id: vehicleId,
                code,
                description: a.description ? String(a.description).trim() : null,
                external_id: String(a.id ?? '').trim() || null
            });
        }

        const dtcRows = [...dtcMap.values()];
        if (!dtcRows.length) { skipped++; continue; }

        if (DRY_RUN) {
            processed++;
            totalDtcs += dtcRows.length;
            process.stdout.write(`[dry-run] ${safeDir}: ${dtcRows.length} DTCs\n`);
            continue;
        }

        try {
            await ensureVehicleExists(vehicleId, 'MOTOR');
            const r = await upsertDtcBatch(dtcRows);
            processed++;
            totalDtcs += r.count;
            process.stdout.write(`[${processed}] ${safeDir}: ${r.count} DTCs\n`);
        } catch (e) {
            errors++;
            process.stderr.write(`[error] ${safeDir}: ${e.message}\n`);
        }
    }

    process.stdout.write(`\nDone. processed=${processed} skipped=${skipped} errors=${errors} totalDtcs=${totalDtcs}\n`);
    process.exit(0);
}

main().catch((e) => {
    process.stderr.write(`Fatal: ${e.message}\n${e.stack}\n`);
    process.exitCode = 1;
});
