/**
 * Serving endpoints for normalized content (Phase 5).
 *
 *   GET  /api/db/vehicle/:vehicleId/article/:articleId/steps
 *        Returns AtomicStep rows for a procedure article.
 *
 *   GET  /api/db/vehicle/:vehicleId/dtc/:code/tree
 *        Returns the full LogicNode tree for a DTC code.
 *
 *   POST /api/db/vehicle/:vehicleId/article/:articleId/normalize
 *        Trigger normalization synchronously (admin/debug use).
 */
import { Router } from 'express';
import logger from '../logger.js';
import { getAtomicSteps, getProcedureByArticleId } from '../repositories/procedures.repo.js';
import { getLogicTree, getDtcByCode } from '../repositories/dtcs.repo.js';
import { normalizeArticle } from '../services/normalization.service.js';
import { checkArticleContent } from '../db.service.js';

const router = Router();

// GET /api/db/vehicle/:vehicleId/article/:articleId/steps
router.get('/vehicle/:vehicleId/article/:articleId/steps', async (req, res) => {
    const vehicleId = decodeURIComponent(req.params.vehicleId);
    const articleId = decodeURIComponent(req.params.articleId);
    try {
        const procedure = await getProcedureByArticleId(vehicleId, articleId);
        if (!procedure) {
            return res.status(404).json({
                header: { status: 'NOT_FOUND', statusCode: 404 },
                error: `No normalized procedure for article ${articleId}`,
            });
        }
        const steps = await getAtomicSteps(procedure.id);
        res.json({
            header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' },
            body: {
                procedureId: procedure.id,
                title: procedure.title,
                steps,
            },
        });
    } catch (e) {
        logger.error('[normalization/steps]', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/db/vehicle/:vehicleId/dtc/:code/tree
router.get('/vehicle/:vehicleId/dtc/:code/tree', async (req, res) => {
    const vehicleId = decodeURIComponent(req.params.vehicleId);
    const code = req.params.code.toUpperCase();
    try {
        const dtc = await getDtcByCode(vehicleId, code);
        const nodes = await getLogicTree(vehicleId, code);
        if (!nodes.length) {
            return res.status(404).json({
                header: { status: 'NOT_FOUND', statusCode: 404 },
                error: `No diagnostic tree for ${code}`,
            });
        }
        res.json({
            header: { status: 'OK', statusCode: 200, dataSource: 'cloudsql' },
            body: {
                code,
                description: dtc?.description,
                treeId: nodes[0]?.tree_id,
                nodes,
            },
        });
    } catch (e) {
        logger.error('[normalization/dtc-tree]', e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/db/vehicle/:vehicleId/article/:articleId/normalize  (admin only)
router.post('/vehicle/:vehicleId/article/:articleId/normalize', async (req, res) => {
    const vehicleId = decodeURIComponent(req.params.vehicleId);
    const articleId = decodeURIComponent(req.params.articleId);
    try {
        const articleRow = await checkArticleContent(vehicleId, articleId);
        if (!articleRow?.original_content) {
            return res.status(404).json({ error: `No raw HTML cached for article ${articleId}` });
        }
        const result = await normalizeArticle(vehicleId, articleId, articleRow.original_content, {
            title: articleRow.title,
            bucket: articleRow.bucket,
        });
        res.json({ ok: true, ...result });
    } catch (e) {
        logger.error('[normalization/trigger]', e);
        res.status(500).json({ error: e.message });
    }
});

export default router;
