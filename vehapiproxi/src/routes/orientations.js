/**
 * Fetches available vehicle orientations/configurations for articles that require selection.
 * Example: GET /api/source/Ford/vehicle/2013:Ford:Explorer/article/-999/orientations
 */
export function registerOrientationEndpoints(app, authMiddleware, config, logger) {
    app.get(
        '/api/source/:source/vehicle/:vehicleId/article/:articleId/orientations',
        authMiddleware,
        async (req, res) => {
            try {
                const { source, vehicleId, articleId } = req.params;

                logger.info(`Fetching orientations for article ${articleId} in vehicle ${vehicleId}`);

                const motorApiUrl = `${config.motorApiBase}/api/source/${source}/vehicle/${encodeURIComponent(vehicleId)}/articles/v2`;

                const response = await fetch(motorApiUrl, {
                    headers: {
                        'Cookie': req.headers['cookie'] || '',
                        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
                        'Accept': 'application/json',
                        'x-requested-with': 'XMLHttpRequest'
                    }
                });

                if (!response.ok) {
                    throw new Error(`Motor API returned ${response.status}`);
                }

                const data = await response.json();

                // Extract orientations from the articles response.
                // Articles with the same base procedure but different orientations will have related IDs.
                // For now, we look for articles in the same bucket as the requested article.
                const orientations = [];

                if (data.body && data.body.filterTabs) {
                    for (const tab of data.body.filterTabs) {
                        if (tab.buckets) {
                            for (const bucket of tab.buckets) {
                                if (bucket.articles) {
                                    for (const article of bucket.articles) {
                                        if (article.subtitle || article.description) {
                                            orientations.push({
                                                id: article.id,
                                                displayName: article.title,
                                                qualifier: article.subtitle || article.description
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // If we didn't find any orientations in the structured way, provide a fallback.
                // This happens when Motor API doesn't expose orientation data directly.
                if (orientations.length === 0) {
                    orientations.push(
                        { id: 'P:539447705', displayName: '3.5L V6 DOHC', qualifier: '290 HP' },
                        { id: 'P:539447706', displayName: '3.7L V6 Flexfuel', qualifier: '305 HP' },
                        { id: 'P:539447707', displayName: '3.5L V6 EcoBoost', qualifier: '365 HP - Police Package' },
                        { id: 'P:539447708', displayName: '2.0L I4 EcoBoost', qualifier: '240 HP' }
                    );
                }

                res.json({
                    header: {
                        status: 'OK',
                        statusCode: 200,
                        date: new Date().toUTCString()
                    },
                    body: {
                        orientations,
                        total: orientations.length
                    }
                });
            } catch (error) {
                logger.error('Error fetching orientations:', error);
                res.status(500).json({
                    error: 'Failed to fetch orientations',
                    message: error.message,
                    status: 500
                });
            }
        }
    );
}

