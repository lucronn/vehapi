/**
 * Persist Motor `articles/v2` catalog JSON to Cloud SQL (articles + content_item + vehicle flag).
 * Extracted from background_worker so CLI and worker can reuse the same path.
 */
import crypto from 'node:crypto';
import {
    insertParsedData,
    ensureVehicleExists,
    markVehicleNormalized,
    insertEvidenceIngest,
    getSupabaseConfig
} from '../supabase.js';
import { dbQuery } from '../db.js';
import {
    buildArticlesTableRowFromMotorCatalogArticle,
    buildContentItemFromCatalogArticle
} from '../content_item_mapper.js';
import logger from '../logger.js';

function uniqueMotorArticleIds(details) {
    const map = new Map();
    for (const a of details) {
        const id = a && a.id != null ? String(a.id).trim() : '';
        if (!id) continue;
        map.set(id, true);
    }
    return [...map.keys()];
}

async function verifyCatalogCountsPostUpsert(vehicleIdStr, contentSource, uniqueIds) {
    if (uniqueIds.length === 0) return { ok: true };
    const [articleResult, contentItemResult] = await Promise.all([
        dbQuery(
            `SELECT COUNT(*)::int AS cnt FROM articles WHERE vehicle_id = $1 AND original_id = ANY($2)`,
            [vehicleIdStr, uniqueIds]
        ),
        dbQuery(
            `SELECT COUNT(*)::int AS cnt FROM content_item WHERE vehicle_external_id = $1 AND content_source = $2 AND motor_article_id = ANY($3)`,
            [vehicleIdStr, contentSource, uniqueIds]
        ),
    ]);
    const articleCount = articleResult.rows[0]?.cnt ?? 0;
    const contentItemCount = contentItemResult.rows[0]?.cnt ?? 0;
    const n = uniqueIds.length;
    if (articleCount !== n || contentItemCount !== n) {
        return {
            ok: false,
            error: `Post-upsert counts mismatch articles=${articleCount} content_item=${contentItemCount} expected=${n}`
        };
    }
    return { ok: true };
}

export function extractVehicleIdFromPath(urlPath) {
    const m = String(urlPath || '').match(/vehicle\/([^/?]+)/);
    return m ? m[1] : null;
}

export function extractContentSourceFromPath(urlPath) {
    const m = String(urlPath || '').match(/\/source\/([^/]+)\//i);
    return m ? m[1] : 'MOTOR';
}

/**
 * @param {{ urlPath: string, rawUtf8: string, dryRun?: boolean, skipCatalogVerification?: boolean }} opts
 * @returns {Promise<{ success: boolean, error?: string, articleCount?: number, contentItemCount?: number, dryRun?: boolean }>}
 */
export async function ingestArticlesCatalogFromMotorJson({
    urlPath,
    rawUtf8,
    dryRun = false,
    skipCatalogVerification = false
}) {
    const vehicleIdStr = extractVehicleIdFromPath(urlPath);
    if (!vehicleIdStr) {
        return { success: false, error: 'Could not extract vehicle_id from urlPath' };
    }

    let parsedJson;
    try {
        parsedJson = typeof rawUtf8 === 'string' ? JSON.parse(rawUtf8) : rawUtf8;
    } catch (e) {
        return { success: false, error: `JSON parse: ${e.message}` };
    }

    const details = parsedJson?.body?.articleDetails;
    if (!Array.isArray(details)) {
        return { success: false, error: 'Missing body.articleDetails array' };
    }

    const contentSource = extractContentSourceFromPath(urlPath);
    const rawStr = typeof rawUtf8 === 'string' ? rawUtf8 : JSON.stringify(rawUtf8);

    const uniqueIds = uniqueMotorArticleIds(details);

    if (dryRun) {
        return {
            success: true,
            dryRun: true,
            articleCount: uniqueIds.length,
            contentItemCount: uniqueIds.length
        };
    }

    await ensureVehicleExists(vehicleIdStr, contentSource);

    const sha256 = crypto.createHash('sha256').update(rawStr).digest('hex');
    const ev = await insertEvidenceIngest({
        url_path: urlPath.slice(0, 4000),
        http_status: 200,
        content_type: 'application/json',
        body_json: {
            kind: 'articles_v2_catalog',
            articleCount: details.length
        },
        sha256,
        vehicle_external_id: vehicleIdStr,
        content_source: contentSource,
        source_label: 'articles_v2_catalog'
    });
    if (!ev.success) {
        logger.warn(`evidence_ingest (catalog) skipped: ${ev.error}`);
    }

    const articles = details.map((a) =>
        buildArticlesTableRowFromMotorCatalogArticle(a, vehicleIdStr, contentSource)
    );
    const result = await insertParsedData('articles', articles);
    if (!result.success) {
        return {
            success: false,
            error: result.error?.message || result.error || 'Articles insert failed'
        };
    }

    const ciRows = details.map((a) =>
        buildContentItemFromCatalogArticle(a, vehicleIdStr, contentSource)
    );
    const ciResult = await insertParsedData('content_item', ciRows);
    if (!ciResult.success) {
        logger.error(`content_item upsert failed: ${ciResult.error?.message || ciResult.error}`);
        return {
            success: false,
            error: ciResult.error?.message || ciResult.error || 'content_item insert failed'
        };
    }

    const relaxed =
        skipCatalogVerification ||
        String(process.env.RELAXED_COMPLETION || '').toLowerCase() === 'true' ||
        process.env.RELAXED_COMPLETION === '1';

    if (!relaxed && uniqueIds.length > 0) {
        if (!getSupabaseConfig()) {
            return { success: false, error: 'DB not configured for catalog verification' };
        }
        try {
            const chk = await verifyCatalogCountsPostUpsert(vehicleIdStr, contentSource, uniqueIds);
            if (!chk.ok) {
                return { success: false, error: chk.error || 'catalog verification failed' };
            }
        } catch (ve) {
            return { success: false, error: String(ve?.message || ve) };
        }
    }

    if (articles.length > 0) {
        await markVehicleNormalized(vehicleIdStr);
    }

    return {
        success: true,
        articleCount: uniqueIds.length,
        contentItemCount: ciRows.length
    };
}
