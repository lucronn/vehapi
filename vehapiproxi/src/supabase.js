import logger from './logger.js';

// Use the Supabase REST API directly via fetch - no SDK needed
// This avoids any ESM/CJS module loading issues on Vercel serverless

function getSupabaseConfig() {
    const url = (process.env.SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) return null;
    return { url, key };
}

const UPSERT_CONFLICT_COLUMNS = {
    procedures: 'vehicle_id,title',
    tsbs: 'vehicle_id,bulletin_number',
    dtcs: 'vehicle_id,code',
    specifications: 'vehicle_id,category,name',
    categories: 'name,type'
};

/**
 * Persists normalized data to the specified Supabase table via REST API.
 * Uses UPSERT (merge-duplicates) so re-processed data overwrites stale rows
 * instead of creating duplicates.
 * @param {string} table The target table name (e.g., 'dtcs', 'tsbs', 'procedures')
 * @param {Object|Array} data The parsed data matching the table schema
 */
export async function insertParsedData(table, data) {
    const cfg = getSupabaseConfig();
    if (!cfg) {
        logger.warn(`Skipping Supabase insert into ${table}: credentials not set.`);
        return { success: false, error: 'Supabase credentials not configured' };
    }

    const rows = Array.isArray(data) ? data : [data];
    if (rows.length === 0) {
        return { success: true };
    }

    const onConflict = UPSERT_CONFLICT_COLUMNS[table];
    const prefer = onConflict
        ? 'return=minimal,resolution=merge-duplicates'
        : 'return=minimal';

    try {
        let url = `${cfg.url}/rest/v1/${table}`;
        if (onConflict) {
            url += `?on_conflict=${onConflict}`;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
                'Prefer': prefer
            },
            body: JSON.stringify(rows)
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Supabase REST error on table ${table} [${response.status}]: ${errorText}`);
            return { success: false, error: errorText };
        }

        logger.info(`✓ Upserted ${rows.length} row(s) into Supabase table: ${table}`);
        return { success: true };
    } catch (err) {
        logger.error(`Unexpected error inserting into ${table}:`, err);
        return { success: false, error: err.message };
    }
}

/**
 * Logs the AI processing task to monitor accuracy and failures.
 */
export async function logAiProcessing(logData) {
    const cfg = getSupabaseConfig();
    if (!cfg) return;

    try {
        const response = await fetch(`${cfg.url}/rest/v1/ai_processing_logs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                ...logData,
                processed_at: new Date().toISOString()
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Failed to write to ai_processing_logs [${response.status}]: ${errorText}`);
        }
    } catch (err) {
        logger.error(`Failed to write to ai_processing_logs:`, err);
    }
}

/**
 * Checks for a cached article in the procedures table by its external_id (Motor Article ID).
 * @param {string} articleId The Motor API article ID
 * @returns {Object|null} The cached article data or null if not found
 */
export async function checkParsedArticle(articleId) {
    const cfg = getSupabaseConfig();
    if (!cfg) {
        logger.warn(`Skipping Supabase check for article ${articleId}: credentials not set.`);
        return null;
    }

    try {
        const url = `${cfg.url}/rest/v1/procedures?external_id=eq.${articleId}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Supabase REST error checking article ${articleId} [${response.status}]: ${errorText}`);
            return null;
        }

        const data = await response.json();
        if (data && data.length > 0) {
            logger.info(`✓ Found cached procedure for article ${articleId}`);
            return data[0];
        }
        return null;
    } catch (err) {
        logger.error(`Unexpected error checking Supabase for article ${articleId}:`, err);
        return null;
    }
}

/**
 * Checks whether a given source path was already successfully parsed.
 * Used by the background worker to skip redundant (and rate-limited) AI calls.
 * @param {string} sourcePath The proxy request URL path
 * @returns {boolean}
 */
export async function wasAlreadyParsed(sourcePath) {
    const cfg = getSupabaseConfig();
    if (!cfg) return false;

    try {
        const encoded = encodeURIComponent(sourcePath);
        const url = `${cfg.url}/rest/v1/ai_processing_logs?source_file=eq.${encoded}&status=eq.COMPLETED&select=id&limit=1`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
            },
        });
        if (!response.ok) return false;
        const rows = await response.json();
        return rows && rows.length > 0;
    } catch {
        return false;
    }
}
