/**
 * Vehicle identity: the single authority for parsing vehicle ids and resolving
 * a human-readable name. Deterministic — no fuzzy `data::text LIKE` matching and
 * never matches on the non-unique per-make/year `model.id` alone.
 *
 * Phase 1 of the SQL/API refactor (see docs/plans/2026-05-23-sql-api-refactor.md).
 * `resolveAssociatedVehicleIds` still lives in db.service.js for now and is
 * re-exported here; it moves wholesale in Phase 2.
 */
import { dbQuery } from '../db.js';
import { resolveAssociatedVehicleIds } from '../db.service.js';

export { resolveAssociatedVehicleIds };

const YEAR_RE = /^(19|20)\d{2}$/;
const NUM_RE = /^\d+$/;

/**
 * Classify a raw vehicleId.
 * @returns {{kind:'ymme'|'composite'|'base'|'unknown', raw:string,
 *   year?:string, make?:string, model?:string, baseVehicleId?:string, engineId?:string}}
 */
export function parseVehicleId(raw) {
    const id = decodeURIComponent(String(raw ?? '')).trim();
    if (!id) return { kind: 'unknown', raw: id };

    const parts = id.split(':');
    // year:Make:Model[:...]
    if (parts.length >= 3 && YEAR_RE.test(parts[0])) {
        return { kind: 'ymme', raw: id, year: parts[0], make: parts[1], model: parts.slice(2).join(' ') };
    }
    // baseVehicleId:engineId (both numeric)
    if (parts.length === 2 && NUM_RE.test(parts[0]) && NUM_RE.test(parts[1])) {
        return { kind: 'composite', raw: id, baseVehicleId: parts[0], engineId: parts[1] };
    }
    // bare numeric base id
    if (NUM_RE.test(id)) {
        return { kind: 'base', raw: id, baseVehicleId: id };
    }
    return { kind: 'unknown', raw: id };
}

const UNKNOWN = 'Unknown Vehicle';

/**
 * Resolve a vehicleId to "YEAR MAKE MODEL". Deterministic precedence:
 *   1. year:Make:Model in the id itself.
 *   2. vehicles table exact match on resolved ids.
 *   3. vehicle_metadata_models projection by globally-unique base_vehicle_id;
 *      legacy model.id composites only when (model_local_id, engine) is unambiguous.
 * Returns { name, dataSource }.
 */
export async function resolveVehicleName(raw) {
    const parsed = parseVehicleId(raw);

    if (parsed.kind === 'ymme') {
        return { name: `${parsed.year} ${parsed.make} ${parsed.model}`.trim(), dataSource: 'url-parse' };
    }

    // 2. Authoritative vehicles table (year:Make:Model external_ids)
    const ids = await resolveAssociatedVehicleIds(parsed.raw);
    if (ids?.length) {
        const { rows } = await dbQuery(
            `SELECT year, make, model FROM vehicles
             WHERE external_id = ANY($1) AND year IS NOT NULL AND make IS NOT NULL
             LIMIT 1`,
            [ids]
        );
        if (rows[0]?.year && rows[0]?.make) {
            return {
                name: `${rows[0].year} ${rows[0].make} ${rows[0].model || ''}`.trim(),
                dataSource: 'cloudsql',
            };
        }
    }

    // 3. Projection lookup — exact, never fuzzy.
    if (parsed.baseVehicleId) {
        const baseId = Number(parsed.baseVehicleId);
        // 3a. globally-unique base vehicle id
        const byBase = await dbQuery(
            `SELECT year, make, model FROM vehicle_metadata_models WHERE base_vehicle_id = $1`,
            [baseId]
        );
        if (byBase.rows[0]?.year && byBase.rows[0]?.make) {
            const r = byBase.rows[0];
            return { name: `${r.year} ${r.make} ${r.model || ''}`.trim(), dataSource: 'metadata-projection' };
        }

        // 3b. legacy model.id composite — accept ONLY if unambiguous.
        if (parsed.engineId) {
            const byLocal = await dbQuery(
                `SELECT year, make, model FROM vehicle_metadata_models
                 WHERE model_local_id = $1 AND engine_ids @> ARRAY[$2]::bigint[]`,
                [baseId, Number(parsed.engineId)]
            );
            if (byLocal.rows.length === 1 && byLocal.rows[0].year && byLocal.rows[0].make) {
                const r = byLocal.rows[0];
                return { name: `${r.year} ${r.make} ${r.model || ''}`.trim(), dataSource: 'metadata-projection-local' };
            }
            // >1 match = genuine ambiguity → refuse to guess (this is the
            // Rogue->Dodge class of bug). Fall through to Unknown.
        }
    }

    return { name: UNKNOWN, dataSource: 'fallback' };
}
