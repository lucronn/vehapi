/**
 * Motor DaaS YMME routes — api.motor.com fallback for vehicle selector.
 * Registered AFTER the metadata cache so Cloud SQL still takes priority.
 * On cache miss: calls Motor DaaS YMME, saves result to Cloud SQL.
 */
import { getDaasConfig, fetchDaasYears, fetchDaasMakes, fetchDaasModels } from '../motor_daas_api.js';
import { insertMetadata } from '../db.service.js';

export function registerChekChartYmmeRoutes(app, logger) {
    const cfg = getDaasConfig();
    if (!cfg.enabled) {
        logger.info('[Motor DaaS] MOTOR_FLUIDS_PUBLIC_KEY not set — YMME routes disabled');
        return;
    }
    logger.info('[Motor DaaS] YMME routes active (api.motor.com)');

    app.get('/api/years', async (req, res) => {
        try {
            const data = await fetchDaasYears();
            void insertMetadata('/years', data).catch(() => {});
            res.setHeader('x-data-source', 'motor-daas');
            return res.json(data);
        } catch (err) {
            logger.error('[Motor DaaS] /api/years failed:', err.message);
            return res.status(502).json({ error: err.message });
        }
    });

    app.get('/api/year/:year/makes', async (req, res) => {
        const { year } = req.params;
        try {
            const data = await fetchDaasMakes(year);
            void insertMetadata(`/year/${year}/makes`, data).catch(() => {});
            res.setHeader('x-data-source', 'motor-daas');
            return res.json(data);
        } catch (err) {
            logger.error(`[Motor DaaS] /api/year/${year}/makes failed:`, err.message);
            return res.status(502).json({ error: err.message });
        }
    });

    app.get('/api/year/:year/make/:make/models', async (req, res) => {
        const { year, make } = req.params;
        try {
            const raw = await fetchDaasModels(year, decodeURIComponent(make));
            // Frontend expects body: { contentSource, models: Model[] }
            const data = {
                header: raw.header,
                body: { contentSource: 'MOTOR', models: raw.body },
            };
            void insertMetadata(`/year/${year}/make/${make}/models`, data).catch(() => {});
            res.setHeader('x-data-source', 'motor-daas');
            return res.json(data);
        } catch (err) {
            logger.error(`[Motor DaaS] /api/year/${year}/make/${make}/models failed:`, err.message);
            return res.status(502).json({ error: err.message });
        }
    });
}
