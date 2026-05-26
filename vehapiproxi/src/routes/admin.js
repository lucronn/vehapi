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
        const [approx, vehicles, normalized, dtcs, procedures, aiLogs] = await Promise.all([
            dbQuery(`SELECT
                (SELECT reltuples::bigint FROM pg_class WHERE relname='articles') AS articles,
                (SELECT reltuples::bigint FROM pg_class WHERE relname='dtcs') AS dtcs_approx
            `).then(r => r.rows[0]),
            dbQuery('SELECT COUNT(*)::int AS n FROM vehicles').then(r => r.rows[0].n),
            dbQuery('SELECT COUNT(*)::int AS n FROM vehicles WHERE is_normalized = TRUE').then(r => r.rows[0].n),
            null,
            dbQuery("SELECT COUNT(*)::int AS n FROM articles WHERE bucket = 'Procedures'").then(r => r.rows[0].n),
            dbQuery('SELECT COUNT(*)::int AS n FROM ai_processing_logs').then(r => r.rows[0].n).catch(() => null),
        ]);
        res.json({
            articles: approx.articles,
            vehicles,
            normalized,
            dtcs: approx.dtcs_approx,
            procedures,
            aiLogs,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
