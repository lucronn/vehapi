/**
 * Backfill vehicle_metadata_models from vehicle_metadata model-list blobs.
 * Idempotent: ON CONFLICT (base_vehicle_id) DO UPDATE. Safe to re-run.
 *
 *   node scripts/backfill-vehicle-metadata-models.mjs
 */
import 'dotenv/config';
import { dbQuery } from '../src/db.js';

function parseYearMakeFromPath(p) {
    const parts = String(p || '').split('/');
    const yi = parts.indexOf('year');
    const mi = parts.indexOf('make');
    const year = yi !== -1 && parts[yi + 1] ? Number.parseInt(parts[yi + 1], 10) : null;
    const make = mi !== -1 && parts[mi + 1] ? decodeURIComponent(parts[mi + 1]) : null;
    return { year: Number.isFinite(year) ? year : null, make };
}

function toBigIntOrNull(v) {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

async function main() {
    const { rows } = await dbQuery(
        `SELECT path, data FROM vehicle_metadata WHERE path ILIKE '%/models'`
    );
    let upserts = 0, skipped = 0;
    for (const row of rows) {
        const { year, make } = parseYearMakeFromPath(row.path);
        const models = row.data?.body?.models || row.data?.body || [];
        if (!Array.isArray(models)) continue;
        for (const m of models) {
            const baseId = toBigIntOrNull(m?.baseVehicleId);
            if (baseId == null) { skipped++; continue; } // base id is the unique key
            const localId = toBigIntOrNull(m?.id);
            const engineIds = Array.isArray(m?.engines)
                ? m.engines.map(e => toBigIntOrNull(e?.id ?? e?.engineId)).filter(x => x != null)
                : [];
            await dbQuery(
                `INSERT INTO vehicle_metadata_models
                   (base_vehicle_id, year, make, model, model_local_id, engine_ids, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,now())
                 ON CONFLICT (base_vehicle_id) DO UPDATE SET
                   year = EXCLUDED.year, make = EXCLUDED.make, model = EXCLUDED.model,
                   model_local_id = EXCLUDED.model_local_id, engine_ids = EXCLUDED.engine_ids,
                   updated_at = now()`,
                [baseId, year, make, m?.model ?? m?.modelName ?? null, localId, engineIds]
            );
            upserts++;
        }
    }
    console.log(`backfill complete: ${upserts} models upserted, ${skipped} skipped (no baseVehicleId)`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
