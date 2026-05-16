/**
 * Universal ingest endpoint — POST /api/ingest
 *
 * Accepts any format (JSON, TXT, HTML, PDF, PNG/JPG, XML, vector embedding arrays)
 * and normalizes it into the vehicle database.
 *
 * Vehicle resolution order:
 *   1. vehicleId query/body param (external_id, e.g. "2023:Toyota:4Runner")
 *   2. year + make + model query/body params → look up in DB
 *   3. AI extraction from content → return vehicleHints with recommendation
 */
import { dbQuery } from '../db.js';
import { parseWithAI } from '../ai_parser.js';
import { classifySchemaWithAI } from '../catalog_intelligence.js';
import { isVisionConfigured, extractTextFromImageWithVision, extractTextFromPdfWithVision } from '../cloud_vision.js';
import { isDocumentAiConfigured, parsePdfWithDocumentAI } from '../document_ai.js';
import { extractTextFromPdfBase64 } from '../pdf_native_text.js';
import { getGeminiClient, getParseModel } from '../nemotron_client.js';
import logger from '../logger.js';

// ─── Format detection ────────────────────────────────────────────────────────

const MIME_MAP = {
    'application/json': 'json',
    'text/plain': 'txt',
    'text/html': 'html',
    'application/pdf': 'pdf',
    'application/xml': 'xml',
    'text/xml': 'xml',
    'image/jpeg': 'image',
    'image/jpg': 'image',
    'image/png': 'image',
    'image/webp': 'image',
    'application/octet-stream': 'binary',
};

function detectFormat(contentType = '', body) {
    const base = contentType.split(';')[0].trim().toLowerCase();
    if (MIME_MAP[base]) return MIME_MAP[base];
    // Sniff from raw bytes / content
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        const header = Buffer.from(body).slice(0, 5).toString('hex');
        if (header.startsWith('25504446')) return 'pdf'; // %PDF
        if (header.startsWith('89504e47')) return 'image'; // PNG
        if (header.startsWith('ffd8ff')) return 'image';   // JPEG
    }
    if (typeof body === 'string') {
        const trimmed = body.trimStart();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
        if (trimmed.startsWith('<')) return 'html';
        if (trimmed.startsWith('<?xml')) return 'xml';
    }
    return 'txt';
}

// ─── Text extraction ─────────────────────────────────────────────────────────

async function extractText(format, raw) {
    switch (format) {
        case 'json': {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return { text: JSON.stringify(parsed, null, 2), structured: parsed };
        }
        case 'txt':
            return { text: typeof raw === 'string' ? raw : raw.toString('utf8') };
        case 'html': {
            const html = typeof raw === 'string' ? raw : raw.toString('utf8');
            const text = html
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&[a-z#0-9]+;/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            return { text, html };
        }
        case 'xml': {
            const xml = typeof raw === 'string' ? raw : raw.toString('utf8');
            const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            return { text, xml };
        }
        case 'pdf': {
            const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
            // Priority: Document AI → Cloud Vision → pdfjs native
            if (isDocumentAiConfigured()) {
                try {
                    const result = await parsePdfWithDocumentAI(buf);
                    if (result?.text?.length > 120) return { text: result.text, source: 'document-ai' };
                } catch { /* fall through */ }
            }
            const b64 = buf.toString('base64');
            const native = await extractTextFromPdfBase64(b64).catch(() => '');
            if (native.length > 120) return { text: native, source: 'pdfjs' };
            if (isVisionConfigured()) {
                const visionText = await extractTextFromPdfWithVision(buf).catch(() => '');
                if (visionText) return { text: visionText, source: 'cloud-vision' };
            }
            return { text: native || '', source: 'pdfjs-sparse' };
        }
        case 'image': {
            const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
            const dataUri = `data:image/jpeg;base64,${buf.toString('base64')}`;
            if (isVisionConfigured()) {
                const text = await extractTextFromImageWithVision(dataUri).catch(() => '');
                return { text, source: 'cloud-vision' };
            }
            // Gemini vision fallback
            return { text: '', source: 'unavailable', warning: 'No vision API configured (set CLOUD_VISION_API_KEY)' };
        }
        case 'binary': {
            // Could be a pre-computed float32 embedding array
            const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
            const floats = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
            return { text: '', vector: Array.from(floats), source: 'binary-vector' };
        }
        default:
            return { text: typeof raw === 'string' ? raw : raw.toString('utf8') };
    }
}

// ─── AI vehicle identification ────────────────────────────────────────────────

/**
 * Primary path: use Gemini to extract ALL vehicles mentioned in the content,
 * then match each against the vehicles table.
 * Returns the best match + all candidates + confidence.
 */
async function identifyVehiclesWithAI(text, hintVehicleId, hintYear, hintMake, hintModel) {
    if (!text && !hintVehicleId && !hintYear) {
        return { candidates: [], aiExtracted: null, resolution: 'no-content' };
    }

    // Load known vehicles from DB for context (make+model combos)
    const { rows: knownVehicles } = await dbQuery(
        `SELECT external_id, year, make, model FROM vehicles ORDER BY year DESC, make, model LIMIT 500`
    ).catch(() => ({ rows: [] }));

    const knownList = knownVehicles
        .map(v => `${v.year} ${v.make} ${v.model} [id: ${v.external_id}]`)
        .join('\n');

    const prompt = `You are an automotive data attribution expert. Identify which vehicle(s) this content belongs to.

KNOWN VEHICLES IN DATABASE:
${knownList || '(none yet)'}

HINTS PROVIDED BY USER:
${hintVehicleId ? `vehicleId: ${hintVehicleId}` : ''}
${hintYear ? `year: ${hintYear}` : ''}
${hintMake ? `make: ${hintMake}` : ''}
${hintModel ? `model: ${hintModel}` : ''}

CONTENT TO ANALYZE (first 3000 chars):
${text?.slice(0, 3000) || '(no text content — use hints only)'}

Return ONLY valid JSON:
{
  "vehicles": [
    {
      "year": number,
      "make": string,
      "model": string,
      "trim": string|null,
      "engine": string|null,
      "vin": string|null,
      "confidence": "high"|"medium"|"low",
      "reasoning": "brief explanation",
      "matchedDbId": "exact external_id from KNOWN VEHICLES if matched, else null"
    }
  ],
  "coversMultipleVehicles": boolean,
  "overallConfidence": "high"|"medium"|"low",
  "cannotDetermine": boolean,
  "cannotDetermineReason": string|null
}`;

    let aiResult = null;
    try {
        const ai = getGeminiClient();
        const model = getParseModel();
        const resp = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { responseMimeType: 'application/json', temperature: 0 },
        });
        const raw = resp.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        aiResult = JSON.parse(raw);
    } catch (e) {
        logger.warn('[ingest] AI vehicle identification failed:', e.message);
        // Fall back to hint-based resolution
    }

    // Build candidate list from AI result
    const candidates = [];
    for (const v of (aiResult?.vehicles || [])) {
        const extId = v.matchedDbId || `${v.year}:${v.make}:${v.model}`;
        // Look up in DB
        const { rows } = await dbQuery(
            `SELECT external_id, year, make, model, is_normalized FROM vehicles WHERE external_id = $1 LIMIT 1`,
            [extId]
        ).catch(() => ({ rows: [] }));
        candidates.push({
            ...v,
            vehicleId: extId,
            inDatabase: rows.length > 0,
            vehicle: rows[0] || null,
        });
    }

    // If AI returned nothing, fall back to hints
    if (!candidates.length && (hintVehicleId || (hintYear && hintMake && hintModel))) {
        const extId = hintVehicleId || `${hintYear}:${hintMake}:${hintModel}`;
        const { rows } = await dbQuery(
            `SELECT external_id, year, make, model, is_normalized FROM vehicles WHERE external_id = $1 LIMIT 1`,
            [extId]
        ).catch(() => ({ rows: [] }));
        candidates.push({
            year: Number(hintYear) || null,
            make: hintMake || null,
            model: hintModel || null,
            vehicleId: extId,
            confidence: 'medium',
            reasoning: 'User-provided hint (no AI extraction)',
            inDatabase: rows.length > 0,
            vehicle: rows[0] || null,
        });
    }

    // Best candidate = first high/medium confidence that's in DB; else first in DB; else first overall
    const inDb = candidates.filter(c => c.inDatabase);
    const best = inDb.find(c => c.confidence !== 'low') || inDb[0] || candidates[0] || null;

    return {
        candidates,
        best,
        aiExtracted: aiResult,
        coversMultiple: aiResult?.coversMultipleVehicles || false,
        overallConfidence: aiResult?.overallConfidence || (best?.confidence ?? 'low'),
        cannotDetermine: aiResult?.cannotDetermine || (!candidates.length),
        cannotDetermineReason: aiResult?.cannotDetermineReason || null,
        resolution: best?.inDatabase ? 'ai-matched' : candidates.length ? 'ai-extracted-not-in-db' : 'unknown',
    };
}

/** Classify what kind of content this is (procedure, tsb, dtc, spec, fluid, part, diagram, etc.). */
async function classifyContent(text, filename = '') {
    const heuristic = classifySchemaWithAI ? null : simpleHeuristic(text, filename);
    if (heuristic) return heuristic;
    try {
        const result = await classifySchemaWithAI('', '', '', text.slice(0, 1000));
        return result?.canonical_silo_code || 'silo_other';
    } catch {
        return simpleHeuristic(text, filename);
    }
}

function simpleHeuristic(text, filename) {
    const t = (text + ' ' + filename).toLowerCase();
    if (/\btsb\b|technical service bulletin|service campaign/.test(t)) return 'silo_tsbs';
    if (/\bdtc\b|trouble code|diagnostic.*code|p0[0-9]{3}|c0[0-9]{3}/.test(t)) return 'silo_dtcs';
    if (/wiring|schematic|circuit diagram|electrical diagram/.test(t)) return 'silo_diagrams';
    if (/component location|locating the|sensor location/.test(t)) return 'silo_component_locations';
    if (/fluid|oil|coolant|brake fluid|transmission fluid|capacit/.test(t)) return 'silo_specs';
    if (/labor|flat.?rate|operation time|hours|\.h\b/.test(t)) return 'silo_labor';
    if (/maintenance|service interval|schedule|at.*miles|at.*km/.test(t)) return 'silo_maintenance';
    if (/part number|oe number|oem part|cross.?reference/.test(t)) return 'silo_parts';
    if (/step [0-9]|procedure|removal|installation|torque to|in.*lb|ft.*lb/.test(t)) return 'silo_procedures';
    return 'silo_other';
}

// ─── Schema routing ───────────────────────────────────────────────────────────

const SILO_TO_SCHEMA = {
    silo_procedures: 'procedures',
    silo_tsbs: 'tsbs',
    silo_dtcs: 'dtcs',
    silo_diagrams: 'diagram_document',
    silo_component_locations: 'component_location_document',
    silo_specs: 'specifications',
    silo_parts: 'parts',
    silo_labor: 'labor_operation',
    silo_maintenance: 'maintenance_schedules',
    silo_other: 'procedures', // best-effort fallback
};

// ─── Route registration ───────────────────────────────────────────────────────

export function registerIngestEndpoint(app, secureAuthMiddleware, logger) {
    /**
     * POST /api/ingest
     *
     * Query params (or JSON body fields):
     *   vehicleId    — external_id ("2023:Toyota:4Runner")
     *   year, make, model — alternative to vehicleId
     *   createVehicle — "true" to auto-create vehicle record if missing
     *   title        — optional document title hint
     *   source       — optional source label
     *   contentType  — optional: "procedure"|"tsb"|"dtc"|"spec"|"fluid"|"part"|"diagram"
     *
     * Body: raw file/content in any supported format
     */
    app.post('/api/ingest', secureAuthMiddleware, async (req, res) => {
        const startMs = Date.now();
        try {
            // ── Params ──────────────────────────────────────────────────────
            const vehicleId   = req.query.vehicleId   || req.body?.vehicleId;
            const year        = req.query.year        || req.body?.year;
            const make        = req.query.make        || req.body?.make;
            const model       = req.query.model       || req.body?.model;
            const titleHint   = req.query.title       || req.body?.title || '';
            const sourceLabel = req.query.source      || req.body?.source || 'ingest';
            const typeHint    = req.query.contentType || req.body?.contentType || '';
            const createVehicle = String(req.query.createVehicle || req.body?.createVehicle || '').toLowerCase() === 'true';

            // ── Detect format + extract text ────────────────────────────────
            const contentType = req.headers['content-type'] || '';
            const raw = req.body;
            const format = detectFormat(contentType, raw);

            logger.info(`[ingest] format=${format} vehicleId=${vehicleId || '?'} source=${sourceLabel}`);

            let extracted;
            try {
                extracted = await extractText(format, raw);
            } catch (e) {
                return res.status(422).json({ error: 'Content extraction failed', detail: e.message });
            }

            const { text = '', vector, warning: extractWarning, source: extractSource } = extracted;

            // ── Handle pre-computed vector ──────────────────────────────────
            if (format === 'binary' && vector?.length) {
                return res.json({
                    format: 'vector',
                    dimensions: vector.length,
                    message: 'Pre-computed embedding received.',
                    recommendation: 'Provide vehicleId + contentItemId params to attach this embedding to an existing content item for L2 search.',
                });
            }

            // ── AI vehicle identification (always runs) ─────────────────────
            logger.info(`[ingest] running AI vehicle identification (textLen=${text.length})`);
            const identification = await identifyVehiclesWithAI(text, vehicleId, year, make, model);
            const { best, candidates, coversMultiple, overallConfidence, cannotDetermine, cannotDetermineReason, resolution } = identification;

            // ── Cannot determine vehicle at all ─────────────────────────────
            if (cannotDetermine && !createVehicle) {
                return res.status(200).json({
                    stored: false,
                    vehicleResolution: 'cannot-determine',
                    cannotDetermineReason,
                    format,
                    extractedTextLength: text.length,
                    extractionSource: extractSource,
                    extractWarning,
                    candidates,
                    recommendation: {
                        message: 'AI could not identify the vehicle from this content.',
                        options: [
                            'Add vehicleId param (e.g. ?vehicleId=2023:Toyota:4Runner)',
                            'Add year, make, model params',
                            'Include vehicle information in the document (year/make/model/VIN)',
                        ],
                    },
                });
            }

            // ── Vehicle identified but not in DB ────────────────────────────
            if (best && !best.inDatabase && !createVehicle) {
                return res.status(200).json({
                    stored: false,
                    vehicleResolution: resolution,
                    format,
                    extractedTextLength: text.length,
                    extractionSource: extractSource,
                    extractWarning,
                    aiIdentification: {
                        best: { vehicleId: best.vehicleId, confidence: best.confidence, reasoning: best.reasoning },
                        candidates: candidates.map(c => ({ vehicleId: c.vehicleId, confidence: c.confidence, inDatabase: c.inDatabase })),
                        coversMultipleVehicles: coversMultiple,
                        overallConfidence,
                    },
                    recommendation: {
                        message: `AI identified "${best.vehicleId}" (confidence: ${best.confidence}) but it is not in the database.`,
                        options: [
                            `Re-submit with createVehicle=true to auto-create "${best.vehicleId}" and store this content`,
                            `Load the vehicle via the vehicle selector (/api/year/${best.year}/make/${best.make}/models) then re-submit`,
                            `Re-submit with vehicleId="${best.vehicleId}"&createVehicle=true`,
                        ],
                        suggestedResubmit: {
                            url: `/api/ingest?vehicleId=${encodeURIComponent(best.vehicleId)}&createVehicle=true`,
                            vehicleId: best.vehicleId,
                        },
                    },
                });
            }

            // ── Auto-create vehicle when AI identified it but it's not in DB ─
            let vehicle = best?.vehicle || null;
            let finalResolution = resolution;

            if (!vehicle && best && createVehicle) {
                const parts = best.vehicleId.split(':');
                await dbQuery(
                    `INSERT INTO vehicles (external_id, content_source, year, make, model)
                     VALUES ($1, 'MOTOR', $2, $3, $4) ON CONFLICT (external_id) DO NOTHING`,
                    [best.vehicleId, parts[0] || null, parts[1] || null, parts[2] || null]
                );
                const { rows } = await dbQuery(
                    `SELECT external_id, year, make, model FROM vehicles WHERE external_id = $1`,
                    [best.vehicleId]
                );
                vehicle = rows[0];
                finalResolution = 'ai-identified-and-created';
            }

            if (!vehicle) {
                return res.status(422).json({ error: 'Vehicle could not be resolved or created', identification });
            }

            const vehicleExtId = vehicle.external_id;

            // ── Classify silo ────────────────────────────────────────────────
            const siloCode = typeHint
                ? (`silo_${typeHint}` in SILO_TO_SCHEMA ? `silo_${typeHint}` : 'silo_other')
                : await classifyContent(text, titleHint);
            const targetSchema = SILO_TO_SCHEMA[siloCode] || 'procedures';

            logger.info(`[ingest] vehicle=${vehicleExtId} silo=${siloCode} schema=${targetSchema}`);

            // ── AI normalization ─────────────────────────────────────────────
            let parsed = null;
            let aiWarning = null;
            if (text.length > 20) {
                try {
                    parsed = await parseWithAI(text, targetSchema, {
                        vehicleId: vehicleExtId,
                        title: titleHint,
                        source: sourceLabel,
                    });
                } catch (e) {
                    aiWarning = `AI parse failed: ${e.message}`;
                    logger.warn('[ingest] AI parse error:', e.message);
                }
            }

            // ── Store evidence_ingest record ─────────────────────────────────
            const evidenceResult = await dbQuery(
                `INSERT INTO evidence_ingest (vehicle_external_id, content_source, source_label, http_status, content_type, body_json)
                 VALUES ($1, 'MOTOR', $2, 200, $3, $4::jsonb) RETURNING id`,
                [vehicleExtId, sourceLabel, format, JSON.stringify({ text: text.slice(0, 5000), raw: typeof raw === 'string' ? raw.slice(0, 2000) : null })]
            );
            const evidenceId = evidenceResult.rows[0]?.id;

            // ── Store normalized data ────────────────────────────────────────
            let recordsCreated = 0;
            const storedTables = [];

            if (parsed && !parsed.error) {
                try {
                    await storeParsed(parsed, targetSchema, vehicleExtId, evidenceId, sourceLabel);
                    recordsCreated = countRecords(parsed, targetSchema);
                    storedTables.push(targetSchema);
                } catch (e) {
                    aiWarning = (aiWarning ? aiWarning + '; ' : '') + `Storage failed: ${e.message}`;
                    logger.error('[ingest] storage error:', e.message);
                }
            }

            // ── Also store as content_item for L2 RAG ────────────────────────
            if (text.length > 50) {
                try {
                    const ciResult = await dbQuery(
                        `INSERT INTO content_item (kind, motor_article_id, vehicle_external_id, content_source,
                          motor_title, canonical_silo_code, search_text, source_label, enrichment_source)
                         VALUES ($1, $2, $3, 'MOTOR', $4, $5, $6, $7, 'ingest') RETURNING id`,
                        [
                            targetSchema,
                            `ingest:${Date.now()}`,
                            vehicleExtId,
                            titleHint || `Ingested ${format.toUpperCase()} — ${new Date().toISOString()}`,
                            siloCode,
                            text.slice(0, 10000),
                            sourceLabel,
                        ]
                    );
                    storedTables.push('content_item');
                    if (evidenceId && ciResult.rows[0]?.id) {
                        await dbQuery(
                            `INSERT INTO evidence_link (evidence_id, entity_type, entity_id) VALUES ($1, 'content_item', $2) ON CONFLICT DO NOTHING`,
                            [evidenceId, ciResult.rows[0].id]
                        );
                    }
                } catch (e) {
                    logger.warn('[ingest] content_item insert failed:', e.message);
                }
            }

            return res.json({
                stored: true,
                vehicleId: vehicleExtId,
                vehicleResolution: finalResolution,
                aiIdentification: {
                    best: { vehicleId: best?.vehicleId, confidence: best?.confidence, reasoning: best?.reasoning, engine: best?.engine, trim: best?.trim },
                    candidates: candidates.map(c => ({ vehicleId: c.vehicleId, confidence: c.confidence, inDatabase: c.inDatabase, reasoning: c.reasoning })),
                    coversMultipleVehicles: coversMultiple,
                    overallConfidence,
                },
                format,
                extractionSource: extractSource,
                siloCode,
                targetSchema,
                recordsCreated,
                storedTables,
                textLength: text.length,
                evidenceId,
                durationMs: Date.now() - startMs,
                warnings: [extractWarning, aiWarning].filter(Boolean),
            });

        } catch (err) {
            logger.error('[ingest] unhandled error:', err);
            return res.status(500).json({ error: err.message });
        }
    });

    // ── GET /api/ingest/status — describe what's configured ─────────────────
    app.get('/api/ingest/status', secureAuthMiddleware, async (req, res) => {
        const { isVisionConfigured: vision } = await import('../cloud_vision.js');
        const { isDocumentAiConfigured: docAi } = await import('../document_ai.js');
        const { rows } = await dbQuery(`SELECT COUNT(*) FROM evidence_ingest`).catch(() => ({ rows: [{ count: 0 }] }));
        res.json({
            supportedFormats: ['json', 'txt', 'html', 'pdf', 'png', 'jpg', 'xml', 'binary/vector'],
            extractors: {
                pdf: docAi() ? 'document-ai' : vision() ? 'cloud-vision' : 'pdfjs-native',
                image: vision() ? 'cloud-vision' : 'unavailable',
                text: 'native',
            },
            totalIngested: Number(rows[0].count),
            vehicleResolutionOptions: [
                'vehicleId param  — direct match ("2023:Toyota:4Runner")',
                'year+make+model params — looked up or suggested',
                'AI extraction    — vehicle detected from content',
            ],
        });
    });
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

async function storeParsed(parsed, schema, vehicleId, evidenceId, source) {
    switch (schema) {
        case 'procedures': {
            const procs = parsed.procedures || (parsed.title ? [parsed] : []);
            for (const p of procs) {
                const extId = `ingest:${Date.now()}:${Math.random().toString(36).slice(2)}`;
                await dbQuery(
                    `INSERT INTO procedures (vehicle_id, external_id, title, description, content_html, steps, tools_required, parts_required, cautions)
                     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)
                     ON CONFLICT (vehicle_id, external_id) DO UPDATE SET title=EXCLUDED.title, steps=EXCLUDED.steps`,
                    [vehicleId, extId, p.title||'Ingested Procedure', p.description||'', p.html||'',
                     JSON.stringify(p.steps||[]), JSON.stringify(p.tools||[]), JSON.stringify(p.parts||[]), p.cautions||'']
                );
            }
            break;
        }
        case 'tsbs': {
            const tsbs = parsed.tsbs || (parsed.bulletin_number ? [parsed] : []);
            for (const t of tsbs) {
                await dbQuery(
                    `INSERT INTO tsbs (vehicle_id, bulletin_number, title, summary, content_html)
                     VALUES ($1,$2,$3,$4,$5)
                     ON CONFLICT (vehicle_id, bulletin_number) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary`,
                    [vehicleId, t.bulletin_number||`ING-${Date.now()}`, t.title||'', t.summary||t.description||'', t.html||'']
                );
            }
            break;
        }
        case 'dtcs': {
            const dtcs = parsed.dtcs || (parsed.code ? [parsed] : []);
            for (const d of dtcs) {
                await dbQuery(
                    `INSERT INTO dtcs (vehicle_id, code, description, content_html, possible_causes)
                     VALUES ($1,$2,$3,$4,$5::jsonb)
                     ON CONFLICT (vehicle_id, code) DO UPDATE SET description=EXCLUDED.description`,
                    [vehicleId, d.code||'UNK', d.description||'', d.html||'', JSON.stringify(d.possible_causes||[])]
                );
            }
            break;
        }
        case 'specifications': {
            const specs = parsed.specifications || parsed.specs || [];
            for (const s of specs) {
                await dbQuery(
                    `INSERT INTO specifications (vehicle_id, category, name, value, unit, display_text)
                     VALUES ($1,$2,$3,$4,$5,$6)
                     ON CONFLICT (vehicle_id, category, name) DO UPDATE SET value=EXCLUDED.value`,
                    [vehicleId, s.category||'General', s.name||'', s.value||'', s.unit||'', s.display_text||'']
                );
            }
            break;
        }
        case 'maintenance_schedules': {
            const tasks = parsed.tasks || parsed.maintenance || [];
            for (const t of tasks) {
                await dbQuery(
                    `INSERT INTO maintenance_schedules (vehicle_id, interval_value, interval_unit, action, item, description)
                     VALUES ($1,$2,$3,$4,$5,$6)
                     ON CONFLICT (vehicle_id, interval_value, action, item) DO NOTHING`,
                    [vehicleId, t.interval_value||0, t.interval_unit||'Miles', t.action||'', t.item||t.name||'', t.description||'']
                );
            }
            break;
        }
        default:
            // Store as procedure for unrecognized schemas
            await dbQuery(
                `INSERT INTO procedures (vehicle_id, external_id, title, description, steps)
                 VALUES ($1,$2,$3,$4,$5::jsonb)
                 ON CONFLICT (vehicle_id, external_id) DO NOTHING`,
                [vehicleId, `ingest:${Date.now()}`, parsed.title||'Ingested Content', parsed.description||'', JSON.stringify([])]
            );
    }
}

function countRecords(parsed, schema) {
    if (schema === 'procedures') return (parsed.procedures || [parsed]).length;
    if (schema === 'tsbs') return (parsed.tsbs || [parsed]).length;
    if (schema === 'dtcs') return (parsed.dtcs || [parsed]).length;
    if (schema === 'specifications') return (parsed.specifications || parsed.specs || []).length;
    if (schema === 'maintenance_schedules') return (parsed.tasks || parsed.maintenance || []).length;
    return 1;
}
