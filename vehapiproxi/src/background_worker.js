import crypto from 'node:crypto';
import logger from './logger.js';
import { parseWithAI } from './ai_parser.js';
import { dbQuery } from './db.js';
import {
    insertParsedData,
    logAiProcessing,
    wasAlreadyParsed,
    insertMetadata,
    ensureVehicleExists,
    insertEvidenceIngest,
    updateContentItemEnrichment,
    fetchContentItemId,
    findEntityIdsByExternalId,
    insertEvidenceLinks,
    getArticleMetadata,
    deleteProcedureStepsForArticle,
    deleteProcedureToolsForArticle,
    deleteProcedurePartsForArticle,
    upsertMediaAssetPdfFromArticleBody,
    getArticleCatalogEntry
} from './supabase.js';
import { inferKindAndSiloFromHeuristics, classifySchemaWithAI } from './catalog_intelligence.js';
import { buildMinimalContentItemFromParse } from './content_item_mapper.js';
import { extractTextFromPdfBase64 } from './pdf_native_text.js';
import { ingestL2ContentChunksIfEnabled } from './l2_rag_ingest.js';
import {
    bucketToModuleType,
    hasMeaningfulBulletinNumber,
    looksLikeObdDtcCode
} from './article-access.js';
import { ingestArticlesCatalogFromMotorJson } from './ingest/ingest_articles_catalog.js';
import { ingestArticleToRagCorpus, isRagConfigured } from './rag_engine.js';

// ---------------------------------------------------------------------------
// Vehicle context resolution — year/make/model/engine for AI prompt grounding
// ---------------------------------------------------------------------------
const _vehicleCtxCache = new Map();

/**
 * Resolves year/make/model/engine for a Motor vehicleId.
 * Parses composite IDs (year:make:model:engine) directly; for numeric IDs does a
 * JSONB text scan of vehicle_metadata engine paths. Cached in memory (vehicles don't change).
 */
async function resolveVehicleContext(vehicleIdStr) {
    if (!vehicleIdStr) return null;
    if (_vehicleCtxCache.has(vehicleIdStr)) return _vehicleCtxCache.get(vehicleIdStr);

    // Composite format: "2013:Ford:Explorer" or "2013:Ford:Explorer:3.5L V6"
    const parts = vehicleIdStr.split(':');
    if (parts.length >= 3 && /^\d{4}$/.test(parts[0])) {
        const ctx = { year: parts[0], make: parts[1], model: parts[2], engine: parts[3] || null };
        _vehicleCtxCache.set(vehicleIdStr, ctx);
        return ctx;
    }

    // Numeric Motor vehicle ID — scan vehicle_metadata engine paths for this ID
    try {
        const { rows } = await dbQuery(
            `SELECT path FROM vehicle_metadata
             WHERE path LIKE '/year/%/make/%/model/%/engines'
               AND data::text LIKE $1
             LIMIT 1`,
            [`%"vehicleId":${vehicleIdStr}%`]
        );
        if (rows.length > 0) {
            const m = rows[0].path.match(/^\/year\/(\d+)\/make\/([^/]+)\/model\/([^/]+)/);
            if (m) {
                const ctx = { year: m[1], make: m[2], model: m[3], engine: null };
                _vehicleCtxCache.set(vehicleIdStr, ctx);
                return ctx;
            }
        }
    } catch {
        /* best-effort — don't fail the parse if context lookup fails */
    }

    _vehicleCtxCache.set(vehicleIdStr, null);
    return null;
}

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

/** Persist `media_asset` row for article `body.pdf` bytes (sha256 + mime). Set false to skip. */
const ENABLE_MEDIA_ASSET_PDF = String(process.env.ENABLE_MEDIA_ASSET_PDF || 'true').toLowerCase() !== 'false';

let _warnedMissingProcedureToolTables = false;

/**
 * Vision fallback should never prevent the worker from loading.
 * In WSL/Windows-mixed installs, native `canvas` can fail to load (invalid ELF header),
 * so we lazy-import multimodal and treat any import/runtime failure as "vision unavailable".
 */
async function extractTextFromPdfPageViaNemotronSafe(pdfBuf, pageIndex, options) {
    if (!ENABLE_NEMOTRON_PDF_VISION_FALLBACK) return '';
    try {
        const mod = await import('./nemotron_multimodal.js');
        if (typeof mod.extractTextFromPdfPageViaNemotron !== 'function') {
            throw new Error('extractTextFromPdfPageViaNemotron missing');
        }
        return await mod.extractTextFromPdfPageViaNemotron(pdfBuf, pageIndex, options);
    } catch (err) {
        logger.warn('Nemotron multimodal unavailable; skipping vision fallback:', err?.message || String(err));
        return '';
    }
}

const ENABLE_HTML_IMAGE_OCR = String(process.env.ENABLE_HTML_IMAGE_OCR || '').toLowerCase() === 'true';
const HTML_IMAGE_OCR_MAX = Number.parseInt(process.env.HTML_IMAGE_OCR_MAX || '10', 10);

/**
 * OCR inline `<img>` tags in article HTML using Nemotron vision.
 * Appends transcribed text after each image. Gated behind ENABLE_HTML_IMAGE_OCR.
 * @returns augmented HTML or original if OCR is disabled/fails.
 */
async function extractTextFromHtmlImages(html, taskId) {
    if (!ENABLE_HTML_IMAGE_OCR || !html || typeof html !== 'string') return html;

    let cheerio;
    try { cheerio = await import('cheerio'); } catch { return html; }

    const $ = cheerio.load(html);
    const imgs = $('img[src]').toArray().slice(0, HTML_IMAGE_OCR_MAX);
    if (!imgs.length) return html;

    // Load OCR backends — prefer Cloud Vision (purpose-built OCR), fall back to Gemini vision
    const { extractTextFromImageWithVision, isVisionConfigured } = await import('./cloud_vision.js');
    const useCloudVision = isVisionConfigured();

    let geminiMod = null;
    if (!useCloudVision) {
        try { geminiMod = await import('./nemotron_multimodal.js'); }
        catch (err) {
            logger.warn(`[${taskId}] HTML image OCR: both Cloud Vision and Gemini unavailable: ${err?.message}`);
            return html;
        }
    }

    let augmented = 0;
    for (const img of imgs) {
        const src = $(img).attr('src');
        if (!src) continue;
        const isProcessable = src.startsWith('data:image/') || src.startsWith('http');
        if (!isProcessable) continue;

        try {
            let text = '';
            let ocrSource = 'unknown';

            if (useCloudVision) {
                // Cloud Vision: DOCUMENT_TEXT_DETECTION — best for dense text, tables, labels
                const result = await extractTextFromImageWithVision(src);
                if (result.success && result.text) {
                    text = result.text;
                    ocrSource = 'cloud-vision';
                }
            }

            // Fallback: Gemini vision (understands context better, good for ambiguous images)
            if (!text && geminiMod) {
                text = await geminiMod.extractTextFromImageDataUri(src, {
                    instruction: 'Transcribe all readable text from this automotive service image. Preserve line breaks and formatting. Return only text.'
                });
                if (text) ocrSource = 'gemini-vision';
            }

            if (text && text.trim().length > 10) {
                $(img).after(`<div class="torque-ocr-text" data-source="${ocrSource}">${text.trim()}</div>`);
                augmented++;
            }
        } catch (err) {
            logger.warn(`[${taskId}] HTML image OCR failed for one image: ${err?.message}`);
        }
    }

    if (augmented > 0) {
        logger.info(`[${taskId}] HTML image OCR: transcribed ${augmented}/${imgs.length} images`);
        return $.html();
    }
    return html;
}

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
function specificationRowsToSpecFacts(normalized, sourceArticleId, now) {
    const arr = Array.isArray(normalized) ? normalized : normalized ? [normalized] : [];
    const ts = now || new Date().toISOString();
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
                updated_at: ts
            };
        })
        .filter((r) => r.vehicle_id && r.category && r.name);
}

/**
 * L1 rows for `procedure_step` — `step_index` is stable 0..n-1 array position (delete+insert per article).
 */
function buildProcedureStepRows(normalized, now) {
    const list = Array.isArray(normalized) ? normalized : normalized ? [normalized] : [];
    const ts = now || new Date().toISOString();
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
                updated_at: ts
            });
        });
    }
    return rows;
}

/** L1 `procedure_tool` rows from `tools_required` string array. */
function buildProcedureToolRows(normalized, now) {
    const list = Array.isArray(normalized) ? normalized : normalized ? [normalized] : [];
    const ts = now || new Date().toISOString();
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
                updated_at: ts
            });
        });
    }
    return rows;
}

/** L1 `procedure_part` rows from `parts_required` object array. */
function buildProcedurePartRows(normalized, now) {
    const list = Array.isArray(normalized) ? normalized : normalized ? [normalized] : [];
    const ts = now || new Date().toISOString();
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
                updated_at: ts
            });
        });
    }
    return rows;
}

function buildEnrichmentFromParsedData(schemaType, parsedData, htmlContent) {
    const fromText = (v) => (typeof v === 'string' ? v.trim() : '');
    const cap = (s, n = 360) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
    const capLong = (s) => (s.length > 32000 ? `${s.slice(0, 32000)}` : s);
    const esc = (s) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let desc = '';
    let longDesc = '';

    if (schemaType === 'procedures' && parsedData && typeof parsedData === 'object') {
        const step1 = Array.isArray(parsedData.steps) && parsedData.steps.length > 0 ? fromText(parsedData.steps[0]?.text) : '';
        desc = fromText(parsedData.description) || step1;
        if (Array.isArray(parsedData.steps) && parsedData.steps.length > 0) {
            const items = parsedData.steps
                .filter(s => s && (s.text || s.instruction))
                .map((s, i) => {
                    const txt = esc(fromText(s.text || s.instruction));
                    const note = s.note ? `<br/><small>${esc(fromText(s.note))}</small>` : '';
                    return `<li><strong>Step ${i + 1}:</strong> ${txt}${note}</li>`;
                })
                .join('');
            if (items) {
                const header = parsedData.description ? `<p>${esc(fromText(parsedData.description))}</p>` : '';
                longDesc = `${header}<ol>${items}</ol>`;
            }
        }
    } else if ((schemaType === 'dtcs' || schemaType === 'tsbs') && parsedData) {
        const row = Array.isArray(parsedData) ? parsedData[0] : parsedData;
        if (row && typeof row === 'object') {
            desc = fromText(row.summary) || fromText(row.description) || fromText(row.content);
            const parts = [];
            if (row.description) parts.push(`<p>${esc(fromText(row.description))}</p>`);
            if (Array.isArray(row.possible_causes) && row.possible_causes.length) {
                parts.push(`<h4>Possible Causes</h4><ul>${row.possible_causes.map(c => `<li>${esc(fromText(c))}</li>`).join('')}</ul>`);
            }
            if (Array.isArray(row.symptoms) && row.symptoms.length) {
                parts.push(`<h4>Symptoms</h4><ul>${row.symptoms.map(s => `<li>${esc(fromText(s))}</li>`).join('')}</ul>`);
            }
            if (Array.isArray(row.diagnostic_steps) && row.diagnostic_steps.length) {
                parts.push(`<h4>Diagnostic Steps</h4><ol>${row.diagnostic_steps.map(s => `<li>${esc(fromText(s))}</li>`).join('')}</ol>`);
            }
            if (row.content) parts.push(`<div>${esc(fromText(row.content))}</div>`);
            if (parts.length > 1) longDesc = parts.join('');
        }
    } else if (schemaType === 'specifications' && parsedData) {
        const row = Array.isArray(parsedData) ? parsedData[0] : parsedData;
        if (row && typeof row === 'object') {
            desc = fromText(row.summary) || fromText(row.description) || fromText(row.display_text) || fromText(row.content);
        }
    }

    if (!longDesc && typeof htmlContent === 'string' && htmlContent.trim().length > 200) {
        longDesc = htmlContent;
    }

    if (!desc && typeof htmlContent === 'string' && htmlContent.trim()) {
        desc = htmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    const displayDescription = cap(desc);
    const searchText = cap(`${displayDescription} ${fromText(htmlContent || '')}`.replace(/\s+/g, ' '), 8000);
    return {
        display_description: displayDescription || null,
        display_long_description: longDesc ? capLong(longDesc) : null,
        search_text: searchText || null,
        enrichment_source: 'rules+parsed_content',
        enrichment_version: 'phase1-v3',
        enriched_at: new Date().toISOString()
    };
}

function determineSchemaType(urlPath) {
    if (urlPath.includes('/dtcs') || urlPath.includes('/dtc/')) return 'dtcs';
    if (urlPath.includes('/tsbs') || urlPath.includes('/tsb/')) return 'tsbs';
    if (urlPath.includes('/specifications') || urlPath.includes('/specs')) return 'specifications';
    if (urlPath.includes('/labor/')) return 'labor_operation';
    // Match /article/:id or /article/:id/html (single-article content → procedures table; AI parses structure)
    if (/\/article\/[^/?]+(\/html)?$/.test(urlPath) || urlPath.includes('/repair')) return 'procedures';
    if (urlPath.includes('/years') || urlPath.includes('/makes') || urlPath.includes('/models') || urlPath.includes('/engines')) return 'metadata';
    if (urlPath.includes('/articles/v2')) return 'articles';
    return null;
}

function articleModuleTypeToSchema(moduleType) {
    if (moduleType === 'dtcs') return 'dtcs';
    if (moduleType === 'tsbs') return 'tsbs';
    if (moduleType === 'specs') return 'specifications';
    if (moduleType === 'procedures') return 'procedures';
    if (moduleType === 'diagrams') return 'diagram_document';
    return null;
}

/** Maps Catalog Intelligence silo codes to worker `insertParsedData` schema names. */
function siloCodeToTargetSchema(canonicalSiloCode) {
    if (!canonicalSiloCode || typeof canonicalSiloCode !== 'string') return null;
    switch (canonicalSiloCode) {
        case 'dtcs':
            return 'dtcs';
        case 'tsbs':
            return 'tsbs';
        case 'specs':
            return 'specifications';
        case 'diagrams':
            return 'diagram_document';
        case 'component-locations':
            return 'component_location_document';
        case 'procedures':
            return 'procedures';
        default:
            return null;
    }
}

async function resolveArticleSchema(urlPath, fallbackSchema) {
    const articleMatch = urlPath.match(/\/article\/([^?/]+)/);
    if (!articleMatch || fallbackSchema !== 'procedures') {
        return fallbackSchema;
    }

    const vehicleId = extractVehicleId(urlPath);
    const articleId = articleMatch[1];
    if (!vehicleId || !articleId) {
        return fallbackSchema;
    }

    if (String(articleId).startsWith('L:')) {
        return 'labor_operation';
    }

    const metadata = await getArticleMetadata(vehicleId, articleId);
    if (!metadata) {
        return fallbackSchema;
    }

    const combinedBucket = `${metadata.bucket || ''} ${metadata.parent_bucket || ''}`.toLowerCase();
    if (combinedBucket.includes('component location')) {
        return 'component_location_document';
    }
    if (combinedBucket.includes('diagram') || combinedBucket.includes('wiring')) {
        return 'diagram_document';
    }

    if (looksLikeObdDtcCode(metadata.code)) {
        return 'dtcs';
    }
    if (hasMeaningfulBulletinNumber(metadata.bulletin_number)) {
        return 'tsbs';
    }

    const moduleType = bucketToModuleType(metadata.bucket, metadata.parent_bucket);
    const fromBucket = articleModuleTypeToSchema(moduleType);
    if (fromBucket && fromBucket !== 'procedures') {
        return fromBucket;
    }

    const h = inferKindAndSiloFromHeuristics(
        metadata.title,
        metadata.parent_bucket,
        metadata.bucket
    );
    const heuristicSchema = siloCodeToTargetSchema(h.canonical_silo_code);

    // AI fallback: when heuristics give low confidence or 'other', ask Gemini to classify
    if (!heuristicSchema || h.confidence === 'low' || h.canonical_silo_code === 'other') {
        const aiResult = await classifySchemaWithAI(
            metadata.title,
            metadata.parent_bucket,
            metadata.bucket,
            '' // no excerpt at this stage — title + buckets are usually sufficient
        ).catch(() => null);
        if (aiResult) {
            const aiSchema = siloCodeToTargetSchema(aiResult.canonical_silo_code);
            if (aiSchema && aiSchema !== 'procedures') {
                logger.info(`[schema-routing] AI classified article ${articleId} as ${aiResult.canonical_silo_code} (was low-confidence heuristic: ${h.canonical_silo_code})`);
                return aiSchema;
            }
        }
        return fromBucket || fallbackSchema;
    }

    if (heuristicSchema === 'procedures') {
        return fromBucket || fallbackSchema;
    }
    if (fromBucket === 'procedures' || !fromBucket) {
        return heuristicSchema;
    }
    return fromBucket || fallbackSchema;
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
        delete out.external_id;
        delete out.content_html;
    } else if (schemaType === 'diagram_document' || schemaType === 'component_location_document') {
        out.title = (out.title != null && typeof out.title === 'string') ? out.title : null;
        out.description = (out.description != null && typeof out.description === 'string') ? out.description : null;
        out.content_html = (out.content_html != null && typeof out.content_html === 'string') ? out.content_html : null;
        out.metadata_json = out.metadata_json && typeof out.metadata_json === 'object' ? out.metadata_json : null;
    } else if (schemaType === 'labor_operation') {
        out.title = (out.title != null && typeof out.title === 'string') ? out.title : null;
        out.description = (out.description != null && typeof out.description === 'string') ? out.description : null;
        out.content_html = (out.content_html != null && typeof out.content_html === 'string') ? out.content_html : null;
        out.metadata_json = out.metadata_json && typeof out.metadata_json === 'object' ? out.metadata_json : null;
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
export function enqueueParsingTask(urlPath, rawData, options = {}) {
    const targetSchema = determineSchemaType(urlPath);
    if (!targetSchema) return;

    const taskId = Math.random().toString(36).substring(2, 9);
    const forceReparse = options && options.forceReparse === true;

    wasAlreadyParsed(urlPath).then(alreadyDone => {
        if (forceReparse) {
            logger.info(`Force reprocessing AI parse [${taskId}] for verify request: ${urlPath}`);
        }
        if (alreadyDone) {
            if (forceReparse) {
                logger.info(`Bypassing already-parsed short-circuit [${taskId}] for verify request: ${urlPath}`);
            } else {
            logger.info(`Skipping AI parse [${taskId}] — already cached: ${urlPath}`);
            return;
            }
        }

        logger.info(`Started asynchronous AI parsing task: [${taskId}] schema=${targetSchema}, path=${urlPath}`);
        processTaskImmediate(taskId, targetSchema, urlPath, rawData.toString('utf8'))
            .then(() => {})
            .catch((e) => {
                logger.error(`Unhandled error inside immediate background task [${taskId}]:`, e);
            });
    }).catch((err) => {
        logger.error(`wasAlreadyParsed failed for ${urlPath}, aborting parse task [${taskId}]:`, err);
    });
}

export async function processTaskImmediate(taskId, targetSchema, urlPath, rawData) {
    const startTime = Date.now();
    const batchNow = new Date().toISOString();
    let status = 'COMPLETED';
    let errorMessage = null;
    let evidenceId = null;
    let promptTokens = null;
    let completionTokens = null;
    let totalTokensUsed = 0;

    try {
        targetSchema = await resolveArticleSchema(urlPath, targetSchema);

        if (targetSchema === 'metadata') {
            const parsedJson = JSON.parse(rawData);
            const result = await insertMetadata(urlPath, parsedJson);
            if (!result.success) {
                status = 'FAILED';
                errorMessage = result.error?.message || result.error || 'Metadata Insert Failed';
            }
            return { status, errorMessage };
        }

        const vehicleIdStr = extractVehicleId(urlPath);

        if (targetSchema === 'articles') {
            const ingestRes = await ingestArticlesCatalogFromMotorJson({ urlPath, rawUtf8: rawData });
            if (!ingestRes.success) {
                status = 'FAILED';
                errorMessage = ingestRes.error || 'Catalog ingest failed';
            }
            return { status, errorMessage };
        }

        // For AI-parsed content (procedures, dtcs, tsbs, specifications)

        if (!vehicleIdStr) {
            logger.warn(`[${taskId}] No vehicle_id in URL, skipping insert to avoid orphan rows: ${urlPath}`);
            status = 'FAILED';
            errorMessage = 'Could not extract vehicle_id from URL';
            return { status, errorMessage };
        }

        await ensureVehicleExists(vehicleIdStr, extractContentSource(urlPath));

        if (
            targetSchema === 'diagram_document' ||
            targetSchema === 'component_location_document' ||
            targetSchema === 'labor_operation'
        ) {
            const articleMatch = urlPath.match(/\/(?:article|labor)\/([^?/]+)/);
            const sourceArticleId = articleMatch?.[1] || extractExternalId(urlPath, targetSchema);
            const articleMeta = sourceArticleId
                ? await getArticleCatalogEntry(vehicleIdStr, sourceArticleId)
                : null;

            let evidenceId = null;
            try {
                const evSha = crypto.createHash('sha256').update(rawData).digest('hex');
                const ev = await insertEvidenceIngest({
                    url_path: urlPath.slice(0, 4000),
                    http_status: 200,
                    content_type: targetSchema === 'labor_operation' ? 'application/json' : 'text/html',
                    body_json: { targetSchema },
                    sha256: evSha,
                    vehicle_external_id: vehicleIdStr,
                    content_source: extractContentSource(urlPath),
                    source_label: `${targetSchema}_content`
                });
                if (!ev.success) {
                    logger.warn(`[${taskId}] evidence_ingest skipped: ${ev.error}`);
                } else {
                    evidenceId = ev.id || ev.data?.[0]?.id || null;
                }
            } catch (evErr) {
                logger.warn(`[${taskId}] evidence_ingest failed: ${evErr.message}`);
            }

            let contentHtml = null;
            let metadataJson = {
                source_path: urlPath,
                content_source: extractContentSource(urlPath)
            };

            if (targetSchema === 'labor_operation') {
                try {
                    const parsed = JSON.parse(rawData);
                    const body = parsed?.body || parsed || {};
                    contentHtml =
                        typeof body.content === 'string' ? body.content :
                        typeof body.html === 'string' ? body.html : null;
                    metadataJson = {
                        ...metadataJson,
                        labor_response_id: body.id || sourceArticleId || null,
                        raw_metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : null
                    };
                } catch {
                    contentHtml = typeof rawData === 'string' ? rawData : null;
                }
            } else {
                contentHtml = typeof rawData === 'string' ? rawData : null;
                metadataJson = {
                    ...metadataJson,
                    bucket: articleMeta?.bucket || null,
                    parent_bucket: articleMeta?.parent_bucket || null,
                    thumbnail_href: articleMeta?.thumbnail_href || null
                };
            }

            const row = {
                vehicle_id: vehicleIdStr,
                source_article_id: sourceArticleId,
                title: articleMeta?.title || sourceArticleId || null,
                description: articleMeta?.description || null,
                content_html: contentHtml,
                extractor_version: 'l1-v1',
                metadata_json: metadataJson,
                updated_at: batchNow,
                ...(targetSchema !== 'labor_operation'
                    ? {
                          thumbnail_graphic_id: articleMeta?.thumbnail_href || null,
                          thumbnail_media_asset_id: null
                      }
                    : {})
            };

            const docResult = await insertParsedData(targetSchema, row, { returnRepresentation: true });
            if (!docResult.success) {
                status = 'FAILED';
                errorMessage = docResult.error?.message || docResult.error || `${targetSchema} insert failed`;
                return { status, errorMessage };
            }

            if (evidenceId && docResult.data?.[0]?.id) {
                await insertEvidenceLinks(evidenceId, targetSchema, [docResult.data[0].id], 'l1-v1');
            }

            if (sourceArticleId) {
                const contentItem = buildMinimalContentItemFromParse({
                    vehicleExternalId: vehicleIdStr,
                    motorArticleId: sourceArticleId,
                    contentSource: extractContentSource(urlPath),
                    targetSchema
                });
                contentItem.display_title = row.title;
                contentItem.display_description = row.description;
                contentItem.search_text = `${row.title || ''} ${row.description || ''} ${String(contentHtml || '').replace(/<[^>]+>/g, ' ')}`.slice(0, 8000);
                const ciResult = await insertParsedData('content_item', contentItem, { returnRepresentation: true });
                if (!ciResult.success) {
                    logger.warn(`[${taskId}] content_item upsert skipped for ${targetSchema}: ${ciResult.error}`);
                } else if (evidenceId && ciResult.data?.[0]?.id) {
                    await insertEvidenceLinks(evidenceId, 'content_item', [ciResult.data[0].id], 'l1-v1');
                }

                await ingestL2ContentChunksIfEnabled({
                    taskId,
                    vehicleExternalId: vehicleIdStr,
                    motorArticleId: sourceArticleId,
                    contentSource: extractContentSource(urlPath),
                    targetSchema,
                    htmlContent: contentHtml,
                    parsedData: row
                });
            }
            return { status, errorMessage };
        }

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

        const externalIdStr = extractExternalId(urlPath, targetSchema);
        const articleContentSource = extractContentSource(urlPath);

        if (externalIdStr) {
            let contentItemId = await fetchContentItemId(vehicleIdStr, externalIdStr, articleContentSource);
            if (!contentItemId) {
                const minimal = buildMinimalContentItemFromParse({
                    vehicleExternalId: vehicleIdStr,
                    motorArticleId: externalIdStr,
                    contentSource: articleContentSource,
                    targetSchema
                });
                const ciIns = await insertParsedData('content_item', [minimal], { returnRepresentation: true });
                if (!ciIns.success) {
                    logger.warn(`[${taskId}] content_item pre-parse upsert skipped: ${ciIns.error}`);
                }
                contentItemId = await fetchContentItemId(vehicleIdStr, externalIdStr, articleContentSource);
            }
            if (evidenceId && contentItemId) {
                const links = await insertEvidenceLinks(evidenceId, 'content_item', [contentItemId], 'phase1-v1');
                if (!links.success) {
                    logger.warn(`[${taskId}] content_item evidence_link skipped: ${links.error}`);
                }
            }
        }

        // OCR inline images in HTML before parsing (gated by ENABLE_HTML_IMAGE_OCR)
        if (ENABLE_HTML_IMAGE_OCR && typeof rawData === 'string' && rawData.includes('<img')) {
            try { rawData = await extractTextFromHtmlImages(rawData, taskId); }
            catch (err) { logger.warn(`[${taskId}] HTML image OCR pre-parse failed: ${err?.message}`); }
        }

        const vehicleContext = await resolveVehicleContext(vehicleIdStr).catch(() => null);
        const { parsed: parsedData, usage: parseUsage } = await parseWithAI(rawData, targetSchema, {
            urlPath,
            vehicleContext
        });

        if (parseUsage) {
            promptTokens = parseUsage.prompt_tokens ?? null;
            completionTokens = parseUsage.completion_tokens ?? null;
            totalTokensUsed = (parseUsage.prompt_tokens || 0) + (parseUsage.completion_tokens || 0);
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
                    const b64Raw = pdfBase64.replace(/^data:application\/pdf;base64,/i, '');
                    const pdfBuf = Buffer.from(b64Raw, 'base64');
                    if (ENABLE_MEDIA_ASSET_PDF && externalIdStr && pdfBuf.length > 0) {
                        try {
                            const mar = await upsertMediaAssetPdfFromArticleBody({
                                vehicleExternalId: vehicleIdStr,
                                contentSource: extractContentSource(urlPath),
                                motorArticleId: externalIdStr,
                                pdfBuffer: pdfBuf
                            });
                            if (!mar.success) {
                                logger.warn(`[${taskId}] media_asset (PDF) skipped: ${mar.error}`);
                            }
                        } catch (maErr) {
                            logger.warn(`[${taskId}] media_asset (PDF) failed: ${maErr.message}`);
                        }
                    }
                    // PDF extraction priority chain (first success wins):
                    //  1. Document AI Layout Parser — best for structured/text PDFs (tables, lists)
                    //  2. Cloud Vision DOCUMENT_TEXT_DETECTION — best for scanned/image PDFs (separate account)
                    //  3. pdfjs-dist native text — fast, zero-cost, works for text-layer PDFs
                    //  4. Gemini vision fallback — last resort for image-only PDFs
                    let pdfText = '';
                    let pdfSource = 'unknown';

                    // 1. Document AI
                    try {
                        const { parsePdfWithDocumentAI, isDocumentAiConfigured } = await import('./document_ai.js');
                        if (isDocumentAiConfigured()) {
                            const daiResult = await parsePdfWithDocumentAI(pdfBuf);
                            if (daiResult.success && daiResult.markdown && daiResult.markdown.trim().length >= MIN_NATIVE_PDF_TEXT_LENGTH) {
                                pdfText = daiResult.markdown;
                                pdfSource = 'document-ai';
                                logger.info(`[${taskId}] Document AI PDF: ${pdfText.length} chars`);
                            }
                        }
                    } catch (daiErr) {
                        logger.warn(`[${taskId}] Document AI PDF failed: ${daiErr.message}`);
                    }

                    // 2. Cloud Vision (separate GCP account — CLOUD_VISION_API_KEY)
                    if (!pdfText) {
                        try {
                            const { extractTextFromPdfWithVision, isVisionConfigured } = await import('./cloud_vision.js');
                            if (isVisionConfigured()) {
                                const vResult = await extractTextFromPdfWithVision(pdfBuf);
                                if (vResult.success && vResult.text && vResult.text.trim().length >= MIN_NATIVE_PDF_TEXT_LENGTH) {
                                    pdfText = vResult.text;
                                    pdfSource = 'cloud-vision';
                                    logger.info(`[${taskId}] Cloud Vision PDF: ${pdfText.length} chars`);
                                }
                            }
                        } catch (cvErr) {
                            logger.warn(`[${taskId}] Cloud Vision PDF failed: ${cvErr.message}`);
                        }
                    }

                    // 3. pdfjs-dist native text layer
                    if (!pdfText) {
                        pdfText = await extractTextFromPdfBase64(pdfBase64, { maxPages: 40 });
                        if (pdfText) pdfSource = 'native-pdf';
                    }

                    // 4. Gemini vision fallback (image-only PDFs, explicit opt-in)
                    if (
                        (!pdfText || pdfText.trim().length < MIN_NATIVE_PDF_TEXT_LENGTH) &&
                        ENABLE_NEMOTRON_PDF_VISION_FALLBACK
                    ) {
                        try {
                            const visionText = await extractTextFromPdfPageViaNemotronSafe(pdfBuf, PDF_VISION_FALLBACK_PAGE, {
                                instruction:
                                    'Transcribe all readable text from this automotive service PDF page. ' +
                                    'Preserve line breaks. Return only text.'
                            });
                            if (visionText && visionText.trim().length > (pdfText || '').trim().length) {
                                pdfText = visionText.trim();
                                pdfSource = 'gemini-vision';
                            }
                        } catch (visionErr) {
                            logger.warn(`[${taskId}] Gemini vision PDF fallback failed: ${visionErr.message}`);
                        }
                    }

                    if (pdfText && pdfText.length >= 20) {
                        htmlContent = `<pre class="torque-native-pdf-text" data-source="${pdfSource}">${htmlEscape(pdfText)}</pre>`;
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
            // content_item row was already ensured in the pre-parse block above; only enrich + L2 here.
            const isArticleId = Boolean(urlPath.match(/\/article\/([^?/]+)/));
            if (isArticleId && externalIdStr) {
                const cs = articleContentSource;
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

                // RAG corpus ingestion (fire-and-forget; failure never blocks the parse)
                if (isRagConfigured()) {
                    const articleMeta = await getArticleCatalogEntry(vehicleIdStr, externalIdStr).catch(() => null);
                    ingestArticleToRagCorpus({
                        vehicleId: vehicleIdStr,
                        articleId: externalIdStr,
                        targetSchema,
                        title: articleMeta?.title || externalIdStr,
                        htmlContent,
                        parsedData,
                        vehicleContext
                    }).catch(err => logger.warn(`[${taskId}] RAG corpus ingest failed: ${err.message}`));
                }
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
                const specFactRows = specificationRowsToSpecFacts(normalized, sourceArticleId, batchNow);
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

            // L1 procedure_step/tool/part: delete-then-insert per (vehicle, article).
            // Wrapped with retry: if delete succeeds but insert fails, retry the insert once
            // to avoid data loss from the non-atomic replace.
            if (targetSchema === 'procedures') {
                const procList = Array.isArray(normalized) ? normalized : normalized ? [normalized] : [];
                const pairKeys = new Map();
                for (const proc of procList) {
                    if (proc.vehicle_id && proc.external_id) {
                        const k = `${proc.vehicle_id}::${proc.external_id}`;
                        pairKeys.set(k, [proc.vehicle_id, proc.external_id]);
                    }
                }

                const l1Tables = [
                    {
                        name: 'procedure_step',
                        rows: buildProcedureStepRows(normalized, batchNow),
                        deleteFn: deleteProcedureStepsForArticle,
                        isMissingTable: false
                    },
                    {
                        name: 'procedure_tool',
                        rows: buildProcedureToolRows(normalized, batchNow),
                        deleteFn: deleteProcedureToolsForArticle,
                        isMissingTable: true
                    },
                    {
                        name: 'procedure_part',
                        rows: buildProcedurePartRows(normalized, batchNow),
                        deleteFn: deleteProcedurePartsForArticle,
                        isMissingTable: true
                    }
                ];

                for (const { name, rows, deleteFn, isMissingTable } of l1Tables) {
                    for (const [, pair] of pairKeys) {
                        const [vid, aid] = pair;
                        const del = await deleteFn(vid, aid);
                        if (!del.success) {
                            if (isMissingTable && isMissingProcedureToolTableError(del.error)) {
                                warnProcedureToolTablesOnce(del.error);
                            } else {
                                logger.warn(`[${taskId}] ${name} delete skipped: ${del.error}`);
                            }
                        }
                    }

                    if (rows.length > 0) {
                        let res = await insertParsedData(name, rows, { returnRepresentation: true });
                        if (!res.success) {
                            logger.warn(`[${taskId}] ${name} insert failed, retrying once: ${res.error}`);
                            res = await insertParsedData(name, rows, { returnRepresentation: true });
                        }
                        if (!res.success) {
                            if (isMissingTable && isMissingProcedureToolTableError(res.error)) {
                                warnProcedureToolTablesOnce(res.error);
                            } else {
                                logger.warn(`[${taskId}] ${name} insert skipped after retry: ${res.error}`);
                            }
                        } else if (evidenceId && Array.isArray(res.rows) && res.rows.length > 0) {
                            const ids = res.rows.map((r) => r.id).filter(Boolean);
                            if (ids.length > 0) {
                                const links = await insertEvidenceLinks(evidenceId, name, ids, 'l1-v1');
                                if (!links.success) {
                                    logger.warn(`[${taskId}] ${name} evidence_link skipped: ${links.error}`);
                                }
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
    return { status, errorMessage };
}

/**
 * Await full worker ingest for a single Motor proxy response (catalog, article body, etc.).
 * @param {string} urlPath Path as seen by the proxy (e.g. /api/source/MOTOR/vehicle/…/article/…)
 * @param {string} rawUtf8 Response body (UTF-8)
 * @param {{ taskId?: string }} [options]
 */
export async function ingestMotorProxyPayloadAwait(urlPath, rawUtf8, options = {}) {
    const taskId = options.taskId || Math.random().toString(36).substring(2, 9);
    let schema = determineSchemaType(urlPath);
    if (!schema) {
        return { status: 'FAILED', errorMessage: `unsupported_path: ${urlPath}` };
    }
    schema = await resolveArticleSchema(urlPath, schema);
    return processTaskImmediate(taskId, schema, urlPath, rawUtf8);
}
