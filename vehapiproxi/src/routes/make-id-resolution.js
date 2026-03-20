/**
 * Resolves numeric make IDs to make names for Motor API compatibility.
 * The upstream Motor API expects make *names* in the path.
 */
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
            // 1. Fetch the makes list to resolve ID → name
            const makesUrl = `${config.motorApiBase}/api/year/${year}/makes`;
            const makesRes = await fetch(makesUrl, {
                headers: {
                    'Cookie': req.headers['cookie'] || '',
                    'User-Agent': req.headers['user-agent'] || config.userAgent,
                    'Accept': 'application/json',
                    'x-requested-with': 'XMLHttpRequest',
                    'Referer': 'https://sites.motor.com/m1/'
                }
            });

            if (!makesRes.ok) {
                throw new Error(`Motor API returned ${makesRes.status} for makes list`);
            }

            const makesData = await makesRes.json();
            const makesList = makesData.body || makesData;

            // Use loose equality (==) in case makeId comes back as string from upstream
            const matched = (Array.isArray(makesList) ? makesList : []).find(m => m.makeId == makeId);

            if (!matched) {
                return res.status(404).json({
                    header: { status: 'Not Found', statusCode: 404 },
                    body: { error: `No make found with ID ${makeId} for year ${year}` }
                });
            }

            logger.info(`Resolved make ID ${makeId} → "${matched.makeName}"`);

            // 2. Proxy the models request directly using the resolved make name
            const modelsUrl = `${config.motorApiBase}/api/year/${year}/make/${matched.makeName}/models`;
            logger.info(`Proxying to: ${modelsUrl}`);

            const modelsRes = await fetch(modelsUrl, {
                headers: {
                    'Cookie': req.headers['cookie'] || '',
                    'User-Agent': req.headers['user-agent'] || config.userAgent,
                    'Accept': 'application/json',
                    'x-requested-with': 'XMLHttpRequest',
                    'Referer': 'https://sites.motor.com/m1/',
                    'Origin': 'https://sites.motor.com'
                }
            });

            const modelsData = await modelsRes.json();
            res.status(modelsRes.status).json(modelsData);
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
            const makesUrl = `${config.motorApiBase}/api/year/${year}/makes`;
            const makesRes = await fetch(makesUrl, {
                headers: {
                    'Cookie': req.headers['cookie'] || '',
                    'User-Agent': req.headers['user-agent'] || config.userAgent,
                    'Accept': 'application/json',
                    'x-requested-with': 'XMLHttpRequest',
                    'Referer': 'https://sites.motor.com/m1/'
                }
            });

            if (!makesRes.ok) {
                throw new Error(`Motor API returned ${makesRes.status} for makes list`);
            }

            const makesData = await makesRes.json();
            const makesList = makesData.body || makesData;
            const matched = (Array.isArray(makesList) ? makesList : []).find(m => m.makeId == makeId);

            if (!matched) {
                return res.status(404).json({
                    header: { status: 'Not Found', statusCode: 404 },
                    body: { error: `No make found with ID ${makeId} for year ${year}` }
                });
            }

            logger.info(`Resolved make ID ${makeId} → "${matched.makeName}" (motor path)`);

            const modelsUrl = `${config.motorApiBase}/api/motor/year/${year}/make/${matched.makeName}/models`;
            const modelsRes = await fetch(modelsUrl, {
                headers: {
                    'Cookie': req.headers['cookie'] || '',
                    'User-Agent': req.headers['user-agent'] || config.userAgent,
                    'Accept': 'application/json',
                    'x-requested-with': 'XMLHttpRequest',
                    'Referer': 'https://sites.motor.com/m1/',
                    'Origin': 'https://sites.motor.com'
                }
            });

            const modelsData = await modelsRes.json();
            res.status(modelsRes.status).json(modelsData);
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

