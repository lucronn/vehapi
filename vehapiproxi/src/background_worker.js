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
    insertEvidenceIngest,
    updateContentItemEnrichment,
    fetchContentItemId,
    findEntityIdsByExternalId,
    insertEvidenceLinks,
    deleteProcedureStepsForArticle,
    deleteProcedureToolsForArticle,
    deleteProcedurePartsForArticle
} from './supabase.js';
import { normalizeCategoryParams } from './categorize.js';
import { buildContentItemFromCatalogArticle, buildMinimalContentItemFromParse } from './content_item_mapper.js';
import { extractTextFromPdfBase64 } from './pdf_native_text.js';
import { extractTextFromPdfPageViaNemotron } from './nemotron_multimodal.js';
import { ingestL2ContentChunksIfEnabled } from './l2_rag_ingest.js';

const ENABLE_NEMOTRON_PDF_VISION_FALLBACK =
    String(process.env.ENABLE_NEMOTRON_PDF_VISION_FALLBACK || '').toLowerCase() === 'true';
const MIN_NATIVE_PDF_TEXT_LENGTH = Number.parseInt(
    process.env.MIN_NATIVE_PDF_TEXT_LENGTH || '120',
    10
);
const PDF_VISION_FALLBACK_PAGE = Number.parseInt(
    process.env.PDF_VISION_FALLBACK_PAGE || '0',
    10
);

let _warnedMissingProcedureToolTables = false;

function isMissingProcedureToolTableError(errText) {
    const s = String(errText || '');
    return (
        /PGRST205/i.test(s) &&
        (/procedure_tool/i.test(s) || /procedure_part/i.test(s) || /Could not find the table/i.test(s))
    );
}

function warnProcedureToolTablesOnce(errText) {
    if (_warnedMissingProcedureToolTables || !isMissingProcedureToolTableError(errText)) return;
    _warnedMissingProcedureToolTables = true;
    logger.warn(
        'procedure_tool / procedure_part not in PostgREST schema (run migrate:l1-procedure-tool-part?) — suppressing further tool/part delete/insert warnings'
    );
}

function htmlEscape(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** L1 spec_type heuristic from Motor-style category + name (docs/plans normalization design). */
function inferSpecType(category, name) {
    const hay = `${String(category || '').toLowerCase()} ${String(name || '').toLowerCase()}`;
    if (/\btorque\b|ft-lb|\bnm\b|lb-ft|n\.m|newton/.test(hay)) return 'torque';
    if (/fluid|oil|coolant|brake fluid|atf|transmission fluid|dexos|antifreeze/.test(hay)) return 'fluid';
    if (/tire|inflation|pressure|psi\b/.test(hay)) return 'tire_pressure';
    if (/capacity|volume|quart|liter|litre|gallon|cc\b/.test(hay)) return 'capacity';
    if (/dimension|clearance|gap\b|thickness|runout/.test(hay)) return 'dimension';
    return 'other';
}

function parseLeadingNumber(valueStr) {
    if (valueStr == null) return { num: null, text: '' };
    const s = String(valueStr).trim();
    if (!s) return { num: null, text: '' };
    const m = s.match(/^-?[\d.]+/);
    if (!m) return { num: null, text: s };
    const num = parseFloat(m[0]);
    if (Number.isNaN(num)) return { num: null, text: s };
    return { num, text: s };
}

/**
 * Maps legacy `specifications` upsert rows → `spec_fact` L1 rows (same natural key: vehicle_id, category, name).
 */
function specificationRowsToSpecFacts(normalized, sourceArticleId) {
    const arr = Array.isArray(normalized) ? normalized : normalized ? [normalized] : [];
    return arr
        .map((row) => {
            const category = row.category != null ? String(row.category).trim() : '';
            const name = row.name != null ? String(row.name).trim() : '';
            const valueStr = row.value != null ? String(row.value) : '';
            const { num, text } = parseLeadingNumber(valueStr);
            return {
                vehicle_id: row.vehicle_id,
                category,
                name,
                spec_type: inferSpecType(category, name),
                component: null,
                value_num: num,
                value_text: num != null ? null : text || null,
                unit: row.unit || null,
                display_text: row.display_text || null,
                conditions: null,
                confidence: 1,
                source_article_id: sourceArticleId || null,
                metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : null,
                extractor_version: 'l1-v1',
                updated_at: new Date().toISOString()
            };
        })
        .filter((r) => r.vehicle_id && r.category && r.name);
}

/**
 * L1 rows for `procedure_step` — `step_index` is stable 0..n-1 array position (delete+insert per article).
 */
function buildProcedureStepRows(normalized) {
    const list = Array.isArray(normalized) ? normalized : normalized ? [normalized] : [];
    const rows = [];
    for (const proc of list) {
        const vid = proc.vehicle_id;
        const aid = proc.external_id;
        if (!vid || !aid) continue;
        const steps = Array.isArray(proc.steps) ? proc.steps : [];
        steps.forEach((s, idx) => {
            const displayOrder = typeof s.order === 'number' ? s.order : null;
            rows.push({
                vehicle_id: vid,
                source_article_id: aid,
                step_index: idx,
                display_order: displayOrder,
                step_text: typeof s.text === 'string' ? s.text : '',
                image_url: s.image_url || null,
                warning: s.warning || null,
                note: s.note || null,
                extractor_version: 'l1-v1',
                updated_at: new Date().toISOString()
            });
        });
    }
    return rows;
}

/** L1 `procedure_tool` rows from `tools_required` string array. */
function buildProcedureToolRows(normalized) {
    const list = Array.isArray(normalized) ? normalized : normalized ? [normalized] : [];
    const rows = [];
    for (const proc of list) {
        const vid = proc.vehicle_id;
        const aid = proc.external_id;
        if (!vid || !aid) continue;
        const tools = Array.isArray(proc.tools_required) ? proc.tools_required : [];
        tools.forEach((t, idx) => {
            const toolText = typeof t === 'string' ? t : String(t ?? '');
            rows.push({
                vehicle_id: vid,
                source_article_id: aid,
                line_index: idx,
                tool_text: toolText,
                extractor_version: 'l1-v1',
                updated_at: new Date().toISOString()
            });
        });
    }
    return rows;
}

/** L1 `procedure_part` rows from `parts_required` object array. */
function buildProcedurePartRows(normalized) {
    const list = Array.isArray(normalized) ? normalized : normalized ? [normalized] : [];
    const rows = [];
    for (const proc of list) {
        const vid = proc.vehicle_id;
        const aid = proc.external_id;
        if (!vid || !aid) continue;
        const parts = Array.isArray(proc.parts_required) ? proc.parts_required : [];
        parts.forEach((p, idx) => {
            const pr = p && typeof p === 'object' ? p : {};
            const qtyRaw =
                typeof pr.quantity === 'number' && !Number.isNaN(pr.quantity) ? pr.quantity : null;
            const qty = qtyRaw != null ? qtyRaw : 1;
            rows.push({
                vehicle_id: vid,
                source_article_id: aid,
                line_index: idx,
                part_number: pr.part_number || null,
                description: typeof pr.description === 'string' ? pr.description : '',
                quantity: qty,
                extractor_version: 'l1-v1',
                updated_at: new Date().toISOString()
            });
        });
    }
    return rows;
}

function buildEnrichmentFromParsedData(schemaType, parsedData, htmlContent) {
    const fromText = (v) => (typeof v === 'string' ? v.trim() : '');
    const cap = (s, n = 360) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

    let desc = '';
    if (schemaType === 'procedures' && parsedData && typeof parsedData === 'object') {
        const step1 = Array.isArray(parsedData.steps) && parsedData.steps.length > 0 ? fromText(parsedData.steps[0]?.text) : '';
        desc = fromText(parsedData.description) || step1;
    } else if ((schemaType === 'dtcs' || schemaType === 'tsbs' || schemaType === 'specifications') && parsedData) {
        const row = Array.isArray(parsedData) ? parsedData[0] : parsedData;
        if (row && typeof row === 'object') {
            desc = fromText(row.summary) || fromText(row.description) || fromText(row.display_text) || fromText(row.content);
        }
    }

    if (!desc && typeof htmlContent === 'string' && htmlContent.trim()) {
        desc = htmlContent
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    const displayDescription = cap(desc);
    const searchText = cap(`${displayDescription} ${fromText(htmlContent || '')}`.replace(/\s+/g, ' '), 8000);
    return {
        display_description: displayDescription || null,
        search_text: searchText || null,
        enrichment_source: 'rules+parsed_content',
        enrichment_version: 'phase1-v2',
        enriched_at: new Date().toISOString()
    };
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

/** Content source segment from proxy paths like `/api/source/GeneralMotors/vehicle/...` (preserve Motor casing). */
function extractContentSource(urlPath) {
    const m = urlPath.match(/\/source\/([^/]+)\//i);
    return m ? m[1] : 'MOTOR';
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
        out.parts_required = ensureArray(out.parts_required).map((p) => ({
            part_number: p.part_number || null,
            description: p.description ?? '',
            quantity:
                typeof p.quantity === 'number' && !Number.isNaN(p.quantity) ? p.quantity : null
        }));
        out.time_estimate_hours = ensureNum(out.time_estimate_hours);
    } else if (schemaType === 'specifications') {
        out.category = out.category != null ? String(out.category) : '';
        out.name = out.name != null ? String(out.name) : '';
        out.value = out.value != null ? String(out.value) : '';
        out.unit = (out.unit != null && typeof out.unit === 'string') ? out.unit : null;
        out.display_text = (out.display_text != null && typeof out.display_text === 'string') ? out.display_text : null;
        out.metadata = out.metadata && typeof out.metadata === 'object' ? out.metadata : null;
        // `specifications` table has no external_id / content_html — strip before REST upsert.
        delete out.external_id;
        delete out.content_html;
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
    let evidenceId = null;
    let promptTokens = null;
    let completionTokens = null;
    let totalTokensUsed = 0;

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
            } else {
                evidenceId = ev.id || null;
            }
        } catch (evErr) {
            logger.warn(`[${taskId}] evidence_ingest failed: ${evErr.message}`);
        }

        const { parsed: parsedData, usage: parseUsage } = await parseWithAI(rawData, targetSchema, {
            urlPath
        });

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
                            const visionText = await extractTextFromPdfPageViaNemotron(pdfBuf, PDF_VISION_FALLBACK_PAGE, {
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

        if (htmlContent && targetSchema !== 'specifications') {
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
        } else {
            // Lazy catalog enrichment: when parsing article bodies, improve content_item discoverability.
            const isArticleId = Boolean(urlPath.match(/\/article\/([^?/]+)/));
            if (isArticleId && externalIdStr) {
                const cs = extractContentSource(urlPath);
                if (!(await fetchContentItemId(vehicleIdStr, externalIdStr, cs))) {
                    const minimal = buildMinimalContentItemFromParse({
                        vehicleExternalId: vehicleIdStr,
                        motorArticleId: externalIdStr,
                        contentSource: cs,
                        targetSchema
                    });
                    const ciIns = await insertParsedData('content_item', [minimal], { returnRepresentation: true });
                    if (!ciIns.success) {
                        logger.warn(`[${taskId}] content_item parse-path upsert skipped: ${ciIns.error}`);
                    }
                }
                const patch = buildEnrichmentFromParsedData(targetSchema, parsedData, htmlContent);
                const ci = await updateContentItemEnrichment(vehicleIdStr, externalIdStr, cs, patch);
                if (!ci.success) {
                    logger.warn(`[${taskId}] content_item enrichment skipped: ${ci.error}`);
                }
                await ingestL2ContentChunksIfEnabled({
                    taskId,
                    vehicleExternalId: vehicleIdStr,
                    motorArticleId: externalIdStr,
                    contentSource: cs,
                    targetSchema,
                    htmlContent,
                    parsedData
                });
            }

            // Traceability link: evidence_ingest -> normalized entity rows.
            if (evidenceId && externalIdStr && ['procedures', 'dtcs', 'tsbs'].includes(targetSchema)) {
                const ids = await findEntityIdsByExternalId(targetSchema, vehicleIdStr, externalIdStr);
                if (ids.length > 0) {
                    const links = await insertEvidenceLinks(evidenceId, targetSchema, ids, 'phase1-v1');
                    if (!links.success) {
                        logger.warn(`[${taskId}] evidence_link insert skipped: ${links.error}`);
                    }
                }
            }

            // L1 spec_fact dual-write + evidence_link (specifications table has no external_id for bulk fingerprint).
            if (targetSchema === 'specifications') {
                const articleMatch = urlPath.match(/\/article\/([^?/]+)/);
                const sourceArticleId = articleMatch ? articleMatch[1] : null;
                const specFactRows = specificationRowsToSpecFacts(normalized, sourceArticleId);
                if (specFactRows.length > 0) {
                    const sf = await insertParsedData('spec_fact', specFactRows, { returnRepresentation: true });
                    if (!sf.success) {
                        logger.warn(`[${taskId}] spec_fact upsert skipped (run migrate:l1-spec-fact?): ${sf.error}`);
                    } else if (evidenceId && Array.isArray(sf.rows) && sf.rows.length > 0) {
                        const factIds = sf.rows.map((r) => r.id).filter(Boolean);
                        if (factIds.length > 0) {
                            const links = await insertEvidenceLinks(evidenceId, 'spec_fact', factIds, 'l1-v1');
                            if (!links.success) {
                                logger.warn(`[${taskId}] spec_fact evidence_link skipped: ${links.error}`);
                            }
                        }
                    }
                }
            }

            // L1 procedure_step: replace steps per (vehicle, article) then insert; evidence_link to step rows.
            if (targetSchema === 'procedures') {
                const procList = Array.isArray(normalized) ? normalized : normalized ? [normalized] : [];
                const pairKeys = new Map();
                for (const proc of procList) {
                    if (proc.vehicle_id && proc.external_id) {
                        const k = `${proc.vehicle_id}::${proc.external_id}`;
                        pairKeys.set(k, [proc.vehicle_id, proc.external_id]);
                    }
                }
                for (const [, pair] of pairKeys) {
                    const [vid, aid] = pair;
                    const del = await deleteProcedureStepsForArticle(vid, aid);
                    if (!del.success) {
                        logger.warn(
                            `[${taskId}] procedure_step delete skipped (run migrate:l1-procedure-step?): ${del.error}`
                        );
                    }
                    const delT = await deleteProcedureToolsForArticle(vid, aid);
                    if (!delT.success) {
                        if (isMissingProcedureToolTableError(delT.error)) warnProcedureToolTablesOnce(delT.error);
                        else
                            logger.warn(
                                `[${taskId}] procedure_tool delete skipped (run migrate:l1-procedure-tool-part?): ${delT.error}`
                            );
                    }
                    const delP = await deleteProcedurePartsForArticle(vid, aid);
                    if (!delP.success) {
                        if (isMissingProcedureToolTableError(delP.error)) warnProcedureToolTablesOnce(delP.error);
                        else
                            logger.warn(
                                `[${taskId}] procedure_part delete skipped (run migrate:l1-procedure-tool-part?): ${delP.error}`
                            );
                    }
                }
                const stepRows = buildProcedureStepRows(normalized);
                if (stepRows.length > 0) {
                    const ps = await insertParsedData('procedure_step', stepRows, { returnRepresentation: true });
                    if (!ps.success) {
                        logger.warn(`[${taskId}] procedure_step insert skipped: ${ps.error}`);
                    } else if (evidenceId && Array.isArray(ps.rows) && ps.rows.length > 0) {
                        const stepIds = ps.rows.map((r) => r.id).filter(Boolean);
                        if (stepIds.length > 0) {
                            const links = await insertEvidenceLinks(evidenceId, 'procedure_step', stepIds, 'l1-v1');
                            if (!links.success) {
                                logger.warn(`[${taskId}] procedure_step evidence_link skipped: ${links.error}`);
                            }
                        }
                    }
                }
                const toolRows = buildProcedureToolRows(normalized);
                if (toolRows.length > 0) {
                    const pt = await insertParsedData('procedure_tool', toolRows, { returnRepresentation: true });
                    if (!pt.success) {
                        if (isMissingProcedureToolTableError(pt.error)) warnProcedureToolTablesOnce(pt.error);
                        else logger.warn(`[${taskId}] procedure_tool insert skipped: ${pt.error}`);
                    } else if (evidenceId && Array.isArray(pt.rows) && pt.rows.length > 0) {
                        const toolIds = pt.rows.map((r) => r.id).filter(Boolean);
                        if (toolIds.length > 0) {
                            const links = await insertEvidenceLinks(evidenceId, 'procedure_tool', toolIds, 'l1-v1');
                            if (!links.success) {
                                logger.warn(`[${taskId}] procedure_tool evidence_link skipped: ${links.error}`);
                            }
                        }
                    }
                }
                const partRows = buildProcedurePartRows(normalized);
                if (partRows.length > 0) {
                    const pp = await insertParsedData('procedure_part', partRows, { returnRepresentation: true });
                    if (!pp.success) {
                        if (isMissingProcedureToolTableError(pp.error)) warnProcedureToolTablesOnce(pp.error);
                        else logger.warn(`[${taskId}] procedure_part insert skipped: ${pp.error}`);
                    } else if (evidenceId && Array.isArray(pp.rows) && pp.rows.length > 0) {
                        const partIds = pp.rows.map((r) => r.id).filter(Boolean);
                        if (partIds.length > 0) {
                            const links = await insertEvidenceLinks(evidenceId, 'procedure_part', partIds, 'l1-v1');
                            if (!links.success) {
                                logger.warn(`[${taskId}] procedure_part evidence_link skipped: ${links.error}`);
                            }
                        }
                    }
                }
            }
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
            tokens_used: totalTokensUsed || null,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens
        }).catch(e => logger.warn('Failed to log AI processing metrics to Supabase.', e));

        logger.info(`Finished background task [${taskId}] in ${duration}ms. Status: ${status}`);
    }
}
