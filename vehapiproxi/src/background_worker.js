import logger from './logger.js';
import { parseWithAI } from './ai_parser.js';
import { insertParsedData, logAiProcessing } from './supabase.js';

// Determine what type of data this is based on the URL path
function determineSchemaType(urlPath) {
    if (urlPath.includes('/dtcs') || urlPath.includes('/dtc/')) return 'dtcs';
    if (urlPath.includes('/tsbs') || urlPath.includes('/tsb/')) return 'tsbs';
    if (urlPath.includes('/specifications') || urlPath.includes('/specs')) return 'specifications';
    // Only match single-article content pages, not article *listing* endpoints like /articles/v2
    if (/\/article\/[^/]+$/.test(urlPath) || urlPath.includes('/repair')) return 'procedures';
    return null;
}

/**
 * Fires an un-awaited background processing task.
 * Note: Vercel serverless functions freeze once the response is sent. However,
 * an unawaited promise can sometimes resolve if the API finishes before spin-down,
 * or it may resume on the next request. This is the best effort for hobby tiers without waitUntil.
 */
export function enqueueParsingTask(urlPath, rawData) {
    const targetSchema = determineSchemaType(urlPath);
    if (!targetSchema) return;

    const taskId = Math.random().toString(36).substring(2, 9);
    logger.info(`Started asynchronous AI parsing task: [${taskId}] schema=${targetSchema}, path=${urlPath}`);

    // Fire and forget
    processTaskImmediate(taskId, targetSchema, urlPath, rawData.toString('utf8')).catch(e => {
        logger.error(`Unhandled error inside immediate background task [${taskId}]:`, e);
    });
}

/**
 * Processes the task immediately without a queue loop
 */
async function processTaskImmediate(taskId, targetSchema, urlPath, rawData) {
    const startTime = Date.now();
    let status = 'COMPLETED';
    let errorMessage = null;

    try {
        // 1. Ask Gemini to parse and coerce the messy JSON into the strict DB schema
        const parsedData = await parseWithAI(rawData, targetSchema);

        // 2. We need a vehicle_id for foreign keys in Supabase.
        let vehicleIdStr = null;
        const pMatch = urlPath.match(/vehicle\/([^/]+)/);
        if (pMatch && pMatch[1]) {
            vehicleIdStr = pMatch[1];
        }

        // We also need an external_id for articles (procedures) so the proxy can look them up later
        let articleIdStr = null;
        if (targetSchema === 'procedures') {
            const aMatch = urlPath.match(/\/article\/([^?]+)/);
            if (aMatch && aMatch[1]) {
                articleIdStr = aMatch[1];
            }
        }

        // Attach external context to structured object so Supabase doesn't reject it for missing keys
        if (vehicleIdStr) {
            if (Array.isArray(parsedData)) {
                parsedData.forEach(item => {
                    item.vehicle_id = vehicleIdStr;
                    if (articleIdStr && targetSchema === 'procedures') {
                        item.external_id = articleIdStr;
                    }
                });
            } else if (parsedData && typeof parsedData === 'object') {
                parsedData.vehicle_id = vehicleIdStr;
                if (articleIdStr && targetSchema === 'procedures') {
                    parsedData.external_id = articleIdStr;
                }
            }
        }

        // 3. Insert into Supabase
        const result = await insertParsedData(targetSchema, parsedData);

        if (!result.success) {
            status = 'FAILED';
            errorMessage = result.error?.message || result.error || 'DB Insert Failed';
        }

    } catch (error) {
        logger.error(`Background task [${taskId}] failed:`, error);
        status = 'FAILED';
        errorMessage = error.message;
    } finally {
        const duration = Date.now() - startTime;

        // Log to AI processing logs
        await logAiProcessing({
            source_file: urlPath,
            category: targetSchema,
            status,
            error_message: errorMessage,
            tokens_used: 0
        }).catch(e => logger.warn('Failed to log AI processing metrics to Supabase.', e));

        logger.info(`Finished background task [${taskId}] in ${duration}ms. Status: ${status}`);
    }
}
