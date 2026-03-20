import crypto from 'node:crypto';
import logger from './logger.js';
import { parseWithAI } from './ai_parser.js';
import {
    insertParsedData,
    logAiProcessing,
    wasAlreadyParsed,
    insertMetadata,
    ensureVehicleExists,
    markVehicleNormalized,
    insertEvidenceIngest
} from './supabase.js';
import { normalizeCategoryParams } from './categorize.js';
import { buildContentItemFromCatalogArticle } from './content_item_mapper.js';
import { extractTextFromPdfBase64 } from './pdf_native_text.js';
import { extractTextFromPdfPageViaNemotron } from './nemotron_multimodal.js';

const ENABLE_NEMOTRON_PDF_VISION_FALLBACK =
    String(process.env.ENABLE_NEMOTRON_PDF_VISION_FALLBACK || '').toLowerCase() === 'true';
const MIN_NATIVE_PDF_TEXT_LENGTH = 120;

function htmlEscape(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

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

/** Content source segment from proxy paths like `/api/source/FORD/vehicle/...`. */
function extractContentSource(urlPath) {
    const m = urlPath.match(/\/source\/([^/]+)\//i);
    return m ? m[1].toUpperCase() : 'MOTOR';
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
 * Extracts a stable external_id for dedup across all schema types.
 * Procedures/DTCs/TSBs that come from /article/<id> get the article ID.
 * Bulk endpoints get a path-based fingerprint.
 */
function extractExternalId(urlPath, targetSchema) {
    const articleMatch = urlPath.match(/\/article\/([^?/]+)/);
    if (articleMatch) {
        return articleMatch[1];
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
            const parsedJson = JSON.parse(rawData);
            const result = await insertMetadata(urlPath, parsedJson);
            if (!result.success) {
                status = 'FAILED';
                errorMessage = result.error?.message || result.error || 'Metadata Insert Failed';
            }
            return;
        }

        const vehicleIdStr = extractVehicleId(urlPath);

        if (targetSchema === 'articles') {
            const parsedJson = JSON.parse(rawData);
            if (parsedJson?.body?.articleDetails && vehicleIdStr) {
                const contentSource = extractContentSource(urlPath);
                await ensureVehicleExists(vehicleIdStr, contentSource);

                const sha256 = crypto.createHash('sha256').update(rawData).digest('hex');
                const ev = await insertEvidenceIngest({
                    url_path: urlPath.slice(0, 4000),
                    http_status: 200,
                    content_type: 'application/json',
                    body_json: {
                        kind: 'articles_v2_catalog',
                        articleCount: parsedJson.body.articleDetails.length
                    },
                    sha256,
                    vehicle_external_id: vehicleIdStr,
                    content_source: contentSource,
                    source_label: 'articles_v2_catalog'
                });
                if (!ev.success) {
                    logger.warn(`evidence_ingest (catalog) skipped: ${ev.error}`);
                }

                const articles = parsedJson.body.articleDetails.map((a) => {
                    const { rootName, subName } = normalizeCategoryParams(a.title, a.parentBucket, a.bucket);
                    return {
                        vehicle_id: vehicleIdStr,
                        original_id: a.id,
                        title: a.title ?? null,
                        subtitle: a.subtitle ?? null,
                        code: a.code ?? null,
                        description: a.description ?? null,
                        bucket: subName,
                        parent_bucket: rootName,
                        thumbnail_href: a.thumbnailHref ?? null,
                        bulletin_number: a.bulletinNumber ?? null,
                        release_date: a.releaseDate ?? null,
                        sort: typeof a.sort === 'number' ? a.sort : null,
                        content_source: a.contentSource || contentSource
                    };
                });
                const result = await insertParsedData('articles', articles);
                if (!result.success) {
                    status = 'FAILED';
                    errorMessage = result.error?.message || result.error || 'Articles Insert Failed';
                } else {
                    const ciRows = parsedJson.body.articleDetails.map((a) =>
                        buildContentItemFromCatalogArticle(a, vehicleIdStr, contentSource)
                    );
                    const ciResult = await insertParsedData('content_item', ciRows);
                    if (!ciResult.success) {
                        logger.warn(`content_item upsert skipped (run phase-1 migration?): ${ciResult.error}`);
                    }
                    if (articles.length > 0) {
                        await markVehicleNormalized(vehicleIdStr);
                    }
                }
            }
            return;
        }

        // For AI-parsed content (procedures, dtcs, tsbs, specifications)

        if (!vehicleIdStr) {
            logger.warn(`[${taskId}] No vehicle_id in URL, skipping insert to avoid orphan rows: ${urlPath}`);
            status = 'FAILED';
            errorMessage = 'Could not extract vehicle_id from URL';
            return;
        }

        await ensureVehicleExists(vehicleIdStr, extractContentSource(urlPath));

        // L0 traceability for single-article / parse-target payloads.
        // Keep metadata compact here; full payload retention can move to Storage later.
        try {
            const rawTrimmed = typeof rawData === 'string' ? rawData.trim() : '';
            const isHtmlPayload = rawTrimmed.startsWith('<');
            const evSha = crypto.createHash('sha256').update(rawData).digest('hex');
            let summary = { kind: `${targetSchema}_payload`, rawLength: rawData.length };
            let contentType = 'text/plain';
            if (!isHtmlPayload) {
                try {
                    const parsed = JSON.parse(rawData);
                    const hasHtml = Boolean(parsed?.body?.html || parsed?.html);
                    const hasPdf = Boolean(parsed?.body?.pdf);
                    summary = {
                        ...summary,
                        hasHtml,
                        hasPdf,
                        bodyKeys: parsed?.body && typeof parsed.body === 'object' ? Object.keys(parsed.body).slice(0, 20) : []
                    };
                    contentType = 'application/json';
                } catch {
                    /* keep text/plain */
                }
            } else {
                summary = { ...summary, hasHtml: true };
                contentType = 'text/html';
            }

            const ev = await insertEvidenceIngest({
                url_path: urlPath.slice(0, 4000),
                http_status: 200,
                content_type: contentType,
                body_json: summary,
                sha256: evSha,
                vehicle_external_id: vehicleIdStr,
                content_source: extractContentSource(urlPath),
                source_label: `${targetSchema}_content`
            });
            if (!ev.success) {
                logger.warn(`[${taskId}] evidence_ingest skipped: ${ev.error}`);
            }
        } catch (evErr) {
            logger.warn(`[${taskId}] evidence_ingest failed: ${evErr.message}`);
        }

        const parsedData = await parseWithAI(rawData, targetSchema);

        const externalIdStr = extractExternalId(urlPath, targetSchema);

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

        // Store raw HTML in content_html for content cache.
        // For HTML article content (starts with <), always store it.
        // For JSON responses, try to extract HTML from body.html if present.
        const trimmed = typeof rawData === 'string' ? rawData.trim() : '';
        const rawIsHtml = trimmed.startsWith('<');
        let htmlContent = null;

        if (rawIsHtml) {
            htmlContent = rawData;
        } else {
            try {
                const parsed = JSON.parse(rawData);
                htmlContent = parsed?.body?.html || parsed?.html || null;
                if (!htmlContent && parsed?.body?.pdf) {
                    const pdfBase64 = String(parsed.body.pdf);
                    let pdfText = await extractTextFromPdfBase64(pdfBase64, { maxPages: 40 });

                    // Only invoke vision fallback for sparse/non-text PDFs and only when explicitly enabled.
                    if (
                        (!pdfText || pdfText.trim().length < MIN_NATIVE_PDF_TEXT_LENGTH) &&
                        ENABLE_NEMOTRON_PDF_VISION_FALLBACK
                    ) {
                        try {
                            const b64 = pdfBase64.replace(/^data:application\/pdf;base64,/i, '');
                            const pdfBuf = Buffer.from(b64, 'base64');
                            const visionText = await extractTextFromPdfPageViaNemotron(pdfBuf, 0, {
                                instruction:
                                    'Transcribe all readable text from this automotive service PDF page. ' +
                                    'Preserve line breaks. Return only text.'
                            });
                            if (visionText && visionText.trim().length > pdfText.trim().length) {
                                pdfText = visionText.trim();
                            }
                        } catch (visionErr) {
                            logger.warn(
                                `[${taskId}] Nemotron PDF fallback failed for ${urlPath}: ${visionErr.message}`
                            );
                        }
                    }

                    if (pdfText && pdfText.length >= 20) {
                        htmlContent = `<pre class="torque-native-pdf-text" data-source="native-pdf-or-vision-text">${htmlEscape(pdfText)}</pre>`;
                    }
                }
            } catch {
                /* not JSON, ignore */
            }
        }

        if (htmlContent) {
            const payload = Array.isArray(normalized) ? normalized : [normalized];
            payload.forEach(row => {
                if (!row.content_html) {
                    row.content_html = htmlContent;
                }
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
