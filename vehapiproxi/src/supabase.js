import crypto from 'node:crypto';
import logger from './logger.js';

// Use the Supabase REST API directly via fetch - no SDK needed
// This avoids any ESM/CJS module loading issues on Vercel serverless

function getSupabaseConfig() {
    const url = (process.env.SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) return null;
    return { url, key };
}

// Conflict keys for upsert; must match DB unique constraints.
// Procedures: DB has UNIQUE(vehicle_id, external_id) — one row per Motor article id.
const PROCEDURES_CONFLICT_COLUMNS = 'vehicle_id,external_id';
const UPSERT_CONFLICT_COLUMNS = {
    procedures: PROCEDURES_CONFLICT_COLUMNS,
    tsbs: 'vehicle_id,bulletin_number',
    dtcs: 'vehicle_id,code',
    specifications: 'vehicle_id,category,name',
    spec_fact: 'vehicle_id,category,name',
    maintenance_task: 'vehicle_id,interval_value,action,item',
    diagram_document: 'vehicle_id,source_article_id',
    component_location_document: 'vehicle_id,source_article_id',
    labor_operation: 'vehicle_id,source_article_id',
    categories: 'name,type',
    vehicle_metadata: 'path',
    articles: 'vehicle_id,original_id',
    content_item: 'vehicle_external_id,motor_article_id,content_source'
};

/**
 * PostgREST rejects unknown columns (PGRST204). Many projects only have a subset of `articles` columns.
 * Default: minimal keys. Full catalog row (subtitle, description, code, …) when ARTICLES_UPSERT_EXTENDED=true
 * and the DB matches `supabase_schema.sql` public.articles.
 */
function articlesRowsForRest(rows) {
    const extended =
        String(process.env.ARTICLES_UPSERT_EXTENDED || '').toLowerCase() === 'true' ||
        process.env.ARTICLES_UPSERT_EXTENDED === '1';
    const minimal = new Set([
        'vehicle_id',
        'original_id',
        'title',
        'content_source',
        'bucket',
        'parent_bucket'
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
        'source'
    ]);
    const allowed = new Set(minimal);
    if (extended) {
        for (const k of extendedOnly) {
            allowed.add(k);
        }
    }
    return rows.map((row) => {
        const out = {};
        for (const k of Object.keys(row)) {
            if (allowed.has(k)) {
                out[k] = row[k];
            }
        }
        return out;
    });
}

/**
 * Ensures a vehicle record exists in the vehicles table.
 * Must be called before inserting into any table that references vehicles(external_id).
 * @param {string} vehicleId The Motor API vehicle ID (external_id)
 * @param {string} contentSource e.g. 'MOTOR'
 * @returns {{ success: boolean }}
 */
export async function ensureVehicleExists(vehicleId, contentSource = 'MOTOR') {
    const cfg = getSupabaseConfig();
    if (!cfg || !vehicleId) return { success: false };

    try {
        const url = `${cfg.url}/rest/v1/vehicles?on_conflict=external_id`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
                'Prefer': 'return=minimal,resolution=merge-duplicates'
            },
            body: JSON.stringify({
                external_id: vehicleId,
                content_source: contentSource,
                updated_at: new Date().toISOString()
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Failed to ensure vehicle ${vehicleId}: ${errorText}`);
            return { success: false, error: errorText };
        }
        return { success: true };
    } catch (err) {
        logger.error(`Error ensuring vehicle ${vehicleId}:`, err);
        return { success: false, error: err.message };
    }
}

/**
 * Marks a vehicle as normalized after its article catalog has been fully ingested.
 * @param {string} vehicleId The Motor API vehicle ID (external_id)
 */
export async function markVehicleNormalized(vehicleId) {
    const cfg = getSupabaseConfig();
    if (!cfg || !vehicleId) return { success: false };

    try {
        const url = `${cfg.url}/rest/v1/vehicles?external_id=eq.${encodeURIComponent(vehicleId)}`;
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                is_normalized: true,
                updated_at: new Date().toISOString()
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Failed to mark vehicle ${vehicleId} as normalized: ${errorText}`);
            return { success: false, error: errorText };
        }
        logger.info(`✓ Vehicle ${vehicleId} marked as normalized`);
        return { success: true };
    } catch (err) {
        logger.error(`Error marking vehicle ${vehicleId} as normalized:`, err);
        return { success: false, error: err.message };
    }
}

/**
 * Checks for cached article content in the articles table by original_id.
 * Complements checkParsedArticle which checks normalized content tables.
 * @param {string} vehicleId
 * @param {string} articleId The Motor API article ID (original_id)
 * @returns {Object|null} The cached article row or null
 */
export async function checkArticleContent(vehicleId, articleId) {
    const cfg = getSupabaseConfig();
    if (!cfg) return null;

    try {
        const url = `${cfg.url}/rest/v1/articles?vehicle_id=eq.${encodeURIComponent(vehicleId)}&original_id=eq.${encodeURIComponent(articleId)}&select=*&limit=1`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
            },
        });

        if (!response.ok) return null;
        const data = await response.json();
        if (data && data.length > 0 && data[0].original_content) {
            return data[0];
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Gets article metadata (bucket, parent_bucket) for access control.
 * Used by article access middleware to map bucket → module type and verify unlocks.
 * @param {string} vehicleId
 * @param {string} articleId The Motor API article ID (original_id)
 * @returns {{ bucket: string, parent_bucket: string } | null}
 */
export async function getArticleMetadata(vehicleId, articleId) {
    const cfg = getSupabaseConfig();
    if (!cfg) return null;

    try {
        const url = `${cfg.url}/rest/v1/articles?vehicle_id=eq.${encodeURIComponent(vehicleId)}&original_id=eq.${encodeURIComponent(articleId)}&select=bucket,parent_bucket&limit=1`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
            },
        });

        if (!response.ok) return null;
        const data = await response.json();
        if (data && data.length > 0) {
            return { bucket: data[0].bucket, parent_bucket: data[0].parent_bucket };
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Get the normalized catalog/article row used to seed follow-on normalization documents.
 * @param {string} vehicleId
 * @param {string} articleId
 */
export async function getArticleCatalogEntry(vehicleId, articleId) {
    const cfg = getSupabaseConfig();
    if (!cfg) return null;

    try {
        const url =
            `${cfg.url}/rest/v1/articles` +
            `?vehicle_id=eq.${encodeURIComponent(vehicleId)}` +
            `&original_id=eq.${encodeURIComponent(articleId)}` +
            '&select=title,subtitle,description,thumbnail_href,bucket,parent_bucket,content_source&limit=1';
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                apikey: cfg.key,
                Authorization: `Bearer ${cfg.key}`
            }
        });

        if (!response.ok) return null;
        const data = await response.json();
        return Array.isArray(data) && data.length > 0 ? data[0] : null;
    } catch {
        return null;
    }
}

/**
 * Persists normalized data to the specified Supabase table via REST API.
 * Uses UPSERT (merge-duplicates) so re-processed data overwrites stale rows
 * instead of creating duplicates.
 * @param {string} table The target table name (e.g., 'dtcs', 'tsbs', 'procedures')
 * @param {Object|Array} data The parsed data matching the table schema
 */
/**
 * Append-only L0 evidence row (catalog snapshots, API captures).
 * @param {object} row evidence_ingest columns
 */
export async function insertEvidenceIngest(row) {
    const cfg = getSupabaseConfig();
    if (!cfg) {
        return { success: false, error: 'Supabase credentials not configured' };
    }
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
            source_label: row.source_label ?? null
        };
        const response = await fetch(`${cfg.url}/rest/v1/evidence_ingest`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: cfg.key,
                Authorization: `Bearer ${cfg.key}`,
                Prefer: 'return=representation'
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`evidence_ingest insert failed [${response.status}]: ${errorText}`);
            return { success: false, error: errorText };
        }
        const rows = await response.json().catch(() => []);
        return { success: true, id: Array.isArray(rows) && rows[0] ? rows[0].id : null };
    } catch (err) {
        logger.error('insertEvidenceIngest error:', err);
        return { success: false, error: err.message };
    }
}

export async function findEntityIdsByExternalId(table, vehicleId, externalId) {
    const cfg = getSupabaseConfig();
    if (!cfg || !table || !vehicleId || !externalId) return [];
    try {
        const url =
            `${cfg.url}/rest/v1/${table}` +
            `?vehicle_id=eq.${encodeURIComponent(vehicleId)}` +
            `&external_id=eq.${encodeURIComponent(externalId)}` +
            '&select=id';
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                apikey: cfg.key,
                Authorization: `Bearer ${cfg.key}`
            }
        });
        if (!response.ok) {
            return [];
        }
        const rows = await response.json();
        return Array.isArray(rows) ? rows.map((r) => r.id).filter(Boolean) : [];
    } catch {
        return [];
    }
}

/**
 * Removes L1 procedure_step rows for one Motor article (before re-inserting fresh steps).
 */
export async function deleteProcedureStepsForArticle(vehicleId, sourceArticleId) {
    const cfg = getSupabaseConfig();
    if (!cfg || !vehicleId || !sourceArticleId) {
        return { success: false, error: 'Missing vehicle_id or source_article_id' };
    }
    try {
        const url =
            `${cfg.url}/rest/v1/procedure_step` +
            `?vehicle_id=eq.${encodeURIComponent(vehicleId)}` +
            `&source_article_id=eq.${encodeURIComponent(sourceArticleId)}`;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                apikey: cfg.key,
                Authorization: `Bearer ${cfg.key}`,
                Prefer: 'return=minimal'
            }
        });
        if (!response.ok) {
            const errorText = await response.text();
            return { success: false, error: errorText };
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function deleteProcedureToolsForArticle(vehicleId, sourceArticleId) {
    const cfg = getSupabaseConfig();
    if (!cfg || !vehicleId || !sourceArticleId) {
        return { success: false, error: 'Missing vehicle_id or source_article_id' };
    }
    try {
        const url =
            `${cfg.url}/rest/v1/procedure_tool` +
            `?vehicle_id=eq.${encodeURIComponent(vehicleId)}` +
            `&source_article_id=eq.${encodeURIComponent(sourceArticleId)}`;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                apikey: cfg.key,
                Authorization: `Bearer ${cfg.key}`,
                Prefer: 'return=minimal'
            }
        });
        if (!response.ok) {
            const errorText = await response.text();
            return { success: false, error: errorText };
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function deleteProcedurePartsForArticle(vehicleId, sourceArticleId) {
    const cfg = getSupabaseConfig();
    if (!cfg || !vehicleId || !sourceArticleId) {
        return { success: false, error: 'Missing vehicle_id or source_article_id' };
    }
    try {
        const url =
            `${cfg.url}/rest/v1/procedure_part` +
            `?vehicle_id=eq.${encodeURIComponent(vehicleId)}` +
            `&source_article_id=eq.${encodeURIComponent(sourceArticleId)}`;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                apikey: cfg.key,
                Authorization: `Bearer ${cfg.key}`,
                Prefer: 'return=minimal'
            }
        });
        if (!response.ok) {
            const errorText = await response.text();
            return { success: false, error: errorText };
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function insertEvidenceLinks(evidenceId, entityType, entityIds, extractorVersion = 'phase1-v1') {
    const cfg = getSupabaseConfig();
    if (!cfg || !evidenceId || !entityType || !Array.isArray(entityIds) || entityIds.length === 0) {
        return { success: false, error: 'Missing link args' };
    }
    try {
        const payload = entityIds.map((id) => ({
            evidence_id: evidenceId,
            entity_type: entityType,
            entity_id: id,
            extractor_version: extractorVersion
        }));
        const response = await fetch(`${cfg.url}/rest/v1/evidence_link`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: cfg.key,
                Authorization: `Bearer ${cfg.key}`,
                Prefer: 'return=minimal'
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorText = await response.text();
            return { success: false, error: errorText };
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Updates catalog enrichment fields on content_item for one vehicle/article/source row.
 */
export async function updateContentItemEnrichment(vehicleExternalId, motorArticleId, contentSource, patch) {
    const cfg = getSupabaseConfig();
    if (!cfg) {
        return { success: false, error: 'Supabase credentials not configured' };
    }
    if (!vehicleExternalId || !motorArticleId || !contentSource) {
        return { success: false, error: 'Missing content_item key fields' };
    }
    try {
        const queryBase =
            `${cfg.url}/rest/v1/content_item` +
            `?vehicle_external_id=eq.${encodeURIComponent(vehicleExternalId)}` +
            `&motor_article_id=eq.${encodeURIComponent(motorArticleId)}`;
        const requestBody = JSON.stringify({
            ...patch,
            updated_at: new Date().toISOString()
        });
        const tryPatch = async (sourceFilter) => {
            const response = await fetch(`${queryBase}&${sourceFilter}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: cfg.key,
                    Authorization: `Bearer ${cfg.key}`,
                    Prefer: 'return=representation'
                },
                body: requestBody
            });
            const rows = response.ok ? await response.json().catch(() => []) : null;
            return { response, rows };
        };

        let { response, rows } = await tryPatch(`content_source=eq.${encodeURIComponent(contentSource)}`);
        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`content_item enrichment update failed [${response.status}]: ${errorText}`);
            return { success: false, error: errorText };
        }
        if (!Array.isArray(rows) || rows.length === 0) {
            ({ response, rows } = await tryPatch(`content_source=ilike.${encodeURIComponent(contentSource)}`));
            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`content_item enrichment fallback update failed [${response.status}]: ${errorText}`);
                return { success: false, error: errorText };
            }
        }
        return { success: true };
    } catch (err) {
        logger.error('updateContentItemEnrichment error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * @returns {Promise<string | null>} content_item.id UUID or null
 */
export async function fetchContentItemId(vehicleExternalId, motorArticleId, contentSource) {
    const cfg = getSupabaseConfig();
    if (!cfg || !vehicleExternalId || !motorArticleId || !contentSource) {
        return null;
    }
    try {
        const queryBase =
            `${cfg.url}/rest/v1/content_item` +
            `?select=id` +
            `&vehicle_external_id=eq.${encodeURIComponent(vehicleExternalId)}` +
            `&motor_article_id=eq.${encodeURIComponent(motorArticleId)}` +
            `&limit=1`;
        const tryFetch = async (sourceFilter) => {
            const response = await fetch(`${queryBase}&${sourceFilter}`, {
                headers: {
                    apikey: cfg.key,
                    Authorization: `Bearer ${cfg.key}`,
                    Accept: 'application/json'
                }
            });
            if (!response.ok) {
                return null;
            }
            const rows = await response.json();
            const id = rows?.[0]?.id;
            return typeof id === 'string' ? id : null;
        };
        return (
            (await tryFetch(`content_source=eq.${encodeURIComponent(contentSource)}`)) ||
            (await tryFetch(`content_source=ilike.${encodeURIComponent(contentSource)}`))
        );
    } catch {
        return null;
    }
}

/**
 * Delete all L2 chunks for a catalog item (before replace).
 */
export async function deleteContentChunksForContentItem(contentItemId) {
    const cfg = getSupabaseConfig();
    if (!cfg || !contentItemId) {
        return { success: false, error: 'Missing config or content_item id' };
    }
    try {
        const url =
            `${cfg.url}/rest/v1/content_chunk` +
            `?content_item_id=eq.${encodeURIComponent(contentItemId)}`;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                apikey: cfg.key,
                Authorization: `Bearer ${cfg.key}`,
                Prefer: 'return=minimal'
            }
        });
        if (!response.ok) {
            const errorText = await response.text();
            return { success: false, error: errorText };
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Replace L2 chunks for one `content_item` (delete then insert).
 * @param {string} contentItemId
 * @param {Array<{ chunk_index: number, text_content: string, embedding: number[] }>} rows
 */
export async function replaceContentChunksForContentItem(contentItemId, rows) {
    const del = await deleteContentChunksForContentItem(contentItemId);
    if (!del.success) {
        return del;
    }
    if (!rows || rows.length === 0) {
        return { success: true };
    }
    const payload = rows.map((r) => ({
        content_item_id: contentItemId,
        chunk_index: r.chunk_index,
        text_content: r.text_content,
        embedding: r.embedding
    }));
    return insertParsedData('content_chunk', payload);
}

/**
 * Vector similarity search over L2 chunks for one vehicle (RPC `match_content_chunks`).
 * @param {{ queryEmbedding: number[], vehicleExternalId: string, matchCount: number }} args
 */
export async function matchContentChunksRpc({ queryEmbedding, vehicleExternalId, matchCount }) {
    const cfg = getSupabaseConfig();
    if (!cfg) {
        return { success: false, error: 'Supabase not configured' };
    }
    try {
        const response = await fetch(`${cfg.url}/rest/v1/rpc/match_content_chunks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: cfg.key,
                Authorization: `Bearer ${cfg.key}`,
                Prefer: 'return=representation'
            },
            body: JSON.stringify({
                query_embedding: queryEmbedding,
                vehicle_external_id_filter: vehicleExternalId,
                match_count: matchCount
            })
        });
        if (!response.ok) {
            const t = await response.text();
            return { success: false, error: t || `RPC ${response.status}` };
        }
        const rows = await response.json();
        const chunks = (Array.isArray(rows) ? rows : []).map((r) => ({
            chunkId: r.chunk_id,
            contentItemId: r.content_item_id,
            motorArticleId: r.motor_article_id,
            canonicalSiloCode: r.canonical_silo_code,
            contentSource: r.content_source,
            chunkIndex: r.chunk_index,
            text: r.text_content,
            score: r.similarity
        }));
        return { success: true, chunks };
    } catch (err) {
        return { success: false, error: err.message || String(err) };
    }
}

/**
 * Record PDF bytes from Motor article JSON (`body.pdf`) in `media_asset` for traceability / future diagram work.
 * Idempotent per (vehicle_external_id, motor_graphic_id) where graphic id is `pdf:{motorArticleId}`.
 *
 * @param {{ vehicleExternalId: string, contentSource: string, motorArticleId: string, pdfBuffer: Buffer }} args
 */
export async function upsertMediaAssetPdfFromArticleBody({
    vehicleExternalId,
    contentSource,
    motorArticleId,
    pdfBuffer
}) {
    const cfg = getSupabaseConfig();
    if (!cfg || !vehicleExternalId || !motorArticleId || !pdfBuffer || pdfBuffer.length === 0) {
        return { success: false, error: 'Missing config or PDF bytes' };
    }
    const sha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
    const motorGraphicId = `pdf:${motorArticleId}`;
    try {
        const q =
            `${cfg.url}/rest/v1/media_asset?vehicle_external_id=eq.${encodeURIComponent(vehicleExternalId)}` +
            `&motor_graphic_id=eq.${encodeURIComponent(motorGraphicId)}&select=id&limit=1`;
        const check = await fetch(q, {
            headers: {
                apikey: cfg.key,
                Authorization: `Bearer ${cfg.key}`,
                Accept: 'application/json'
            }
        });
        if (check.ok) {
            const rows = await check.json();
            if (Array.isArray(rows) && rows.length > 0) {
                return { success: true, skipped: true, id: rows[0].id };
            }
        }
        return insertParsedData('media_asset', [
            {
                vehicle_external_id: vehicleExternalId,
                content_source: contentSource || 'MOTOR',
                motor_graphic_id: motorGraphicId,
                mime_type: 'application/pdf',
                sha256,
                source_label: 'article_body_pdf',
                metadata_json: {
                    byte_length: pdfBuffer.length,
                    ingested_by: 'background_worker'
                }
            }
        ]);
    } catch (err) {
        return { success: false, error: err.message || String(err) };
    }
}

/**
 * Record binary graphic bytes from `/api/source/:contentSource/graphic/:id`.
 * Idempotent per (vehicle_external_id, motor_graphic_id) when vehicle is known, otherwise per graphic id + source.
 *
 * @param {{
 *   vehicleExternalId?: string | null,
 *   contentSource: string,
 *   motorGraphicId: string,
 *   binaryBuffer: Buffer,
 *   mimeType?: string | null,
 *   sourceLabel?: string | null,
 *   metadataJson?: Record<string, unknown> | null
 * }} args
 */
export async function upsertMediaAssetGraphicBinary({
    vehicleExternalId = null,
    contentSource,
    motorGraphicId,
    binaryBuffer,
    mimeType = null,
    sourceLabel = 'graphic_api',
    metadataJson = null
}) {
    const cfg = getSupabaseConfig();
    if (!cfg || !motorGraphicId || !binaryBuffer || binaryBuffer.length === 0) {
        return { success: false, error: 'Missing config, graphic id, or binary bytes' };
    }

    const sha256 = crypto.createHash('sha256').update(binaryBuffer).digest('hex');
    const conditions = [
        `motor_graphic_id=eq.${encodeURIComponent(motorGraphicId)}`,
        `content_source=eq.${encodeURIComponent(contentSource || 'MOTOR')}`,
        'select=id',
        'limit=1'
    ];
    if (vehicleExternalId) {
        conditions.unshift(`vehicle_external_id=eq.${encodeURIComponent(vehicleExternalId)}`);
    }

    try {
        const check = await fetch(`${cfg.url}/rest/v1/media_asset?${conditions.join('&')}`, {
            headers: {
                apikey: cfg.key,
                Authorization: `Bearer ${cfg.key}`,
                Accept: 'application/json'
            }
        });
        if (check.ok) {
            const rows = await check.json();
            if (Array.isArray(rows) && rows.length > 0) {
                return { success: true, skipped: true, id: rows[0].id };
            }
        }

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
                    ...(metadataJson && typeof metadataJson === 'object' ? metadataJson : {})
                }
            }
        ]);
    } catch (err) {
        return { success: false, error: err.message || String(err) };
    }
}

/**
 * @param {string} table
 * @param {Object|Array} data
 * @param {{ returnRepresentation?: boolean }} [options] If true and upsert, returns merged rows (ids for evidence_link).
 */
export async function insertParsedData(table, data, options = {}) {
    const cfg = getSupabaseConfig();
    if (!cfg) {
        logger.warn(`Skipping Supabase insert into ${table}: credentials not set.`);
        return { success: false, error: 'Supabase credentials not configured' };
    }

    let rows = Array.isArray(data) ? data : [data];
    if (rows.length === 0) {
        return { success: true, rows: [] };
    }

    if (table === 'articles') {
        rows = articlesRowsForRest(rows);
    }

    const onConflict = UPSERT_CONFLICT_COLUMNS[table];
    const returnRepresentation = Boolean(options.returnRepresentation);
    const prefer = onConflict
        ? returnRepresentation
            ? 'return=representation,resolution=merge-duplicates'
            : 'return=minimal,resolution=merge-duplicates'
        : returnRepresentation
            ? 'return=representation'
            : 'return=minimal';

    try {
        let url = `${cfg.url}/rest/v1/${table}`;
        if (onConflict) {
            url += `?on_conflict=${onConflict}`;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
                'Prefer': prefer
            },
            body: JSON.stringify(rows)
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Supabase REST error on table ${table} [${response.status}]: ${errorText}`);
            return { success: false, error: errorText };
        }

        logger.info(`✓ Upserted ${rows.length} row(s) into Supabase table: ${table}`);
        if (returnRepresentation) {
            const body = await response.json().catch(() => []);
            const out = Array.isArray(body) ? body : body ? [body] : [];
            return { success: true, rows: out };
        }
        return { success: true };
    } catch (err) {
        logger.error(`Unexpected error inserting into ${table}:`, err);
        return { success: false, error: err.message };
    }
}

/**
 * Logs the AI processing task to monitor accuracy and failures.
 * Table ai_processing_logs has: source_file, category, status, error_message, tokens_used,
 * optional prompt_tokens / completion_tokens (migration 20260325), processed_at (no vehicle_id).
 * Worker sends source_file, category, status, error_message, tokens_used; we add processed_at here.
 */
export async function logAiProcessing(logData) {
    const cfg = getSupabaseConfig();
    if (!cfg) return;

    try {
        const base = {
            source_file: normalizeSourcePathForDedup(logData.source_file) || logData.source_file,
            category: logData.category ?? null,
            status: logData.status,
            error_message: logData.error_message ?? null,
            tokens_used: logData.tokens_used ?? null,
            processed_at: new Date().toISOString()
        };
        const withTokens = {
            ...base,
            prompt_tokens: logData.prompt_tokens ?? null,
            completion_tokens: logData.completion_tokens ?? null
        };

        let response = await fetch(`${cfg.url}/rest/v1/ai_processing_logs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(withTokens)
        });

        if (!response.ok) {
            const errorText = await response.text();
            const missingTokenCols = /prompt_tokens|completion_tokens|PGRST204/i.test(errorText);
            if (missingTokenCols) {
                response = await fetch(`${cfg.url}/rest/v1/ai_processing_logs`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': cfg.key,
                        'Authorization': `Bearer ${cfg.key}`,
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify(base)
                });
            }
            if (!response.ok) {
                const err2 = missingTokenCols ? await response.text() : errorText;
                logger.error(`Failed to write to ai_processing_logs [${response.status}]: ${err2}`);
            }
        }
    } catch (err) {
        logger.error(`Failed to write to ai_processing_logs:`, err);
    }
}

/**
 * Dead letter queue when procedure JSON fails Zod validation after self-correction retries.
 * Table: failed_extractions (run migration 20260325_failed_extractions_and_ai_log_tokens.sql).
 */
export async function insertFailedExtraction(row) {
    const cfg = getSupabaseConfig();
    if (!cfg) {
        return { success: false, error: 'Supabase not configured' };
    }
    const article_id = row.article_id != null ? String(row.article_id) : '';
    if (!article_id) {
        return { success: false, error: 'article_id required' };
    }
    try {
        const payload = {
            article_id,
            raw_text: row.raw_text != null ? String(row.raw_text).slice(0, 120000) : null,
            error_message: String(row.error_message || 'unknown').slice(0, 8000),
            url_path: row.url_path != null ? String(row.url_path).slice(0, 4000) : null,
            category: row.category != null ? String(row.category).slice(0, 128) : null
        };
        const response = await fetch(`${cfg.url}/rest/v1/failed_extractions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: cfg.key,
                Authorization: `Bearer ${cfg.key}`,
                Prefer: 'return=minimal'
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`failed_extractions insert [${response.status}]: ${errorText}`);
            return { success: false, error: errorText };
        }
        return { success: true };
    } catch (err) {
        logger.error('insertFailedExtraction error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Single-article URL paths may be /article/:id or /article/:id/html — use one canonical form for ai_processing_logs.
 */
export function normalizeSourcePathForDedup(path) {
    if (!path || typeof path !== 'string') return path;
    return path.replace(/(\/article\/[^/?]+)\/html$/i, '$1');
}

/**
 * Checks for a cached article in normalized content tables by Motor article id.
 * Note: `specifications` has no external_id (natural key is vehicle+category+name); use `spec_fact.source_article_id`.
 */
export async function checkParsedArticle(articleId) {
    const cfg = getSupabaseConfig();
    if (!cfg) {
        logger.warn(`Skipping Supabase check for article ${articleId}: credentials not set.`);
        return null;
    }

    const idEq = encodeURIComponent(articleId);
    const lookups = [
        { table: 'procedures', filter: `external_id=eq.${idEq}` },
        { table: 'tsbs', filter: `external_id=eq.${idEq}` },
        { table: 'dtcs', filter: `external_id=eq.${idEq}` },
        { table: 'spec_fact', filter: `source_article_id=eq.${idEq}` },
        { table: 'diagram_document', filter: `source_article_id=eq.${idEq}` },
        { table: 'component_location_document', filter: `source_article_id=eq.${idEq}` },
        { table: 'labor_operation', filter: `source_article_id=eq.${idEq}` }
    ];

    for (const { table, filter } of lookups) {
        try {
            const url = `${cfg.url}/rest/v1/${table}?${filter}&select=*&limit=1`;
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
                logger.error(`Supabase REST error checking article ${articleId} in ${table} [${response.status}]: ${errorText}`);
                continue;
            }

            const data = await response.json();
            if (data && data.length > 0) {
                logger.info(`✓ Found cached content for article ${articleId} in table: ${table}`);
                return { ...data[0], _table: table };
            }
        } catch (err) {
            logger.error(`Unexpected error checking Supabase table ${table} for article ${articleId}:`, err);
        }
    }

    return null;
}

/**
 * Checks whether a given source path was already successfully parsed.
 * Used by the background worker to skip redundant (and rate-limited) AI calls.
 * @param {string} sourcePath The proxy request URL path
 * @returns {boolean}
 */
export async function wasAlreadyParsed(sourcePath) {
    const cfg = getSupabaseConfig();
    if (!cfg) return false;

    const norm = normalizeSourcePathForDedup(sourcePath);
    const variants = [...new Set([sourcePath, norm].filter(Boolean))];

    try {
        for (const p of variants) {
            const encoded = encodeURIComponent(p);
            const url = `${cfg.url}/rest/v1/ai_processing_logs?source_file=eq.${encoded}&status=eq.COMPLETED&select=id&limit=1`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'apikey': cfg.key,
                    'Authorization': `Bearer ${cfg.key}`,
                },
            });
            if (!response.ok) continue;
            const rows = await response.json();
            if (rows && rows.length > 0) return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Align metadata keys with `metadataCacheMiddleware` (mounted at `/api`, so lookup path is `/years`, not `/api/years`).
 * @param {string} urlPath
 * @returns {string}
 */
export function normalizeVehicleMetadataPath(urlPath) {
    if (!urlPath || typeof urlPath !== 'string') return urlPath;
    if (urlPath.startsWith('/api/')) return urlPath.slice(4);
    return urlPath;
}

/**
 * Upserts vehicle metadata into the vehicle_metadata table.
 * @param {string} path The request path (e.g., /years or /api/years — normalized to /years)
 * @param {Object} data The response JSON
 */
export async function insertMetadata(path, data) {
    const cfg = getSupabaseConfig();
    if (!cfg) return { success: false };

    path = normalizeVehicleMetadataPath(path);

    try {
        const url = `${cfg.url}/rest/v1/vehicle_metadata?on_conflict=path`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
                'Prefer': 'return=minimal,resolution=merge-duplicates'
            },
            body: JSON.stringify({
                path,
                data,
                updated_at: new Date().toISOString()
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Failed to upsert metadata for ${path}: ${errorText}`);
            return { success: false, error: errorText };
        }

        logger.info(`✓ Persisted vehicle metadata for: ${path}`);
        return { success: true };
    } catch (err) {
        logger.error(`Error persisting metadata for ${path}:`, err);
        return { success: false, error: err.message };
    }
}

/**
 * Retrieves vehicle metadata from the vehicle_metadata table.
 * @param {string} path The request path (e.g., /api/years)
 * @returns {Object|null} The cached metadata or null if not found
 */
export async function getMetadata(path) {
    const cfg = getSupabaseConfig();
    if (!cfg) return null;

    path = normalizeVehicleMetadataPath(path);

    try {
        const url = `${cfg.url}/rest/v1/vehicle_metadata?path=eq.${encodeURIComponent(path)}&select=data`;
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
            logger.error(`Supabase REST error getting metadata for ${path} [${response.status}]: ${errorText}`);
            return null;
        }

        const data = await response.json();
        if (data && data.length > 0) {
            logger.info(`✓ Found cached metadata for: ${path}`);
            return data[0].data;
        }
        return null;
    } catch (err) {
        logger.error(`Error retrieving metadata for ${path}:`, err);
        return null;
    }
}
/**
 * Retrieves all cached articles for a specific vehicle from the articles table.
 * @param {string} vehicleId The vehicle ID
 * @returns {Array|null} Array of articles or null if error
 */
export async function getVehicleArticles(vehicleId) {
    const cfg = getSupabaseConfig();
    if (!cfg) return null;

    try {
        const url = `${cfg.url}/rest/v1/articles?vehicle_id=eq.${encodeURIComponent(vehicleId)}&select=*`;
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
            logger.error(`Supabase REST error getting articles for ${vehicleId} [${response.status}]: ${errorText}`);
            return null;
        }

        const articles = await response.json();
        // Recalculate original IDs to match Motor API titles/subtitles if needed
        // but the table should already have these mapped.
        return articles;
    } catch (err) {
        logger.error(`Error retrieving articles for ${vehicleId}:`, err);
        return null;
    }
}

/**
 * Gets a quick count of articles for a vehicle to determine if we should hit the cache.
 * @param {string} vehicleId 
 * @returns {number}
 */
export async function getVehicleArticlesCount(vehicleId) {
    const cfg = getSupabaseConfig();
    if (!cfg) return 0;

    try {
        const url = `${cfg.url}/rest/v1/articles?vehicle_id=eq.${encodeURIComponent(vehicleId)}&select=count&limit=1`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'apikey': cfg.key,
                'Authorization': `Bearer ${cfg.key}`,
                'Prefer': 'count=exact'
            },
        });

        if (!response.ok) return 0;
        
        // Supabase returns count in Content-Range header if using exact
        const contentRange = response.headers.get('content-range');
        if (contentRange) {
            const count = parseInt(contentRange.split('/')[1], 10);
            return isNaN(count) ? 0 : count;
        }
        return 0;
    } catch {
        return 0;
    }
}
