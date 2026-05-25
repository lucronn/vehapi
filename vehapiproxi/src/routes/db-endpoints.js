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
 *   GET /api/db/vehicle-motor-id?externalId=2011:Subaru:Tribeca  (resolve year:Make:Model → Motor composite ID)
 */

import { Router } from 'express';
import logger from '../logger.js';
import { resolveAssociatedVehicleIds } from '../db.service.js';
import { getYears, getMakesByYear, searchVehicles, checkNormalization } from '../repositories/vehicles.repo.js';
import { getMotorIdByVehicleIds } from '../repositories/articles.repo.js';
import { getArticleCatalog } from '../services/catalog.service.js';
import { getCachedModels } from '../services/ymme.service.js';

const router = Router();

// GET /api/db/years
router.get('/years', async (_req, res) => {
    try {
        const years = await getYears();
        res.json({ header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' }, body: years });
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
        const makes = await getMakesByYear(year);
        res.json({ header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' }, body: makes });
    } catch (e) {
        logger.error('[db/makes]', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/db/year/:year/make/:make/models
// Returns M1 models with engines nested. Sourced from vehicle_metadata cache
// (which holds the full M1 response we pulled during seeding).
// NOTE: Only serves data when models have Motor numeric IDs (e.g. 685, 685:11883).
// Chek-Chart cached data (year:Model IDs) is rejected to force fallback to live Motor.
router.get('/year/:year/make/:make/models', async (req, res) => {
    const year = Number(req.params.year);
    const make = req.params.make;
    if (!Number.isInteger(year)) return res.status(400).json({ error: 'invalid year' });
    try {
        const result = await getCachedModels(year, make);
        if (!result) {
            return res.status(404).json({
                header: { status: 'NOT_FOUND', statusCode: 404, dataSource: 'cloudsql' },
                error: `No cached models for ${year} ${make}`,
            });
        }
        if (result.chekChart) {
            return res.status(404).json({
                header: { status: 'NOT_FOUND', statusCode: 404, dataSource: 'cloudsql' },
                error: `Cached models for ${year} ${make} use non-Motor IDs — use live API`,
            });
        }
        res.json({
            header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' },
            body: { contentSource: 'MOTOR', models: result.models },
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
        const catalog = await getArticleCatalog(vehicleId);
        if (!catalog) {
            return res.status(404).json({
                header: { status: 'NOT_FOUND', statusCode: 404, dataSource: 'cloudsql' },
                error: `No catalog ingested for vehicle ${vehicleId}`,
                body: { articleDetails: [], grouped: [] },
            });
        }
        res.json({
            header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' },
            body: { vehicleId, articleDetails: catalog.articleDetails, filterTabs: catalog.filterTabs },
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
        const result = await searchVehicles({ year, make, q, limit });
        res.json({ header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' }, body: result });
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
        const { normalized, vehicleIds } = await checkNormalization(ids);
        res.json({
            header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' },
            body: { vehicleId, normalized, vehicleIds },
        });
    } catch (e) {
        logger.error('[db/normalization]', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/db/vehicle-motor-id?externalId=2011:Subaru:Tribeca
// Resolves a year:Make:Model external_id → Motor composite baseVehicleId:engineId
// by finding which articles.vehicle_id belongs to this vehicle via resolveAssociatedVehicleIds.
router.get('/vehicle-motor-id', async (req, res) => {
    const externalId = String(req.query.externalId || '').trim();
    if (!externalId) return res.status(400).json({ error: 'externalId required' });
    try {
        const ids = await resolveAssociatedVehicleIds(externalId);
        const rows = await getMotorIdByVehicleIds(ids);
        if (!rows.length) {
            return res.status(404).json({
                header: { status: 'NOT_FOUND', statusCode: 404, dataSource: 'cloudsql' },
                body: { externalId, motorVehicleId: null },
            });
        }
        const motorVehicleId = decodeURIComponent(rows[0].vehicle_id);
        res.json({
            header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' },
            body: {
                externalId,
                motorVehicleId,
                allIds: rows.map(r => decodeURIComponent(r.vehicle_id)),
                articleCount: Number(rows[0].article_count),
            },
        });
    } catch (e) {
        logger.error('[db/vehicle-motor-id]', e);
        res.status(500).json({ error: e.message });
    }
});

export default router;
