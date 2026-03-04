import logger from './logger.js';
import { parseWithAI } from './ai_parser.js';
import { insertParsedData, logAiProcessing, wasAlreadyParsed } from './supabase.js';

function determineSchemaType(urlPath) {
    if (urlPath.includes('/dtcs') || urlPath.includes('/dtc/')) return 'dtcs';
    if (urlPath.includes('/tsbs') || urlPath.includes('/tsb/')) return 'tsbs';
    if (urlPath.includes('/specifications') || urlPath.includes('/specs')) return 'specifications';
    if (/\/article\/[^/]+$/.test(urlPath) || urlPath.includes('/repair')) return 'procedures';
    return null;
}

/**
 * Extracts vehicle_id from Motor API URL paths.
 * Handles formats: /vehicle/2854, /vehicle/2013:Ford:Explorer, /vehicle/100306638
 */
function extractVehicleId(urlPath) {
    const m = urlPath.match(/vehicle\/([^/?]+)/);
    return m ? m[1] : null;
}

/**
 * Extracts a stable external_id that can be used for dedup across all schema types.
 * Procedures: article ID from /article/<id>
 * Others: derive from the full path (vehicle + endpoint) for a stable fingerprint.
 */
function extractExternalId(urlPath, targetSchema) {
    if (targetSchema === 'procedures') {
        const m = urlPath.match(/\/article\/([^?/]+)/);
        return m ? m[1] : null;
    }
    const vehicleId = extractVehicleId(urlPath);
    if (vehicleId) {
        return `${vehicleId}:${targetSchema}`;
    }
    return null;
}

/**
 * Fires an un-awaited background processing task.
 * Checks for prior successful parse first to avoid wasting AI quota.
 */
export function enqueueParsingTask(urlPath, rawData) {
    const targetSchema = determineSchemaType(urlPath);
    if (!targetSchema) return;

    const taskId = Math.random().toString(36).substring(2, 9);

    wasAlreadyParsed(urlPath).then(alreadyDone => {
        if (alreadyDone) {
            logger.info(`Skipping AI parse [${taskId}] — already cached: ${urlPath}`);
            return;
        }

        logger.info(`Started asynchronous AI parsing task: [${taskId}] schema=${targetSchema}, path=${urlPath}`);
        processTaskImmediate(taskId, targetSchema, urlPath, rawData.toString('utf8')).catch(e => {
            logger.error(`Unhandled error inside immediate background task [${taskId}]:`, e);
        });
    }).catch(() => {
        processTaskImmediate(taskId, targetSchema, urlPath, rawData.toString('utf8')).catch(e => {
            logger.error(`Unhandled error inside immediate background task [${taskId}]:`, e);
        });
    });
}

async function processTaskImmediate(taskId, targetSchema, urlPath, rawData) {
    const startTime = Date.now();
    let status = 'COMPLETED';
    let errorMessage = null;

    try {
        const parsedData = await parseWithAI(rawData, targetSchema);

        const vehicleIdStr = extractVehicleId(urlPath);
        const externalIdStr = extractExternalId(urlPath, targetSchema);

        if (!vehicleIdStr) {
            logger.warn(`[${taskId}] No vehicle_id in URL, skipping insert to avoid orphan rows: ${urlPath}`);
            status = 'FAILED';
            errorMessage = 'Could not extract vehicle_id from URL';
            return;
        }

        const attachMeta = (item) => {
            item.vehicle_id = vehicleIdStr;
            if (externalIdStr) {
                item.external_id = externalIdStr;
            }
        };

        if (Array.isArray(parsedData)) {
            parsedData.forEach(attachMeta);
        } else if (parsedData && typeof parsedData === 'object') {
            attachMeta(parsedData);
        }

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
