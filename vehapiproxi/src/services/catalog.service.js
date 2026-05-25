/**
 * Catalog service — normalization eligibility decisions and article/reference
 * serving logic. Routes and middlewares call here; all SQL goes through repos.
 */
import { resolveAssociatedVehicleIds } from '../db.service.js';
import { getVehicleArticles, getVehicleArticlesCount, getVehicleIsNormalized } from '../db.service.js';
import { getArticlesByVehicleIds, buildArticleDetails, buildFilterTabs } from '../repositories/articles.repo.js';
import { getFluids, getParts, getMaintenance } from '../repositories/reference.repo.js';

const MIN_CATALOG_ROWS = (() => {
    const v = parseInt(process.env.ARTICLE_CATALOG_MIN_ROWS ?? '10', 10);
    return Number.isFinite(v) && v > 0 ? v : 10;
})();

/**
 * Decides whether a vehicle's article catalog should be served from Cloud SQL.
 * Pure function — no I/O.
 */
export function isCatalogEligible({ count, isNormalized }) {
    return isNormalized === true && count >= MIN_CATALOG_ROWS;
}

/**
 * Build the Motor-shaped article catalog response body from DB article rows.
 * Used by articlesCacheMiddleware (via getVehicleArticles) and the REST endpoint.
 * Returns null when no articles exist.
 */
export async function buildCatalogResponseBody(vehicleId, { buildMenu }) {
    const articles = await getVehicleArticles(vehicleId);
    if (!articles?.length) return null;
    return {
        articleDetails: buildArticleDetails(articles),
        filterTabs: buildFilterTabs(articles),
        normalizedMenu: buildMenu(articles),
    };
}

/**
 * Fetch + shape article catalog for the REST endpoint (`/api/db/articles`).
 * Resolves all ID forms, queries articles table, shapes response.
 * Returns null when no articles are ingested.
 */
export async function getArticleCatalog(vehicleId) {
    const ids = await resolveAssociatedVehicleIds(vehicleId);
    const rows = await getArticlesByVehicleIds(ids);
    if (!rows.length) return null;
    return {
        ids,
        articleDetails: buildArticleDetails(rows),
        filterTabs: buildFilterTabs(rows),
    };
}

/**
 * Fetch reference data (fluids / parts / maintenance) from Cloud SQL for a
 * normalized vehicle.  Returns `{ body }` on success, or `null` when the vehicle
 * isn't normalized or has no data of that type (caller should fall through to Motor).
 *
 * @param {string} vehicleId
 * @param {'fluids'|'parts'|'maintenance'} type
 * @param {{ interval?: number, freqCode?: string }} opts
 */
export async function getReferenceData(vehicleId, type, opts = {}) {
    const isNormalized = await getVehicleIsNormalized(vehicleId);
    if (isNormalized !== true) return null;

    const ids = await resolveAssociatedVehicleIds(vehicleId);

    if (type === 'fluids') {
        const data = await getFluids(ids);
        return data.length ? { data } : null;
    }
    if (type === 'parts') {
        const items = await getParts(ids);
        return items.length ? { items } : null;
    }
    // maintenance (intervals or frequency)
    const items = await getMaintenance(ids, opts);
    return items.length ? { items } : null;
}
