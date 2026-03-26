/**
 * Resolves numeric make IDs to make names for Motor API compatibility.
 * The upstream Motor API expects make *names* in the path.
 */
const defaultFetchHeaders = (config, req) => ({
    'Cookie': req.headers['cookie'] || '',
    'User-Agent': req.headers['user-agent'] || config.userAgent,
    'Accept': 'application/json',
    'x-requested-with': 'XMLHttpRequest',
    'Referer': 'https://sites.motor.com/m1/'
});

/**
 * @param {string} year
 * @param {number} makeId
 * @param {'api'|'motor'} basePath — `api` → /api/year/.../models; `motor` → /api/motor/year/.../models
 * @param {*} config
 * @param {*} req
 * @param {*} logger
 * @returns {Promise<{ statusCode: number, payload: unknown }>}
 */
async function resolveNumericMake(year, makeId, basePath, config, req, logger) {
    const makesPath = `/api/year/${year}/makes`;
    let makesList = null;

    try {
        const { getMetadata } = await import('../supabase.js');
        const cached = await getMetadata(makesPath);
        if (cached?.data) {
            const body = cached.data.body ?? cached.data;
            if (Array.isArray(body)) {
                makesList = body;
            }
        }
    } catch (e) {
        logger.warn('vehicle_metadata cache miss for makes, falling back to Motor', e?.message || e);
    }

    if (makesList == null) {
        const makesUrl = `${config.motorApiBase}/api/year/${year}/makes`;
        const makesRes = await fetch(makesUrl, {
            headers: defaultFetchHeaders(config, req)
        });

        if (!makesRes.ok) {
            throw new Error(`Motor API returned ${makesRes.status} for makes list`);
        }

        const makesData = await makesRes.json();
        const raw = makesData.body || makesData;
        makesList = Array.isArray(raw) ? raw : [];
    }

    const matched = makesList.find(m => m.makeId == makeId);

    if (!matched) {
        return {
            statusCode: 404,
            payload: {
                header: { status: 'Not Found', statusCode: 404 },
                body: { error: `No make found with ID ${makeId} for year ${year}` }
            }
        };
    }

    logger.info(`Resolved make ID ${makeId} → "${matched.makeName}"${basePath === 'motor' ? ' (motor path)' : ''}`);

    const modelsMetadataPath = basePath === 'motor'
        ? `/api/motor/year/${year}/make/${matched.makeName}/models`
        : `/api/year/${year}/make/${matched.makeName}/models`;

    let modelsData = null;
    let modelsStatus = 200;

    try {
        const { getMetadata } = await import('../supabase.js');
        const cached = await getMetadata(modelsMetadataPath);
        if (cached?.data) {
            modelsData = cached.data;
        }
    } catch (e) {
        logger.warn('vehicle_metadata cache miss for models, falling back to Motor', e?.message || e);
    }

    if (modelsData == null) {
        const modelsUrl = basePath === 'motor'
            ? `${config.motorApiBase}/api/motor/year/${year}/make/${matched.makeName}/models`
            : `${config.motorApiBase}/api/year/${year}/make/${matched.makeName}/models`;

        logger.info(`Proxying to: ${modelsUrl}`);

        const modelsRes = await fetch(modelsUrl, {
            headers: {
                ...defaultFetchHeaders(config, req),
                'Origin': 'https://sites.motor.com'
            }
        });

        modelsData = await modelsRes.json();
        modelsStatus = modelsRes.status;
    }

    return { statusCode: modelsStatus, payload: modelsData };
}

export function registerMakeIdResolutionEndpoints(app, authMiddleware, config, logger) {
    // Handle /api/year/:year/make/:make/models
    app.get('/api/year/:year/make/:make/models', authMiddleware, async (req, res, next) => {
        const { year, make } = req.params;

        // If 'make' is NOT purely numeric, it's already a name — let the proxy handle it
        if (!/^\d+$/.test(make)) {
            return next();
        }

        const makeId = parseInt(make, 10);
        logger.info(`Make ID ${makeId} detected — resolving to make name for year ${year}`);

        try {
            const { statusCode, payload } = await resolveNumericMake(year, makeId, 'api', config, req, logger);
            res.status(statusCode).json(payload);
        } catch (error) {
            logger.error('Make ID resolution failed:', error);
            res.status(500).json({
                error: 'Failed to resolve make ID',
                message: error.message,
                status: 500
            });
        }
    });

    // Handle /api/motor/year/:year/make/:make/models (numeric make ID)
    app.get('/api/motor/year/:year/make/:make/models', authMiddleware, async (req, res, next) => {
        const { year, make } = req.params;

        if (!/^\d+$/.test(make)) {
            return next();
        }

        const makeId = parseInt(make, 10);
        logger.info(`Make ID ${makeId} detected (motor path) — resolving for year ${year}`);

        try {
            const { statusCode, payload } = await resolveNumericMake(year, makeId, 'motor', config, req, logger);
            res.status(statusCode).json(payload);
        } catch (error) {
            logger.error('Make ID resolution (motor) failed:', error);
            res.status(500).json({
                error: 'Failed to resolve make ID',
                message: error.message,
                status: 500
            });
        }
    });
}
