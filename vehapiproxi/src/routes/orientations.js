/**
 * Fetches available vehicle orientations/configurations for articles that require selection.
 * Prefers Supabase articles table; falls back to Motor articles/v2 when Supabase is empty.
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

                // Supabase-first: articles table has subtitle/description
                let orientations = [];
                try {
                    const { getVehicleArticles } = await import('../db.service.js');
                    const articles = await getVehicleArticles(vehicleId);
                    if (articles && articles.length > 0) {
                        orientations = articles
                            .filter(a => a.subtitle || a.description)
                            .map(a => ({
                                id: a.original_id,
                                displayName: a.title,
                                qualifier: a.subtitle || a.description
                            }));
                    }
                } catch (e) {
                    logger.warn('Orientations Supabase fallback:', e?.message);
                }

                // Fall back to Motor if Supabase yielded nothing
                if (orientations.length === 0) {
                    const motorApiUrl = `${config.motorApiBase}/api/source/${source}/vehicle/${encodeURIComponent(vehicleId)}/articles/v2`;
                    const response = await fetch(motorApiUrl, {
                        headers: {
                            'Cookie': req.headers['cookie'] || '',
                            'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
                            'Accept': 'application/json',
                            'x-requested-with': 'XMLHttpRequest'
                        }
                    });

                    if (response.ok) {
                        const data = await response.json();
                        if (data.body?.filterTabs) {
                            for (const tab of data.body.filterTabs) {
                                for (const bucket of (tab.buckets || [])) {
                                    for (const article of (bucket.articles || [])) {
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

                res.json({
                    header: { status: 'OK', statusCode: 200, date: new Date().toUTCString() },
                    body: { orientations, total: orientations.length }
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

