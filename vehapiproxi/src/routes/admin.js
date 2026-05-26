/**
 * Admin endpoints — DB stats, worker management helpers.
 * Mounted at /admin/* and only reachable from localhost (enforced by gateway).
 */
import { Router } from 'express';
import { dbQuery } from '../db.js';

const router = Router();

router.get('/db-stats', async (_req, res) => {
    try {
        // Use pg_class fast estimates for large tables; exact counts for small ones.
        // Single query — uses one connection, avoids pool contention.
        // pg_class for large tables (instant estimate); exact COUNT for small ones.
        const { rows: [r] } = await dbQuery(`
            SELECT
                (SELECT reltuples::bigint FROM pg_class WHERE relname = 'articles')        AS articles,
                (SELECT COUNT(*)::int       FROM vehicles)                                 AS vehicles,
                (SELECT COUNT(*)::int       FROM vehicles WHERE is_normalized = TRUE)      AS normalized,
                (SELECT COUNT(*)::int       FROM dtcs)                                     AS dtcs,
                (SELECT reltuples::bigint   FROM pg_class WHERE relname = 'ai_processing_logs') AS ai_logs
        `);
        res.json({
            articles: r.articles,
            vehicles: r.vehicles,
            normalized: r.normalized,
            dtcs: r.dtcs,
            procedures: null,
            aiLogs: r.ai_logs,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
