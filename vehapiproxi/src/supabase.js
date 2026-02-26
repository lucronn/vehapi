import logger from './logger.js';

// Use the Supabase REST API directly via fetch - no SDK needed
// This avoids any ESM/CJS module loading issues on Vercel serverless

function getSupabaseConfig() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    return { url, key };
}

/**
 * Persists normalized data to the specified Supabase table via REST API.
 * @param {string} table The target table name (e.g., 'dtcs', 'tsbs', 'procedures')
 * @param {Object|Array} data The parsed data matching the table schema
 */
export async function insertParsedData(table, data) {
    const cfg = getSupabaseConfig();
    if (!cfg) {
        logger.warn(`Skipping Supabase insert into ${table}: credentials not set.`);
        return { success: false, error: 'Supabase credentials not configured' };
    }

    // Accept both a single object and an array
    const rows = Array.isArray(data) ? data : [data];

    try {
        const response = await fetch(`${cfg.url}/rest/v1/${table}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(rows)
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Supabase REST error on table ${table} [${response.status}]: ${errorText}`);
            return { success: false, error: errorText };
        }

        logger.info(`✓ Cached ${rows.length} row(s) into Supabase table: ${table}`);
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
            return data[0]; // Return the first matching article
        }
        return null;
    } catch (err) {
        logger.error(`Unexpected error checking Supabase for article ${articleId}:`, err);
        return null;
    }
}
