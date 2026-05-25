/**
 * YMME service — models cache lookup with Chek-Chart/Motor-ID validation.
 */
import { getModelsCacheByPath } from '../repositories/metadata.repo.js';
import logger from '../logger.js';

function unwrapModels(jsonbBody) {
    if (Array.isArray(jsonbBody)) return jsonbBody;
    if (jsonbBody?.models) return jsonbBody.models;
    return [];
}

/**
 * Load cached Motor models for a year/make.
 *
 * Returns:
 *   { models: [...annotated] }   — success, serve from Cloud SQL
 *   { chekChart: true }          — cached data has non-Motor IDs, fall back to live API
 *   null                         — no cache entry
 */
export async function getCachedModels(year, make) {
    const path = `/motor/year/${year}/make/${encodeURIComponent(make)}/models`;
    const cachedData = await getModelsCacheByPath(path);
    if (!cachedData) return null;

    const models = unwrapModels(cachedData?.body);
    if (!models.length) return null;

    // Chek-Chart YMME data stores IDs as "year:ModelName" (e.g. "2022:HR-V") which is
    // incompatible with the article DB. Signal caller to fall back to live Motor.
    const firstId = String(models[0]?.id || '');
    if (!/^\d+(:\d+)?$/.test(firstId)) {
        logger.warn(`[ymme.service] Non-Motor IDs for ${year} ${make} (${firstId}) — signal live fallback`);
        return { chekChart: true };
    }

    const annotated = models.map(m => ({ ...m, engineCount: m.engines?.length || 0 }));
    return { models: annotated };
}
