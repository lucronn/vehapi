/**
 * Database layer — Cloud SQL (PostgreSQL) via `pg`.
 * Keeps identical exports to the former Supabase/PostgREST version so callers need no changes.
 *
 * Connection: see db.js (CLOUD_SQL_CONNECTION_NAME for Cloud Run, DATABASE_URL for local dev).
 */
import crypto from 'node:crypto';
import logger from './logger.js';
import { dbQuery, getPool, isDbConfigured } from './db.js';

// ---------------------------------------------------------------------------
// Legacy compat: callers that checked getSupabaseConfig() != null now check isDbConfigured()
// ---------------------------------------------------------------------------
export function getSupabaseConfig() {
    return isDbConfigured() ? { configured: true } : null;
}

// ---------------------------------------------------------------------------
// Conflict keys for upsert — must match DB unique constraints
// ---------------------------------------------------------------------------
const UPSERT_CONFLICT_COLUMNS = {
    procedures: ['vehicle_id', 'external_id'],
    tsbs: ['vehicle_id', 'bulletin_number'],
    dtcs: ['vehicle_id', 'code'],
    specifications: ['vehicle_id', 'category', 'name'],
    spec_fact: ['vehicle_id', 'category', 'name'],
    parts: ['vehicle_id', 'part_number'],
    maintenance_schedules: ['vehicle_id', 'interval_value', 'action', 'item'],
    maintenance_task: ['vehicle_id', 'interval_value', 'action', 'item'],
    diagram_document: ['vehicle_id', 'source_article_id'],
    component_location_document: ['vehicle_id', 'source_article_id'],
    labor_operation: ['vehicle_id', 'source_article_id'],
    categories: ['name', 'type'],
    vehicle_metadata: ['path'],
    articles: ['vehicle_id', 'original_id'],
    content_item: ['vehicle_external_id', 'motor_article_id', 'content_source'],
    evidence_link: ['evidence_id', 'entity_type', 'entity_id'],
};

// ---------------------------------------------------------------------------
// Row filtering / deduplication (unchanged logic from old version)
// ---------------------------------------------------------------------------
function articlesRowsForRest(rows) {
    const extended =
        String(process.env.ARTICLES_UPSERT_EXTENDED || 'true').toLowerCase() === 'true' ||
        process.env.ARTICLES_UPSERT_EXTENDED === '1';
    const minimal = new Set([
        'vehicle_id',
        'original_id',
        'title',
        'content_source',
        'bucket',
        'parent_bucket',
    ]);
    const extendedOnly = new Set([
        'subtitle',
        'description',
        'code',
        'thumbnail_href',
        'bulletin_number',
        'release_date',
        'sort',
        'original_content',
        'enhanced_content',
        'source',
    ]);
    const allowed = new Set(minimal);
    if (extended) {
        for (const k of extendedOnly) allowed.add(k);
    }
    return rows.map((row) => {
        const out = {};
        for (const k of Object.keys(row)) {
            if (allowed.has(k)) out[k] = row[k];
        }
        return out;
    });
}

function dedupeArticlesByConflictKey(rows) {
    const map = new Map();
    for (const r of rows) {
        const k = `${r.vehicle_id}|${r.original_id}`;
        map.set(k, r);
    }
    const out = [...map.values()];
    if (out.length < rows.length) {
        logger.info(
            `Deduped articles upsert: ${rows.length} -> ${out.length} (duplicate original_id in Motor catalog)`
        );
    }
    return out;
}

function dedupeContentItemsByConflictKey(rows) {
    const map = new Map();
    for (const r of rows) {
        const k = `${r.vehicle_external_id}|${r.motor_article_id}|${r.content_source}`;
        map.set(k, r);
    }
    const out = [...map.values()];
    if (out.length < rows.length) {
        logger.info(
            `Deduped content_item upsert: ${rows.length} -> ${out.length} (duplicate motor_article_id in catalog)`
        );
    }
    return out;
}

function dedupeMaintenanceByConflictKey(rows) {
    const map = new Map();
    const longerDescription = (a, b) => {
        const sa = String(a ?? '').trim().length;
        const sb = String(b ?? '').trim().length;
        return sb > sa ? b : a;
    };
    for (const r of rows) {
        const vid = String(r.vehicle_id ?? '');
        const ivRaw = r.interval_value;
        const ivNum = Number(ivRaw);
        const ivKey = Number.isFinite(ivNum) ? String(ivNum) : String(ivRaw ?? '');
        const action = String(r.action ?? '').trim();
        const item = String(r.item ?? '').trim();
        const k = `${vid}|${ivKey}|${action}|${item}`;
        const prev = map.get(k);
        if (!prev) {
            map.set(k, { ...r });
            continue;
        }
        const merged = { ...prev };
        merged.description = longerDescription(prev.description, r.description);
        merged.frequency_code = prev.frequency_code || r.frequency_code || null;
        merged.interval_unit = prev.interval_unit || r.interval_unit;
        merged.updated_at =
            String(prev.updated_at || '') > String(r.updated_at || '')
                ? prev.updated_at
                : r.updated_at;
        const pa =
            typeof prev.task_metadata === 'object' && prev.task_metadata !== null && !Array.isArray(prev.task_metadata)
                ? prev.task_metadata
                : {};
        const ra =
            typeof r.task_metadata === 'object' && r.task_metadata !== null && !Array.isArray(r.task_metadata)
                ? r.task_metadata
                : {};
        if (Object.keys({ ...pa, ...ra }).length) merged.task_metadata = { ...pa, ...ra };
        const paj =
            typeof prev.metadata_json === 'object' && prev.metadata_json !== null && !Array.isArray(prev.metadata_json)
                ? prev.metadata_json
                : {};
        const raj =
            typeof r.metadata_json === 'object' && r.metadata_json !== null && !Array.isArray(r.metadata_json)
                ? r.metadata_json
                : {};
        if (Object.keys({ ...paj, ...raj }).length) merged.metadata_json = { ...paj, ...raj };
        map.set(k, merged);
    }
    const out = [...map.values()];
    if (out.length < rows.length) {
        logger.info(
            `Deduped maintenance upsert: ${rows.length} -> ${out.length} ` +
                '(duplicate UNIQUE(vehicle_id, interval_value, action, item) in Motor payload)'
        );
    }
    return out;
}

// ---------------------------------------------------------------------------
// Generic upsert builder
// Columns whose values are plain JS Arrays are cast as ::vector (pgvector).
// Everything else is passed as-is; pg handles JSONB serialization for objects.
// ---------------------------------------------------------------------------
function buildUpsertSql(table, rows, conflictCols, { returning = false } = {}) {
    const cols = Object.keys(rows[0]);
    const flatValues = [];

    const valueSets = rows.map((row) => {
        const placeholders = cols.map((col) => {
            const val = row[col];
            // Plain arrays → pgvector; pg serializes JSONB objects natively
            if (Array.isArray(val)) {
                // Format as Postgres literal: [a,b,c]
                flatValues.push(`[${val.join(',')}]`);
                return `$${flatValues.length}::vector`;
            }
            // Serialize plain objects to JSON for JSONB columns
            if (val !== null && typeof val === 'object') {
                flatValues.push(JSON.stringify(val));
            } else {
                flatValues.push(val ?? null);
            }
            return `$${flatValues.length}`;
        });
        return `(${placeholders.join(', ')})`;
    });

    const colList = cols.map((c) => `"${c}"`).join(', ');
    let sql = `INSERT INTO "${table}" (${colList}) VALUES ${valueSets.join(', ')}`;

    if (conflictCols && conflictCols.length > 0) {
        const conflictSet = new Set(conflictCols);
        const conflictList = conflictCols.map((c) => `"${c}"`).join(', ');
        const updateCols = cols.filter((c) => !conflictSet.has(c));
        if (updateCols.length > 0) {
            const setClause = updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
            sql += ` ON CONFLICT (${conflictList}) DO UPDATE SET ${setClause}`;
        } else {
            sql += ` ON CONFLICT (${conflictList}) DO NOTHING`;
        }
    }

    if (returning) sql += ' RETURNING *';
    return { sql, values: flatValues };
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export async function resolveAssociatedVehicleIds(vehicleId) {
    if (!isDbConfigured() || !vehicleId) return [vehicleId || ''];
    try {
        const encoded = encodeURIComponent(vehicleId);
        // Find any external_id that exactly matches, or ends with :vehicleId, or ends with %3AvehicleId
        const { rows } = await dbQuery(
            `SELECT external_id 
             FROM vehicles 
             WHERE external_id = $1 
                OR external_id = $2
                OR right(external_id, length($1) + 1) = ':' || $1
                OR right(lower(external_id), length($1) + 3) = '%3a' || $1`,
            [vehicleId, encoded]
        );
        const ids = new Set(rows.map(r => r.external_id));
        ids.add(vehicleId);
        ids.add(encoded);
        return Array.from(ids);
    } catch (err) {
        logger.error(`Error resolving associated vehicle IDs for ${vehicleId}:`, err);
        return [vehicleId, encodeURIComponent(vehicleId)];
    }
}

export async function ensureVehicleExists(vehicleId, contentSource = 'MOTOR') {
    if (!isDbConfigured() || !vehicleId) return { success: false };
    try {
        await dbQuery(
            `INSERT INTO vehicles (external_id, content_source, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (external_id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
            [vehicleId, contentSource]
        );
        return { success: true };
    } catch (err) {
        logger.error(`Failed to ensure vehicle ${vehicleId}:`, err);
        return { success: false, error: err.message };
    }
}

export async function markVehicleNormalized(vehicleId) {
    if (!isDbConfigured() || !vehicleId) return { success: false };
    try {
        await dbQuery(
            `UPDATE vehicles SET is_normalized = true, updated_at = NOW() WHERE external_id = $1`,
            [vehicleId]
        );
        logger.info(`✓ Vehicle ${vehicleId} marked as normalized`);
        return { success: true };
    } catch (err) {
        logger.error(`Error marking vehicle ${vehicleId} as normalized:`, err);
        return { success: false, error: err.message };
    }
}

export async function checkArticleContent(vehicleId, articleId) {
    if (!isDbConfigured()) return null;
    try {
        const ids = await resolveAssociatedVehicleIds(vehicleId);
        const { rows } = await dbQuery(
            `SELECT * FROM articles WHERE vehicle_id = ANY($1) AND original_id = $2 AND original_content IS NOT NULL LIMIT 1`,
            [ids, articleId]
        );
        return rows.length > 0 ? rows[0] : null;
    } catch {
        return null;
    }
}

export async function getArticleMetadata(vehicleId, articleId) {
    if (!isDbConfigured()) return null;
    try {
        const ids = await resolveAssociatedVehicleIds(vehicleId);
        const { rows } = await dbQuery(
            `SELECT bucket, parent_bucket, title, code, bulletin_number, description
             FROM articles WHERE vehicle_id = ANY($1) AND original_id = $2 LIMIT 1`,
            [ids, articleId]
        );
        if (rows.length === 0) return null;
        const r = rows[0];
        return {
            bucket: r.bucket ?? null,
            parent_bucket: r.parent_bucket ?? null,
            title: r.title ?? null,
            code: r.code ?? null,
            bulletin_number: r.bulletin_number ?? null,
            description: r.description ?? null,
        };
    } catch {
        return null;
    }
}

export async function getArticleCatalogEntry(vehicleId, articleId) {
    if (!isDbConfigured()) return null;
    try {
        const ids = await resolveAssociatedVehicleIds(vehicleId);
        const { rows } = await dbQuery(
            `SELECT title, subtitle, description, thumbnail_href, bucket, parent_bucket, content_source
             FROM articles WHERE vehicle_id = ANY($1) AND original_id = $2 LIMIT 1`,
            [ids, articleId]
        );
        return rows.length > 0 ? rows[0] : null;
    } catch {
        return null;
    }
}

export async function insertEvidenceIngest(row) {
    if (!isDbConfigured()) return { success: false, error: 'DB not configured' };
    try {
        const payload = {
            fetched_at: row.fetched_at || new Date().toISOString(),
            url_path: row.url_path ?? null,
            http_status: row.http_status ?? null,
            content_type: row.content_type ?? null,
            body_json: row.body_json ?? null,
            body_storage_ref: row.body_storage_ref ?? null,
            sha256: row.sha256 ?? null,
            vehicle_external_id: row.vehicle_external_id ?? null,
            content_source: row.content_source ?? 'MOTOR',
            source_label: row.source_label ?? null,
        };
        const cols = Object.keys(payload);
        const colList = cols.map((c) => `"${c}"`).join(', ');
        const placeholders = cols.map((_, i) => {
            const v = payload[cols[i]];
            if (v !== null && typeof v === 'object' && !Array.isArray(v)) return `$${i + 1}::jsonb`;
            return `$${i + 1}`;
        });
        const values = cols.map((c) => {
            const v = payload[c];
            return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : (v ?? null);
        });
        const { rows } = await dbQuery(
            `INSERT INTO evidence_ingest (${colList}) VALUES (${placeholders.join(', ')}) RETURNING id`,
            values
        );
        return { success: true, id: rows[0]?.id ?? null };
    } catch (err) {
        logger.error('insertEvidenceIngest error:', err);
        return { success: false, error: err.message };
    }
}

export async function findEntityIdsByExternalId(table, vehicleId, externalId) {
    if (!isDbConfigured() || !table || !vehicleId || !externalId) return [];
    try {
        const { rows } = await dbQuery(
            `SELECT id FROM "${table}" WHERE vehicle_id = $1 AND external_id = $2`,
            [vehicleId, externalId]
        );
        return rows.map((r) => r.id).filter(Boolean);
    } catch {
        return [];
    }
}

export async function deleteProcedureStepsForArticle(vehicleId, sourceArticleId) {
    if (!isDbConfigured() || !vehicleId || !sourceArticleId) {
        return { success: false, error: 'Missing vehicle_id or source_article_id' };
    }
    try {
        await dbQuery(
            `DELETE FROM procedure_step WHERE vehicle_id = $1 AND source_article_id = $2`,
            [vehicleId, sourceArticleId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function deleteProcedureToolsForArticle(vehicleId, sourceArticleId) {
    if (!isDbConfigured() || !vehicleId || !sourceArticleId) {
        return { success: false, error: 'Missing vehicle_id or source_article_id' };
    }
    try {
        await dbQuery(
            `DELETE FROM procedure_tool WHERE vehicle_id = $1 AND source_article_id = $2`,
            [vehicleId, sourceArticleId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function deleteProcedurePartsForArticle(vehicleId, sourceArticleId) {
    if (!isDbConfigured() || !vehicleId || !sourceArticleId) {
        return { success: false, error: 'Missing vehicle_id or source_article_id' };
    }
    try {
        await dbQuery(
            `DELETE FROM procedure_part WHERE vehicle_id = $1 AND source_article_id = $2`,
            [vehicleId, sourceArticleId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function insertEvidenceLinks(evidenceId, entityType, entityIds, extractorVersion = 'phase1-v1') {
    if (!isDbConfigured() || !evidenceId || !entityType || !Array.isArray(entityIds) || entityIds.length === 0) {
        return { success: false, error: 'Missing link args' };
    }
    try {
        // Batch insert: one row per entityId
        const valueSets = entityIds.map((_, i) => {
            const base = i * 4;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        });
        const values = entityIds.flatMap((id) => [evidenceId, entityType, id, extractorVersion]);
        await dbQuery(
            `INSERT INTO evidence_link (evidence_id, entity_type, entity_id, extractor_version)
             VALUES ${valueSets.join(', ')}
             ON CONFLICT (evidence_id, entity_type, entity_id) DO NOTHING`,
            values
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function updateContentItemEnrichment(vehicleExternalId, motorArticleId, contentSource, patch) {
    if (!isDbConfigured()) return { success: false, error: 'DB not configured' };
    if (!vehicleExternalId || !motorArticleId || !contentSource) {
        return { success: false, error: 'Missing content_item key fields' };
    }
    try {
        const patchWithTs = { ...patch, updated_at: new Date().toISOString() };
        const patchCols = Object.keys(patchWithTs);
        let idx = 1;
        const setClauses = patchCols.map((c) => {
            const v = patchWithTs[c];
            const ph = v !== null && typeof v === 'object' && !Array.isArray(v)
                ? `$${idx}::jsonb`
                : `$${idx}`;
            idx++;
            return `"${c}" = ${ph}`;
        });
        const patchValues = patchCols.map((c) => {
            const v = patchWithTs[c];
            return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : (v ?? null);
        });
        // Try exact match first, then case-insensitive
        const baseParams = [...patchValues, vehicleExternalId, motorArticleId];
        const exactResult = await dbQuery(
            `UPDATE content_item SET ${setClauses.join(', ')}
             WHERE vehicle_external_id = $${idx} AND motor_article_id = $${idx + 1} AND content_source = $${idx + 2}
             RETURNING id`,
            [...baseParams, contentSource]
        );
        if (exactResult.rows.length > 0) {
            return { success: true, updated: exactResult.rows.length };
        }
        const ilikeResult = await dbQuery(
            `UPDATE content_item SET ${setClauses.join(', ')}
             WHERE vehicle_external_id = $${idx} AND motor_article_id = $${idx + 1} AND lower(content_source) = lower($${idx + 2})
             RETURNING id`,
            [...baseParams, contentSource]
        );
        if (ilikeResult.rows.length === 0) {
            return { success: false, error: 'No matching row found for patch' };
        }
        return { success: true, updated: ilikeResult.rows.length };
    } catch (err) {
        logger.error('updateContentItemEnrichment error:', err);
        return { success: false, error: err.message };
    }
}

export async function fetchContentItemId(vehicleExternalId, motorArticleId, contentSource) {
    if (!isDbConfigured() || !vehicleExternalId || !motorArticleId || !contentSource) return null;
    try {
        let { rows } = await dbQuery(
            `SELECT id FROM content_item WHERE vehicle_external_id = $1 AND motor_article_id = $2 AND content_source = $3 LIMIT 1`,
            [vehicleExternalId, motorArticleId, contentSource]
        );
        if (rows.length === 0) {
            ({ rows } = await dbQuery(
                `SELECT id FROM content_item WHERE vehicle_external_id = $1 AND motor_article_id = $2 AND lower(content_source) = lower($3) LIMIT 1`,
                [vehicleExternalId, motorArticleId, contentSource]
            ));
        }
        const id = rows[0]?.id;
        return typeof id === 'string' ? id : null;
    } catch {
        return null;
    }
}

export async function deleteContentChunksForContentItem(contentItemId) {
    if (!isDbConfigured() || !contentItemId) {
        return { success: false, error: 'Missing config or content_item id' };
    }
    try {
        await dbQuery(`DELETE FROM content_chunk WHERE content_item_id = $1`, [contentItemId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function replaceContentChunksForContentItem(contentItemId, rows) {
    const del = await deleteContentChunksForContentItem(contentItemId);
    if (!del.success) return del;
    if (!rows || rows.length === 0) return { success: true };
    const payload = rows.map((r) => ({
        content_item_id: contentItemId,
        chunk_index: r.chunk_index,
        text_content: r.text_content,
        embedding: r.embedding,
    }));
    return insertParsedData('content_chunk', payload);
}

export async function matchContentChunksRpc({ queryEmbedding, vehicleExternalId, matchCount }) {
    if (!isDbConfigured()) return { success: false, error: 'DB not configured' };
    try {
        const vecLiteral = `[${queryEmbedding.join(',')}]`;
        const { rows } = await dbQuery(
            `SELECT chunk_id, content_item_id, motor_article_id, canonical_silo_code,
                    content_source, chunk_index, text_content, similarity
             FROM match_content_chunks($1::vector, $2, $3)`,
            [vecLiteral, vehicleExternalId, matchCount]
        );
        const chunks = rows.map((r) => ({
            chunkId: r.chunk_id,
            contentItemId: r.content_item_id,
            motorArticleId: r.motor_article_id,
            canonicalSiloCode: r.canonical_silo_code,
            contentSource: r.content_source,
            chunkIndex: r.chunk_index,
            text: r.text_content,
            score: r.similarity,
        }));
        return { success: true, chunks };
    } catch (err) {
        return { success: false, error: err.message || String(err) };
    }
}

export async function upsertMediaAssetPdfFromArticleBody({ vehicleExternalId, contentSource, motorArticleId, pdfBuffer }) {
    if (!isDbConfigured() || !vehicleExternalId || !motorArticleId || !pdfBuffer || pdfBuffer.length === 0) {
        return { success: false, error: 'Missing config or PDF bytes' };
    }
    const sha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
    const motorGraphicId = `pdf:${motorArticleId}`;
    try {
        const { rows: existing } = await dbQuery(
            `SELECT id FROM media_asset WHERE vehicle_external_id = $1 AND motor_graphic_id = $2 LIMIT 1`,
            [vehicleExternalId, motorGraphicId]
        );
        if (existing.length > 0) return { success: true, skipped: true, id: existing[0].id };
        return insertParsedData('media_asset', [
            {
                vehicle_external_id: vehicleExternalId,
                content_source: contentSource || 'MOTOR',
                motor_graphic_id: motorGraphicId,
                mime_type: 'application/pdf',
                sha256,
                source_label: 'article_body_pdf',
                metadata_json: { byte_length: pdfBuffer.length, ingested_by: 'background_worker' },
            },
        ]);
    } catch (err) {
        return { success: false, error: err.message || String(err) };
    }
}

export async function upsertMediaAssetGraphicBinary({
    vehicleExternalId = null,
    contentSource,
    motorGraphicId,
    binaryBuffer,
    mimeType = null,
    sourceLabel = 'graphic_api',
    metadataJson = null,
}) {
    if (!isDbConfigured() || !motorGraphicId || !binaryBuffer || binaryBuffer.length === 0) {
        return { success: false, error: 'Missing config, graphic id, or binary bytes' };
    }
    const sha256 = crypto.createHash('sha256').update(binaryBuffer).digest('hex');
    try {
        let existingQuery;
        if (vehicleExternalId) {
            existingQuery = await dbQuery(
                `SELECT id FROM media_asset WHERE vehicle_external_id = $1 AND motor_graphic_id = $2 AND content_source = $3 LIMIT 1`,
                [vehicleExternalId, motorGraphicId, contentSource || 'MOTOR']
            );
        } else {
            existingQuery = await dbQuery(
                `SELECT id FROM media_asset WHERE motor_graphic_id = $1 AND content_source = $2 LIMIT 1`,
                [motorGraphicId, contentSource || 'MOTOR']
            );
        }
        if (existingQuery.rows.length > 0) return { success: true, skipped: true, id: existingQuery.rows[0].id };

        return insertParsedData('media_asset', [
            {
                vehicle_external_id: vehicleExternalId,
                content_source: contentSource || 'MOTOR',
                motor_graphic_id: motorGraphicId,
                mime_type: mimeType || null,
                sha256,
                source_label: sourceLabel,
                metadata_json: {
                    byte_length: binaryBuffer.length,
                    ...(metadataJson && typeof metadataJson === 'object' ? metadataJson : {}),
                },
            },
        ]);
    } catch (err) {
        return { success: false, error: err.message || String(err) };
    }
}

export async function insertParsedData(table, data, options = {}) {
    if (!isDbConfigured()) {
        logger.warn(`Skipping DB insert into ${table}: DB not configured.`);
        return { success: false, error: 'DB not configured' };
    }

    let rows = Array.isArray(data) ? data : [data];
    if (rows.length === 0) return { success: true, rows: [] };

    if (table === 'articles') {
        rows = articlesRowsForRest(rows);
        rows = dedupeArticlesByConflictKey(rows);
    }
    if (table === 'content_item') rows = dedupeContentItemsByConflictKey(rows);
    if (table === 'maintenance_schedules' || table === 'maintenance_task') {
        rows = dedupeMaintenanceByConflictKey(rows);
    }
    if (rows.length === 0) return { success: true, rows: [] };

    const conflictCols = UPSERT_CONFLICT_COLUMNS[table] || null;
    const returning = Boolean(options.returnRepresentation);

    try {
        const { sql, values } = buildUpsertSql(table, rows, conflictCols, { returning });
        const result = await dbQuery(sql, values);
        logger.info(`✓ Upserted ${rows.length} row(s) into table: ${table}`);
        return returning ? { success: true, rows: result.rows } : { success: true };
    } catch (err) {
        logger.error(`DB error on table ${table}:`, err);
        return { success: false, error: err.message };
    }
}

export async function logAiProcessing(logData) {
    if (!isDbConfigured()) return;
    try {
        await dbQuery(
            `INSERT INTO ai_processing_logs
             (source_file, category, status, error_message, tokens_used, prompt_tokens, completion_tokens, processed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [
                normalizeSourcePathForDedup(logData.source_file) || logData.source_file,
                logData.category ?? null,
                logData.status,
                logData.error_message ?? null,
                logData.tokens_used ?? null,
                logData.prompt_tokens ?? null,
                logData.completion_tokens ?? null,
            ]
        );
    } catch (err) {
        logger.error('Failed to write to ai_processing_logs:', err);
    }
}

export async function insertFailedExtraction(row) {
    if (!isDbConfigured()) return { success: false, error: 'DB not configured' };
    const article_id = row.article_id != null ? String(row.article_id) : '';
    if (!article_id) return { success: false, error: 'article_id required' };
    try {
        await dbQuery(
            `INSERT INTO failed_extractions (article_id, raw_text, error_message, url_path, category)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                article_id,
                row.raw_text != null ? String(row.raw_text).slice(0, 120000) : null,
                String(row.error_message || 'unknown').slice(0, 8000),
                row.url_path != null ? String(row.url_path).slice(0, 4000) : null,
                row.category != null ? String(row.category).slice(0, 128) : null,
            ]
        );
        return { success: true };
    } catch (err) {
        logger.error('insertFailedExtraction error:', err);
        return { success: false, error: err.message };
    }
}

export function normalizeSourcePathForDedup(path) {
    if (!path || typeof path !== 'string') return path;
    return path.replace(/(\/article\/[^/?]+)\/html$/i, '$1');
}

export async function checkParsedArticle(articleId) {
    if (!isDbConfigured()) {
        logger.warn(`Skipping DB check for article ${articleId}: DB not configured.`);
        return null;
    }

    const lookups = [
        { table: 'procedures', col: 'external_id' },
        { table: 'tsbs', col: 'external_id' },
        { table: 'dtcs', col: 'external_id' },
        { table: 'spec_fact', col: 'source_article_id' },
        { table: 'diagram_document', col: 'source_article_id' },
        { table: 'component_location_document', col: 'source_article_id' },
        { table: 'labor_operation', col: 'source_article_id' },
    ];

    const results = await Promise.allSettled(
        lookups.map(async ({ table, col }) => {
            const { rows } = await dbQuery(
                `SELECT * FROM "${table}" WHERE "${col}" = $1 LIMIT 1`,
                [articleId]
            );
            return rows.length > 0 ? { ...rows[0], _table: table } : null;
        })
    );

    for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
            logger.info(`✓ Found cached content for article ${articleId} in table: ${result.value._table}`);
            return result.value;
        }
    }
    return null;
}

export async function wasAlreadyParsed(sourcePath) {
    if (!isDbConfigured()) return false;
    const norm = normalizeSourcePathForDedup(sourcePath);
    const variants = [...new Set([sourcePath, norm].filter(Boolean))];
    try {
        for (const p of variants) {
            const { rows } = await dbQuery(
                `SELECT id FROM ai_processing_logs WHERE source_file = $1 AND status = 'COMPLETED' LIMIT 1`,
                [p]
            );
            if (rows.length > 0) return true;
        }
        return false;
    } catch {
        return false;
    }
}

export function normalizeVehicleMetadataPath(urlPath) {
    if (!urlPath || typeof urlPath !== 'string') return urlPath;
    if (urlPath.startsWith('/api/')) return urlPath.slice(4);
    return urlPath;
}

export async function insertMetadata(path, data) {
    if (!isDbConfigured()) return { success: false };
    path = normalizeVehicleMetadataPath(path);
    try {
        await dbQuery(
            `INSERT INTO vehicle_metadata (path, data, updated_at) VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
            [path, JSON.stringify(data)]
        );
        logger.info(`✓ Persisted vehicle metadata for: ${path}`);
        return { success: true };
    } catch (err) {
        logger.error(`Error persisting metadata for ${path}:`, err);
        return { success: false, error: err.message };
    }
}

export function isMetadataStale(row, maxAgeDays = 90) {
    if (!row?.updated_at) return true;
    const age = Date.now() - new Date(row.updated_at).getTime();
    return age > maxAgeDays * 24 * 60 * 60 * 1000;
}

export async function getMetadata(path) {
    if (!isDbConfigured()) return null;
    const canonical = normalizeVehicleMetadataPath(path);
    const pathsToTry = [canonical];
    if (!canonical.startsWith('/api/')) pathsToTry.push(`/api${canonical}`);

    for (const tryPath of pathsToTry) {
        try {
            const { rows } = await dbQuery(
                `SELECT data, updated_at FROM vehicle_metadata WHERE path = $1`,
                [tryPath]
            );
            if (rows.length > 0) {
                const payload = rows[0].data;
                const updatedAt = rows[0].updated_at != null ? String(rows[0].updated_at) : null;
                if (tryPath !== canonical) {
                    logger.info(`Serving metadata from legacy key ${tryPath} (canonical ${canonical})`);
                    void insertMetadata(canonical, payload).catch(() => {});
                } else {
                    logger.info(`✓ Found cached metadata for: ${canonical}`);
                }
                return { data: payload, updated_at: updatedAt };
            }
        } catch (err) {
            logger.error(`Error retrieving metadata for ${tryPath}:`, err);
        }
    }
    return null;
}

export async function getVehicleArticles(vehicleId) {
    if (!isDbConfigured()) return null;
    try {
        const ids = await resolveAssociatedVehicleIds(vehicleId);
        const { rows } = await dbQuery(
            `SELECT original_id, title, subtitle, code, description, bucket, parent_bucket,
                    thumbnail_href, bulletin_number, release_date, sort, content_source
             FROM articles WHERE vehicle_id = ANY($1)`,
            [ids]
        );
        return rows;
    } catch (err) {
        logger.error(`Error retrieving articles for ${vehicleId}:`, err);
        return null;
    }
}

export async function getVehicleIsNormalized(vehicleId) {
    if (!isDbConfigured()) return null;
    try {
        const ids = await resolveAssociatedVehicleIds(vehicleId);
        const { rows } = await dbQuery(
            `SELECT is_normalized FROM vehicles WHERE external_id = ANY($1)`,
            [ids]
        );
        if (rows.length === 0) return null;
        return rows.some(r => !!r.is_normalized);
    } catch {
        return null;
    }
}

export async function getVehicleArticlesCount(vehicleId) {
    if (!isDbConfigured()) return 0;
    try {
        const ids = await resolveAssociatedVehicleIds(vehicleId);
        const { rows } = await dbQuery(
            `SELECT COUNT(*)::int AS cnt FROM articles WHERE vehicle_id = ANY($1)`,
            [ids]
        );
        return rows[0]?.cnt ?? 0;
    } catch {
        return 0;
    }
}
