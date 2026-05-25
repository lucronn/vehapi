/**
 * Motor Information API (`api.motor.com/v1/Information/...`) — separate from `sites.motor.com/m1` proxy auth.
 */
import {
    getMotorInformationConfig,
    fetchBaseVehicleId,
    fetchEngines,
    fetchRecommendedFluidsRaw,
    normalizeRecommendedFluidsToTorqueShape
} from '../motor_information_api.js';

/**
 * Intercept `GET /api/source/:contentSource/vehicle/:vehicleId/fluids` when Information API is configured
 * and `baseVehicleId` + `engineId` query params are present. Otherwise `next()` to the M1 proxy.
 */
export function registerMotorInformationFluidsIntercept(app, logger) {
    app.get('/api/source/:contentSource/vehicle/:vehicleId/fluids', async (req, res, next) => {
        const cfg = getMotorInformationConfig();
        if (!cfg.enabled) {
            return next();
        }
        const baseVehicleId = req.query.baseVehicleId ?? req.query.motorBaseVehicleId;
        const engineId = req.query.engineId ?? req.query.EN ?? req.query.motorEngineId;
        if (baseVehicleId == null || baseVehicleId === '' || engineId == null || engineId === '') {
            return next();
        }
        try {
            const raw = await fetchRecommendedFluidsRaw(baseVehicleId, engineId);
            const out = normalizeRecommendedFluidsToTorqueShape(raw);
            res.setHeader('x-data-source', 'motor-information-api');
            res.setHeader('x-motor-information', 'recommended-fluids');
            return res.status(200).json(out);
        } catch (e) {
            logger.warn(
                `Motor Information fluids failed (baseVehicleId=${baseVehicleId}, engineId=${engineId}): ${e?.message || e}`
            );
            return next();
        }
    });
}

/**
 * YMME helpers for clients to resolve `baseVehicleId` and engine list (requires Firebase ID token).
 */
export function registerMotorInformationYmmeRoutes(app, secureAuthMiddleware, logger) {
    app.get(
        '/api/motor-information/ymme/base-vehicle',
        secureAuthMiddleware,
        async (req, res) => {
            const cfg = getMotorInformationConfig();
            if (!cfg.enabled) {
                return res.status(503).json({
                    error: 'Motor Information API not configured',
                    hint: 'Set MOTOR_INFORMATION_PUBLIC_KEY and MOTOR_INFORMATION_PRIVATE_KEY'
                });
            }
            const year = req.query.year ?? req.query.Year;
            const make = req.query.make ?? req.query.Make;
            const model = req.query.model ?? req.query.Model;
            if (year == null || make == null || model == null || `${make}`.trim() === '' || `${model}`.trim() === '') {
                return res.status(400).json({ error: 'year, make, and model query parameters are required' });
            }
            try {
                const baseVehicleId = await fetchBaseVehicleId(year, make, model);
                return res.json({ baseVehicleId, year, make, model });
            } catch (e) {
                logger.warn(`motor-information ymme/base-vehicle: ${e?.message || e}`);
                return res.status(502).json({ error: String(e.message || e) });
            }
        }
    );

    app.get('/api/motor-information/ymme/engines', secureAuthMiddleware, async (req, res) => {
        const cfg = getMotorInformationConfig();
        if (!cfg.enabled) {
            return res.status(503).json({
                error: 'Motor Information API not configured',
                hint: 'Set MOTOR_INFORMATION_PUBLIC_KEY and MOTOR_INFORMATION_PRIVATE_KEY'
            });
        }
        const year = req.query.year ?? req.query.Year;
        const make = req.query.make ?? req.query.Make;
        const model = req.query.model ?? req.query.Model;
        if (year == null || make == null || model == null || `${make}`.trim() === '' || `${model}`.trim() === '') {
            return res.status(400).json({ error: 'year, make, and model query parameters are required' });
        }
        try {
            const engines = await fetchEngines(year, make, model);
            return res.json({ engines, year, make, model });
        } catch (e) {
            logger.warn(`motor-information ymme/engines: ${e?.message || e}`);
            return res.status(502).json({ error: String(e.message || e) });
        }
    });
}
