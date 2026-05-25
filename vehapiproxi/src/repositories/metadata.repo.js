/**
 * Metadata repository — vehicle_metadata cache table queries.
 */
import { dbQuery } from '../db.js';

/**
 * Fetch the cached Motor models response for a year/make combination.
 * Returns the raw JSONB `data` column or null when not found.
 */
export async function getModelsCacheByPath(path) {
    const { rows } = await dbQuery(
        `SELECT data FROM vehicle_metadata WHERE path = $1 LIMIT 1`,
        [path]
    );
    return rows.length ? rows[0].data : null;
}
