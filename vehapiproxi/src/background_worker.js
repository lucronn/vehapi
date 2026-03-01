import logger from './logger.js';
import { parseWithAI } from './ai_parser.js';
import { insertParsedData, logAiProcessing } from './supabase.js';

// Simple in-memory queue
const taskQueue = [];
let isProcessing = false;

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
 * Adds a new task to the background queue.
 * @param {string} urlPath The full request path (for determining schema and context)
 * @param {string|Buffer} rawData The raw response from the Motor API
 */
export function enqueueParsingTask(urlPath, rawData) {
    const targetSchema = determineSchemaType(urlPath);

    // If we don't know how to parse this data type, ignore it
    if (!targetSchema) {
        return;
    }

    // Add to queue
    const task = {
        id: Math.random().toString(36).substring(2, 9),
        urlPath,
        targetSchema,
        rawData: rawData.toString('utf8'),
        queuedAt: Date.now()
    };

    taskQueue.push(task);
    logger.info(`Queued background parsing task: [${task.id}] schema=${targetSchema}, path=${urlPath}`);

    // Start processing if not already running
    if (!isProcessing) {
        processNextTask();
    }
}

/**
 * Pops the next task off the queue and runs it.
 */
async function processNextTask() {
    if (taskQueue.length === 0) {
        isProcessing = false;
        return;
    }

    isProcessing = true;
    const task = taskQueue.shift();

    logger.info(`Processing background task [${task.id}]...`);

    const startTime = Date.now();
    let status = 'COMPLETED';
    let errorMessage = null;

    try {
        // 1. Ask Gemini to parse and coerce the messy JSON into the strict DB schema
        const parsedData = await parseWithAI(task.rawData, task.targetSchema);

        // 2. We need a vehicle_id for foreign keys in Supabase.
        // For a real implementation, we'd extract it from the URL or query params,
        // but for now, we'll try to find it lazily or leave it null.
        // urlPath example: /api/source/Ford/vehicle/2013:Ford:Explorer/dtcs
        let vehicleIdStr = null;
        let pMatch = task.urlPath.match(/vehicle\/([^/]+)/);
        if (pMatch && pMatch[1]) {
            vehicleIdStr = pMatch[1];
        }

        // Attach external context to structured object (if schema allows it, or map appropriately)
        // Note: vehicle_id requires a UUID, so inserting raw '2013:Ford:Explorer' will fail in Postgres.
        // Ideal solution: look up the UUID in 'vehicles' table based on 'vehicleIdStr'.
        // For now, we will omit the vehicle_id and rely on the AI parsed schema core data.

        // 3. Insert into Supabase
        const result = await insertParsedData(task.targetSchema, parsedData);

        if (!result.success) {
            status = 'FAILED';
            errorMessage = result.error?.message || 'DB Insert Failed';
        }

    } catch (error) {
        logger.error(`Background task [${task.id}] failed:`, error);
        status = 'FAILED';
        errorMessage = error.message;
    } finally {
        const duration = Date.now() - startTime;

        // Log to AI processing logs
        await logAiProcessing({
            source_file: task.urlPath,
            category: task.targetSchema,
            status,
            error_message: errorMessage,
            tokens_used: 0 // Would come from Gemini response metadata ideally
        });

        logger.info(`Finished background task [${task.id}] in ${duration}ms. Status: ${status}`);

        // Next iteration
        // Using setTimeout to avoid call stack flooding
        setTimeout(processNextTask, 100);
    }
}
