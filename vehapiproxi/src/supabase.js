import logger from './logger.js';

// Use the Supabase REST API directly via fetch - no SDK needed
// This avoids any ESM/CJS module loading issues on Vercel serverless

function getSupabaseConfig() {
    const url = (process.env.SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) return null;
    return { url, key };
}

// Conflict keys for upsert; must match DB unique constraints.
// Procedures: DB has UNIQUE(vehicle_id, external_id) — one row per Motor article id.
const PROCEDURES_CONFLICT_COLUMNS = 'vehicle_id,external_id';
const UPSERT_CONFLICT_COLUMNS = {
    procedures: PROCEDURES_CONFLICT_COLUMNS,
    tsbs: 'vehicle_id,bulletin_number',
    dtcs: 'vehicle_id,code',
    specifications: 'vehicle_id,category,name',
    categories: 'name,type',
    vehicle_metadata: 'path',
    articles: 'vehicle_id,original_id'
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
 * Table ai_processing_logs has: source_file, category, status, error_message, tokens_used, processed_at (no vehicle_id).
 * Worker sends source_file, category, status, error_message, tokens_used; we add processed_at here.
 */
export async function logAiProcessing(logData) {
    const cfg = getSupabaseConfig();
    if (!cfg) return;

    try {
        const payload = {
            source_file: logData.source_file,
            category: logData.category ?? null,
            status: logData.status,
            error_message: logData.error_message ?? null,
            tokens_used: logData.tokens_used ?? null,
            processed_at: new Date().toISOString()
        };
        const response = await fetch(`${cfg.url}/rest/v1/ai_processing_logs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(payload)
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
 * Checks for a cached article in any of the content tables by its external_id (Motor Article ID).
 * @param {string} articleId The Motor API article ID
 * @returns {Object|null} The cached article data or null if not found
 */
export async function checkParsedArticle(articleId) {
    const cfg = getSupabaseConfig();
    if (!cfg) {
        logger.warn(`Skipping Supabase check for article ${articleId}: credentials not set.`);
        return null;
    }

    const tables = ['procedures', 'tsbs', 'dtcs', 'specifications'];

    for (const table of tables) {
        try {
            const url = `${cfg.url}/rest/v1/${table}?external_id=eq.${articleId}`;
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
                logger.error(`Supabase REST error checking article ${articleId} in ${table} [${response.status}]: ${errorText}`);
                continue;
            }

            const data = await response.json();
            if (data && data.length > 0) {
                logger.info(`✓ Found cached content for article ${articleId} in table: ${table}`);
                return { ...data[0], _table: table };
            }
        } catch (err) {
            logger.error(`Unexpected error checking Supabase table ${table} for article ${articleId}:`, err);
        }
    }

    return null;
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

/**
 * Upserts vehicle metadata into the vehicle_metadata table.
 * @param {string} path The request path (e.g., /api/years)
 * @param {Object} data The response JSON
 */
export async function insertMetadata(path, data) {
    const cfg = getSupabaseConfig();
    if (!cfg) return { success: false };

    try {
        const url = `${cfg.url}/rest/v1/vehicle_metadata?on_conflict=path`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
                'Prefer': 'return=minimal,resolution=merge-duplicates'
            },
            body: JSON.stringify({
                path,
                data,
                updated_at: new Date().toISOString()
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Failed to upsert metadata for ${path}: ${errorText}`);
            return { success: false, error: errorText };
        }

        logger.info(`✓ Persisted vehicle metadata for: ${path}`);
        return { success: true };
    } catch (err) {
        logger.error(`Error persisting metadata for ${path}:`, err);
        return { success: false, error: err.message };
    }
}

/**
 * Retrieves vehicle metadata from the vehicle_metadata table.
 * @param {string} path The request path (e.g., /api/years)
 * @returns {Object|null} The cached metadata or null if not found
 */
export async function getMetadata(path) {
    const cfg = getSupabaseConfig();
    if (!cfg) return null;

    try {
        const url = `${cfg.url}/rest/v1/vehicle_metadata?path=eq.${encodeURIComponent(path)}&select=data`;
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
            logger.error(`Supabase REST error getting metadata for ${path} [${response.status}]: ${errorText}`);
            return null;
        }

        const data = await response.json();
        if (data && data.length > 0) {
            logger.info(`✓ Found cached metadata for: ${path}`);
            return data[0].data;
        }
        return null;
    } catch (err) {
        logger.error(`Error retrieving metadata for ${path}:`, err);
        return null;
    }
}
/**
 * Retrieves all cached articles for a specific vehicle from the articles table.
 * @param {string} vehicleId The vehicle ID
 * @returns {Array|null} Array of articles or null if error
 */
export async function getVehicleArticles(vehicleId) {
    const cfg = getSupabaseConfig();
    if (!cfg) return null;

    try {
        const url = `${cfg.url}/rest/v1/articles?vehicle_id=eq.${encodeURIComponent(vehicleId)}&select=*`;
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
            logger.error(`Supabase REST error getting articles for ${vehicleId} [${response.status}]: ${errorText}`);
            return null;
        }

        const articles = await response.json();
        // Recalculate original IDs to match Motor API titles/subtitles if needed
        // but the table should already have these mapped.
        return articles;
    } catch (err) {
        logger.error(`Error retrieving articles for ${vehicleId}:`, err);
        return null;
    }
}

/**
 * Gets a quick count of articles for a vehicle to determine if we should hit the cache.
 * @param {string} vehicleId 
 * @returns {number}
 */
export async function getVehicleArticlesCount(vehicleId) {
    const cfg = getSupabaseConfig();
    if (!cfg) return 0;

    try {
        const url = `${cfg.url}/rest/v1/articles?vehicle_id=eq.${encodeURIComponent(vehicleId)}&select=count&limit=1`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
                'Prefer': 'count=exact'
            },
        });

        if (!response.ok) return 0;
        
        // Supabase returns count in Content-Range header if using exact
        const contentRange = response.headers.get('content-range');
        if (contentRange) {
            const count = parseInt(contentRange.split('/')[1], 10);
            return isNaN(count) ? 0 : count;
        }
        return 0;
    } catch {
        return 0;
    }
}
