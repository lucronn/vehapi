/**
 * /api/data/:table — lightweight data API for the Angular client.
 *
 * Server-proxied Cloud SQL queries for the Angular client.
 * Only whitelisted tables are accessible; all reads are scoped
 * to a vehicle_id or path filter; writes require an authenticated request.
 *
 * GET  /api/data/:table?vehicle_id=:id[&select=col1,col2][&limit=N][&count=1]
 * POST /api/data/:table  { rows: [...], onConflict?: 'col1,col2' }
 */
import express from 'express';
import { dbQuery, isDbConfigured } from '../db.js';
import { resolveAssociatedVehicleIds } from '../db.service.js';
import logger from '../logger.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Whitelist — only expose tables the Angular client legitimately needs
// ---------------------------------------------------------------------------
const READABLE_TABLES = new Set([
    'articles', 'specifications', 'spec_fact', 'parts',
    'maintenance_task', 'maintenance_schedules',
    'vehicles', 'vehicle_metadata', 'content_item',
    'procedures', 'dtcs', 'tsbs',
    'common_issues_cache'
]);

const WRITABLE_TABLES = new Set([
    'vehicles', 'vehicle_metadata', 'common_issues_cache', 'parts'
]);

// Columns allowed in SELECT (prevent injection; client can request a subset)
const SAFE_COL = /^[a-z_][a-z0-9_]*$/;

function sanitizeCols(selectParam) {
    if (!selectParam || selectParam === '*') return null; // null = SELECT *
    const cols = selectParam.split(',').map(c => c.trim()).filter(c => SAFE_COL.test(c));
    return cols.length ? cols : null;
}

// ---------------------------------------------------------------------------
// GET /api/data/:table
// ---------------------------------------------------------------------------
router.get('/:table', async (req, res) => {
    const { table } = req.params;

    if (!READABLE_TABLES.has(table)) {
        return res.status(404).json({ error: `Table '${table}' not available` });
    }
    if (!isDbConfigured()) {
        return res.status(503).json({ error: 'DB not configured' });
    }

    const vehicleId = req.query.vehicle_id;
    const path      = req.query.path;
    const countOnly = req.query.count === '1' || req.query.count === 'true';
    const limit     = Math.min(Number.parseInt(req.query.limit || '1000', 10), 10000);
    const cols      = sanitizeCols(req.query.select);

    // vehicle_metadata uses path as key; everything else requires vehicle_id
    if (table === 'vehicle_metadata') {
        if (!path) return res.status(400).json({ error: 'path required for vehicle_metadata' });
    } else {
        if (!vehicleId) return res.status(400).json({ error: 'vehicle_id required' });
    }

    try {
        // Vehicle-keyed rows are stored under composite/URL-encoded ids (e.g. "271368%3A16420"),
        // while the client passes the raw route id ("271368:16420"). Resolve all associated
        // id forms so the filter matches the ingested rows.
        const idCol = (table === 'content_item') ? 'vehicle_external_id' : 'vehicle_id';
        const associatedIds = (table === 'vehicle_metadata')
            ? null
            : await resolveAssociatedVehicleIds(vehicleId);

        if (countOnly) {
            if (table === 'vehicle_metadata') {
                const { rows } = await dbQuery(
                    `SELECT COUNT(*)::int AS count FROM vehicle_metadata WHERE path = $1`,
                    [path]
                );
                return res.json({ count: rows[0]?.count ?? 0 });
            }
            const { rows } = await dbQuery(
                `SELECT COUNT(*)::int AS count FROM "${table}" WHERE "${idCol}" = ANY($1)`,
                [associatedIds]
            );
            return res.json({ count: rows[0]?.count ?? 0 });
        }

        const selectClause = cols ? cols.map(c => `"${c}"`).join(', ') : '*';

        let sql, params;
        if (table === 'vehicle_metadata') {
            sql    = `SELECT ${selectClause} FROM vehicle_metadata WHERE path = $1 LIMIT $2`;
            params = [path, limit];
        } else {
            sql    = `SELECT ${selectClause} FROM "${table}" WHERE "${idCol}" = ANY($1) LIMIT $2`;
            params = [associatedIds, limit];
        }

        const { rows } = await dbQuery(sql, params);
        return res.json({ data: rows, count: rows.length });
    } catch (err) {
        logger.error(`[data-api] GET ${table}:`, err);
        return res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/data/:table — upsert (requires auth, handled by caller middleware)
// ---------------------------------------------------------------------------
router.post('/:table', async (req, res) => {
    const { table } = req.params;

    if (!WRITABLE_TABLES.has(table)) {
        return res.status(403).json({ error: `Table '${table}' is not writable via this API` });
    }
    if (!isDbConfigured()) {
        return res.status(503).json({ error: 'DB not configured' });
    }

    let { rows, onConflict } = req.body || {};
    if (!rows) rows = req.body; // allow bare array body
    if (!Array.isArray(rows)) rows = [rows];
    if (rows.length === 0) return res.json({ success: true, count: 0 });

    try {
        const cols = Object.keys(rows[0]);
        const colList = cols.map(c => `"${c}"`).join(', ');
        const flatValues = [];

        const valueSets = rows.map(row => {
            const placeholders = cols.map(col => {
                const v = row[col];
                if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
                    flatValues.push(JSON.stringify(v));
                    return `$${flatValues.length}::jsonb`;
                }
                flatValues.push(v ?? null);
                return `$${flatValues.length}`;
            });
            return `(${placeholders.join(', ')})`;
        });

        let sql = `INSERT INTO "${table}" (${colList}) VALUES ${valueSets.join(', ')}`;

        if (onConflict) {
            const conflictKeys = onConflict.split(',').map(c => c.trim());
            const conflictList = conflictKeys.map(c => `"${c}"`).join(', ');
            const updateCols = cols.filter(c => !conflictKeys.includes(c));
            if (updateCols.length > 0) {
                const setClause = updateCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');
                sql += ` ON CONFLICT (${conflictList}) DO UPDATE SET ${setClause}`;
            } else {
                sql += ` ON CONFLICT (${conflictList}) DO NOTHING`;
            }
        }

        await dbQuery(sql, flatValues);
        return res.json({ success: true, count: rows.length });
    } catch (err) {
        logger.error(`[data-api] POST ${table}:`, err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;
