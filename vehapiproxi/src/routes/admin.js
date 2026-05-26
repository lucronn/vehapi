/**
 * Admin endpoints — DB stats, worker management helpers.
 * Mounted at /admin/* and only reachable from localhost (enforced by gateway).
 */
import { Router } from 'express';
import { dbQuery } from '../db.js';

const router = Router();

router.get('/db-stats', async (_req, res) => {
    try {
        const [articles, vehicles, normalized, dtcs, procedures, aiLogs] = await Promise.all([
            dbQuery('SELECT COUNT(*)::int AS n FROM articles').then(r => r.rows[0].n),
            dbQuery('SELECT COUNT(*)::int AS n FROM vehicles').then(r => r.rows[0].n),
            dbQuery("SELECT COUNT(*)::int AS n FROM vehicles WHERE is_normalized = TRUE").then(r => r.rows[0].n),
            dbQuery('SELECT COUNT(*)::int AS n FROM dtcs').then(r => r.rows[0].n),
            dbQuery("SELECT COUNT(*)::int AS n FROM articles WHERE bucket = 'Procedures'").then(r => r.rows[0].n),
            dbQuery('SELECT COUNT(*)::int AS n FROM ai_processing_logs').then(r => r.rows[0].n).catch(() => null),
        ]);
        res.json({ articles, vehicles, normalized, dtcs, procedures, aiLogs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
