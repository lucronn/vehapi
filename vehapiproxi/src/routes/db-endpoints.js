/**
 * Cloud SQL-backed read endpoints — serve YMME + article catalog from our DB
 * instead of live Motor calls. Frontend hits these for instant responses on
 * already-ingested vehicles.
 *
 *   GET /api/db/years
 *   GET /api/db/year/:year/makes
 *   GET /api/db/year/:year/make/:make/models      (engines nested)
 *   GET /api/db/articles?vehicleId=240542:15305   (grouped by parent_bucket → bucket)
 *   GET /api/db/vehicles?q=&year=&make=&limit=    (search/browse ingested vehicles)
 */
import { Router } from 'express';
import { dbQuery } from '../db.js';
import logger from '../logger.js';
import { resolveAssociatedVehicleIds } from '../supabase.js';

const router = Router();

function unwrapBody(jsonbBody) {
    // vehicle_metadata.data is { header, body } or { header, body: { models: [...] } }
    if (Array.isArray(jsonbBody)) return jsonbBody;
    if (jsonbBody?.models) return jsonbBody.models;
    return [];
}

// GET /api/db/years
router.get('/years', async (_req, res) => {
    try {
        const { rows } = await dbQuery(
            `SELECT DISTINCT year FROM vehicles WHERE year IS NOT NULL ORDER BY year DESC`
        );
        res.json({
            header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' },
            body: rows.map(r => r.year),
        });
    } catch (e) {
        logger.error('[db/years]', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/db/year/:year/makes
router.get('/year/:year/makes', async (req, res) => {
    const year = Number(req.params.year);
    if (!Number.isInteger(year)) return res.status(400).json({ error: 'invalid year' });
    try {
        const { rows } = await dbQuery(
            `SELECT DISTINCT make FROM vehicles WHERE year = $1 AND make IS NOT NULL ORDER BY make`,
            [year]
        );
        res.json({
            header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' },
            body: rows.map(r => ({ makeName: r.make, make_name: r.make })),
        });
    } catch (e) {
        logger.error('[db/makes]', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/db/year/:year/make/:make/models
// Returns M1 models with engines nested. Sourced from vehicle_metadata cache
// (which holds the full M1 response we pulled during seeding).
router.get('/year/:year/make/:make/models', async (req, res) => {
    const year = Number(req.params.year);
    const make = req.params.make;
    if (!Number.isInteger(year)) return res.status(400).json({ error: 'invalid year' });
    try {
        const path = `/motor/year/${year}/make/${encodeURIComponent(make)}/models`;
        const { rows } = await dbQuery(
            `SELECT data FROM vehicle_metadata WHERE path = $1 LIMIT 1`,
            [path]
        );
        if (!rows.length) {
            return res.status(404).json({
                header: { status: 'NOT_FOUND', statusCode: 404, dataSource: 'cloudsql' },
                error: `No cached models for ${year} ${make}`,
            });
        }
        const models = unwrapBody(rows[0].data?.body);
        // Annotate each model with engineCount so the frontend can decide
        // whether to render the engine dropdown.
        const annotated = models.map(m => ({
            ...m,
            engineCount: m.engines?.length || 0,
        }));
        res.json({
            header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' },
            body: { contentSource: 'MOTOR', models: annotated },
        });
    } catch (e) {
        logger.error('[db/models]', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/db/articles?vehicleId=240542:15305
// Returns the ingested article catalog for an M1 vehicle, grouped by
// parent_bucket → bucket → articles, matching the article-viewer tree shape.
router.get('/articles', async (req, res) => {
    const vehicleId = String(req.query.vehicleId || '').trim();
    if (!vehicleId) return res.status(400).json({ error: 'vehicleId required' });
    try {
        const ids = await resolveAssociatedVehicleIds(vehicleId);
        const { rows } = await dbQuery(
            `SELECT original_id, title, subtitle, description, bucket, parent_bucket,
                    thumbnail_href, bulletin_number, release_date, sort, content_source
             FROM articles
             WHERE vehicle_id = ANY($1)
             ORDER BY parent_bucket NULLS LAST, bucket NULLS LAST, sort, title`,
            [ids]
        );
        if (!rows.length) {
            return res.status(404).json({
                header: { status: 'NOT_FOUND', statusCode: 404, dataSource: 'cloudsql' },
                error: `No catalog ingested for vehicle ${vehicleId}`,
                body: { articleDetails: [], grouped: [] },
            });
        }
        // Shape 1: flat articleDetails (matches Motor articles/v2 contract)
        const articleDetails = rows.map(r => ({
            id: r.original_id,
            title: r.title,
            subtitle: r.subtitle,
            description: r.description,
            bucket: r.bucket,
            parentBucket: r.parent_bucket,
            thumbnailHref: r.thumbnail_href,
            bulletinNumber: r.bulletin_number,
            releaseDate: r.release_date,
            sort: r.sort,
            contentSource: r.content_source,
        }));
        // Build filterTabs (top-level categories) with nested buckets — matches
        // the Motor articles/v2 shape that the article-viewer renders directly.
        const tabMap = new Map();
        for (const a of articleDetails) {
            const pb = a.parentBucket || 'Other';
            const b = a.bucket || pb;
            if (!tabMap.has(pb)) tabMap.set(pb, { name: pb, articlesCount: 0, buckets: new Map() });
            const tab = tabMap.get(pb);
            tab.articlesCount++;
            if (!tab.buckets.has(b)) tab.buckets.set(b, { name: b, count: 0, sort: 0 });
            tab.buckets.get(b).count++;
        }
        const filterTabs = Array.from(tabMap.values()).map((t, i) => ({
            name: t.name,
            articlesCount: t.articlesCount,
            count: t.articlesCount,
            sort: i,
            buckets: Array.from(t.buckets.values()).sort((a, b) => a.name.localeCompare(b.name)),
        }));
        res.json({
            header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' },
            body: { vehicleId, articleDetails, filterTabs },
        });
    } catch (e) {
        logger.error('[db/articles]', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/db/vehicles?q=&year=&make=&limit=200
router.get('/vehicles', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const year = req.query.year ? Number(req.query.year) : null;
    const make = req.query.make ? String(req.query.make).trim() : null;
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    try {
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
        const { rows } = await dbQuery(sql, params);
        const [{ rows: totalRows }] = await Promise.all([
            dbQuery(`SELECT COUNT(*) AS n FROM vehicles WHERE is_normalized IS TRUE`),
        ]);
        res.json({
            header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' },
            body: {
                vehicles: rows,
                totalNormalized: Number(totalRows[0].n),
                returned: rows.length,
            },
        });
    } catch (e) {
        logger.error('[db/vehicles]', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/db/normalization?vehicleId=16774
// Returns whether any composite engine variant of this vehicleId is marked
// is_normalized in Cloud SQL. Used by the frontend to decide whether to load
// articles from the DB or fall through to the live Motor API.
router.get('/normalization', async (req, res) => {
    const vehicleId = String(req.query.vehicleId || '').trim();
    if (!vehicleId) return res.status(400).json({ error: 'vehicleId required' });
    try {
        const ids = await resolveAssociatedVehicleIds(vehicleId);
        const { rows } = await dbQuery(
            `SELECT external_id, is_normalized FROM vehicles WHERE external_id = ANY($1)`,
            [ids]
        );
        const normalized = rows.some(r => !!r.is_normalized);
        res.json({
            header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' },
            body: { vehicleId, normalized, vehicleIds: rows.map(r => r.external_id) },
        });
    } catch (e) {
        logger.error('[db/normalization]', e);
        res.status(500).json({ error: e.message });
    }
});

export default router;

