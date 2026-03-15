import logger from './logger.js';
import { parseWithAI } from './ai_parser.js';
import { insertParsedData, logAiProcessing, wasAlreadyParsed, insertMetadata } from './supabase.js';
import { normalizeCategoryParams } from './categorize.js';

function determineSchemaType(urlPath) {
    if (urlPath.includes('/dtcs') || urlPath.includes('/dtc/')) return 'dtcs';
    if (urlPath.includes('/tsbs') || urlPath.includes('/tsb/')) return 'tsbs';
    if (urlPath.includes('/specifications') || urlPath.includes('/specs')) return 'specifications';
    // Match /article/:id or /article/:id/html (single-article content → procedures table; AI parses structure)
    if (/\/article\/[^/?]+(\/html)?$/.test(urlPath) || urlPath.includes('/repair')) return 'procedures';
    if (urlPath.includes('/years') || urlPath.includes('/makes') || urlPath.includes('/models') || urlPath.includes('/engines')) return 'metadata';
    if (urlPath.includes('/articles/v2')) return 'articles';
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
 * Normalizes parsed data for Supabase: ensures arrays exist, dates are valid, no undefined.
 * Maximizes retention by preserving all extracted data in a DB-compatible form.
 */
function normalizeForSupabase(data, schemaType) {
    const ensureArray = (v) => (Array.isArray(v) ? v : []);
    const ensureNum = (v) => (typeof v === 'number' && !isNaN(v) ? v : null);

    if (Array.isArray(data)) {
        return data.map(item => normalizeForSupabase(item, schemaType));
    }

    const out = { ...data };

    if (schemaType === 'dtcs') {
        out.description = (out.description != null && typeof out.description === 'string') ? out.description : '';
        out.monitor_strategy = (out.monitor_strategy != null && typeof out.monitor_strategy === 'string') ? out.monitor_strategy : null;
        out.malfunction_criteria = (out.malfunction_criteria != null && typeof out.malfunction_criteria === 'string') ? out.malfunction_criteria : null;
        out.possible_causes = ensureArray(out.possible_causes);
        out.symptoms = ensureArray(out.symptoms);
        out.diagnostic_steps = ensureArray(out.diagnostic_steps).map(s => ({
            order: s.order ?? 0,
            test: s.test ?? '',
            result_match: s.result_match ?? '',
            action_if_match: s.action_if_match ?? '',
            action_if_not_match: s.action_if_not_match ?? '',
            warning: s.warning ?? ''
        }));
    } else if (schemaType === 'tsbs') {
        out.summary = (out.summary != null && typeof out.summary === 'string') ? out.summary : null;
        out.content = (out.content != null && typeof out.content === 'string') ? out.content : null;
        out.affected_components = ensureArray(out.affected_components);
        out.models_affected = ensureArray(out.models_affected);
        out.content_html = (out.content != null && typeof out.content === 'string') ? out.content : null;
        if (out.issue_date && typeof out.issue_date === 'string') {
            const parsed = new Date(out.issue_date);
            out.issue_date = isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
        }
    } else if (schemaType === 'procedures') {
        out.description = (out.description != null && typeof out.description === 'string') ? out.description : null;
        out.cautions = (out.cautions != null && typeof out.cautions === 'string') ? out.cautions : null;
        out.steps = ensureArray(out.steps).map(s => ({
            order: s.order ?? 0,
            text: s.text ?? '',
            image_url: s.image_url || null,
            warning: s.warning || null,
            note: s.note || null
        }));
        out.tools_required = ensureArray(out.tools_required);
        out.parts_required = ensureArray(out.parts_required).map(p => ({
            part_number: p.part_number || null,
            description: p.description ?? '',
            quantity: typeof p.quantity === 'number' ? p.quantity : 1
        }));
        out.time_estimate_hours = ensureNum(out.time_estimate_hours);
    } else if (schemaType === 'specifications') {
        out.category = out.category != null ? String(out.category) : '';
        out.name = out.name != null ? String(out.name) : '';
        out.value = out.value != null ? String(out.value) : '';
        out.unit = (out.unit != null && typeof out.unit === 'string') ? out.unit : null;
        out.display_text = (out.display_text != null && typeof out.display_text === 'string') ? out.display_text : null;
        out.metadata = out.metadata && typeof out.metadata === 'object' ? out.metadata : null;
    }

    return out;
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
        if (targetSchema === 'metadata') {
            // No AI parsing needed for raw metadata json
            const parsedJson = JSON.parse(rawData);
            const result = await insertMetadata(urlPath, parsedJson);
            if (!result.success) {
                status = 'FAILED';
                errorMessage = result.error?.message || result.error || 'Metadata Insert Failed';
            }
            return;
        }

        if (targetSchema === 'articles') {
            const parsedJson = JSON.parse(rawData);
            if (parsedJson?.body?.articleDetails) {
                const vehicleId = extractVehicleId(urlPath);
                const articles = parsedJson.body.articleDetails.map(a => {
                    const { rootName, subName } = normalizeCategoryParams(a.title, a.parentBucket, a.bucket);
                    return {
                        vehicle_id: vehicleId,
                        original_id: a.id,
                        title: a.title,
                        subtitle: a.subtitle,
                        bucket: subName,
                        parent_bucket: rootName,
                        thumbnail_href: a.thumbnailHref,
                        content_source: a.contentSource || 'MOTOR'
                    };
                });
                const result = await insertParsedData('articles', articles);
                if (!result.success) {
                    status = 'FAILED';
                    errorMessage = result.error?.message || result.error || 'Articles Insert Failed';
                }
            }
            return;
        }

        const parsedData = await parseWithAI(rawData, targetSchema);

        const vehicleIdStr = extractVehicleId(urlPath);
        const externalIdStr = extractExternalId(urlPath, targetSchema);

        if (!vehicleIdStr) {
            logger.warn(`[${taskId}] No vehicle_id in URL, skipping insert to avoid orphan rows: ${urlPath}`);
            status = 'FAILED';
            errorMessage = 'Could not extract vehicle_id from URL';
            return;
        }

        // external_id is always set for procedures (article id from URL) so future conflict key vehicle_id,external_id is ready.
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

        const normalized = normalizeForSupabase(parsedData, targetSchema);
        // Content tables store full HTML in content_html for cache response. Use raw when it's HTML.
        const rawIsHtml = typeof rawData === 'string' && rawData.trim().startsWith('<');
        if (rawIsHtml) {
            const payload = Array.isArray(normalized) ? normalized : [normalized];
            payload.forEach(row => {
                row.content_html = row.content_html || rawData;
            });
        }
        const result = await insertParsedData(targetSchema, normalized);

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
