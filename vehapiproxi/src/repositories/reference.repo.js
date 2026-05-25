/**
 * Reference repository — fluids, parts, and maintenance schedule queries.
 * Serves cached Motor reference data for normalized vehicles.
 */
import { dbQuery } from '../db.js';

export async function getFluids(ids) {
    const { rows } = await dbQuery(
        `SELECT name, value, display_text, metadata FROM specifications
         WHERE vehicle_id = ANY($1) AND category = 'Fluids' ORDER BY name`,
        [ids]
    );
    return rows.map(r => ({
        name: r.name,
        title: r.name,
        capacity: r.value || undefined,
        specification: r.display_text || undefined,
        bucket: r.metadata?.bucket || 'Fluids',
    }));
}

export async function getParts(ids) {
    const { rows } = await dbQuery(
        `SELECT part_number, description, manufacturer, list_price, dealer_price FROM parts
         WHERE vehicle_id = ANY($1) ORDER BY part_number`,
        [ids]
    );
    return rows.map(r => ({
        partNumber: r.part_number,
        partDescription: r.description || undefined,
        manufacturer: r.manufacturer || undefined,
        listPrice: r.list_price ?? undefined,
        dealerPrice: r.dealer_price ?? undefined,
    }));
}

/**
 * @param {string[]} ids - resolved vehicle IDs
 * @param {{ interval?: number, freqCode?: string }} opts
 */
export async function getMaintenance(ids, { interval, freqCode } = {}) {
    const where = ['vehicle_id = ANY($1)'];
    const params = [ids];
    if (Number.isFinite(interval)) {
        params.push(interval);
        where.push(`interval_value = $${params.length}`);
    }
    if (freqCode) {
        params.push(freqCode);
        where.push(`frequency_code = $${params.length}`);
    }
    const { rows } = await dbQuery(
        `SELECT action, item, description, frequency_code FROM maintenance_schedules
         WHERE ${where.join(' AND ')} ORDER BY item`,
        params
    );
    return rows.map(r => ({
        action: r.action,
        item: r.item,
        description: r.description || undefined,
        frequency_code: r.frequency_code || undefined,
    }));
}
