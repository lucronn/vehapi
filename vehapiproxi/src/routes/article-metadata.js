import { getArticleMetadata } from '../supabase.js';
import { bucketToModuleType } from '../article-access.js';

export function registerArticleMetadataEndpoint(app, secureAuthMiddleware, logger) {
    app.get(
        '/api/source/:source/vehicle/:vehicleId/article/:articleId/metadata',
        secureAuthMiddleware,
        async (req, res) => {
            try {
                const { vehicleId, articleId } = req.params;
                const metadata = await getArticleMetadata(vehicleId, articleId);

                if (!metadata) {
                    return res.status(404).json({ error: 'Article not found' });
                }

                const moduleType = bucketToModuleType(metadata.bucket, metadata.parent_bucket);
                res.json({
                    bucket: metadata.bucket,
                    parent_bucket: metadata.parent_bucket,
                    moduleType: moduleType || null
                });
            } catch (error) {
                logger.error('Error fetching article metadata:', error);
                res.status(500).json({ error: error.message });
            }
        }
    );
}

