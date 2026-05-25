/**
 * Vehicles repository — YMME browse, search, and normalization status queries.
 */
import { dbQuery } from '../db.js';
import logger from '../logger.js';

export async function getYears() {
    const { rows } = await dbQuery(
        `SELECT DISTINCT year FROM vehicles WHERE year IS NOT NULL ORDER BY year DESC`
    );
    return rows.map(r => r.year);
}

export async function getMakesByYear(year) {
    const { rows } = await dbQuery(
        `SELECT DISTINCT make FROM vehicles WHERE year = $1 AND make IS NOT NULL ORDER BY make`,
        [year]
    );
    return rows.map(r => ({ makeName: r.make, make_name: r.make }));
}

export async function searchVehicles({ year, make, q, limit }) {
    const where = [];
    const params = [];
    if (year) { params.push(year); where.push(`year = $${params.length}`); }
    if (make) { params.push(make); where.push(`make ILIKE $${params.length}`); }
    if (q) {
        params.push(`%${q}%`);
        const i = params.length;
        where.push(`(make ILIKE $${i} OR model ILIKE $${i} OR external_id ILIKE $${i})`);
    }
    params.push(limit);
    const sql = `
        SELECT external_id, year, make, model, is_normalized, updated_at
        FROM vehicles
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY is_normalized DESC NULLS LAST, year DESC, make, model
        LIMIT $${params.length}
    `;
    const [{ rows }, { rows: totalRows }] = await Promise.all([
        dbQuery(sql, params),
        dbQuery(`SELECT COUNT(*) AS n FROM vehicles WHERE is_normalized IS TRUE`),
    ]);
    return { vehicles: rows, totalNormalized: Number(totalRows[0].n), returned: rows.length };
}

/**
 * Returns { normalized: boolean, vehicleIds: string[] }.
 * Also proactively marks vehicles as normalized when articles exist but the flag
 * isn't set yet.
 */
export async function checkNormalization(ids) {
    const { rows } = await dbQuery(
        `SELECT external_id, is_normalized FROM vehicles WHERE external_id = ANY($1)`,
        [ids]
    );
    let normalized = rows.some(r => !!r.is_normalized);

    if (!normalized) {
        const { rows: artRows } = await dbQuery(
            `SELECT 1 FROM articles WHERE vehicle_id = ANY($1) LIMIT 1`,
            [ids]
        );
        if (artRows.length > 0) {
            normalized = true;
            dbQuery(
                `UPDATE vehicles SET is_normalized = true, updated_at = NOW() WHERE external_id = ANY($1)`,
                [ids]
            ).catch(err => logger.warn('[vehicles.repo] Proactive normalize update failed:', err.message));
        }
    }

    return { normalized, vehicleIds: rows.map(r => r.external_id) };
}
