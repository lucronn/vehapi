/**
 * Articles repository — all SQL for the articles table.
 * Shared response-shape builders used by both middleware and REST endpoints.
 */
import { dbQuery } from '../db.js';

/**
 * Build the flat articleDetails array from DB rows.
 * parentBucket is intentionally omitted so `bucketsFilledWithArticles` includes
 * these articles (its filter is `!a.parentBucket`).
 */
export function buildArticleDetails(rows) {
    return rows.map(r => ({
        id: r.original_id,
        title: r.title,
        subtitle: r.subtitle,
        code: r.code || undefined,
        description: r.description || undefined,
        bucket: r.bucket,
        thumbnailHref: r.thumbnail_href,
        bulletinNumber: r.bulletin_number || undefined,
        releaseDate: r.release_date || undefined,
        sort: r.sort,
        contentSource: r.content_source || 'MOTOR',
    }));
}

/**
 * Build the filterTabs structure from DB rows (using r.parent_bucket which is
 * always populated in the DB, unlike the API response shape).
 */
export function buildFilterTabs(rows) {
    const tabMap = new Map();
    for (const r of rows) {
        const pb = r.parent_bucket || 'Other';
        const b = r.bucket || pb;
        if (!tabMap.has(pb)) tabMap.set(pb, { name: pb, articlesCount: 0, buckets: new Map() });
        const tab = tabMap.get(pb);
        tab.articlesCount++;
        if (!tab.buckets.has(b)) tabMap.get(pb).buckets.set(b, { name: b, count: 0, sort: 0 });
        tab.buckets.get(b).count++;
    }
    return Array.from(tabMap.values()).map((t, i) => ({
        name: t.name,
        articlesCount: t.articlesCount,
        count: t.articlesCount,
        sort: i,
        buckets: Array.from(t.buckets.values()).sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

/**
 * Fetch all article catalog rows for a resolved set of vehicle IDs, ordered
 * for the article viewer tree (parent_bucket → bucket → sort/title).
 */
export async function getArticlesByVehicleIds(ids) {
    const { rows } = await dbQuery(
        `SELECT original_id, title, subtitle, code, description, bucket, parent_bucket,
                thumbnail_href, bulletin_number, release_date, sort, content_source
         FROM articles
         WHERE vehicle_id = ANY($1)
         ORDER BY parent_bucket NULLS LAST, bucket NULLS LAST, sort, title`,
        [ids]
    );
    return rows;
}

/**
 * Find the Motor composite vehicleId (baseVehicleId:engineId) with the most articles
 * for a resolved set of vehicle IDs.  Returns null when no articles exist.
 */
export async function getMotorIdByVehicleIds(ids) {
    const { rows } = await dbQuery(
        `SELECT vehicle_id, COUNT(*) AS article_count
         FROM articles
         WHERE vehicle_id = ANY($1)
         GROUP BY vehicle_id
         ORDER BY article_count DESC
         LIMIT 10`,
        [ids]
    );
    return rows;
}
