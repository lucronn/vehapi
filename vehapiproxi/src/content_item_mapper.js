/**
 * Maps Motor catalog articles → content_item rows (phase-1 normalization).
 * @see docs/plans/2026-03-18-normalization-schema-design.md
 */
import { normalizeCategoryParams } from './categorize.js';
import { inferKindAndSilo } from './content_item_taxonomy.js';
import { applyCatalogIntelligenceToRow } from './catalog_intelligence.js';

export { inferKindAndSilo } from './content_item_taxonomy.js';

/**
 * @param {Record<string, unknown>} a Motor articleDetails item
 * @param {string} vehicleIdStr
 * @param {string} contentSource
 */
/**
 * When an article body is parsed without a prior `articles/v2` catalog sync, insert a minimal `content_item`
 * row so enrichment, L2 chunks, and FK semantics stay aligned with `(vehicle, article_id, content_source)`.
 */
export function buildMinimalContentItemFromParse({ vehicleExternalId, motorArticleId, contentSource, targetSchema }) {
    const map = {
        procedures: { kind: 'procedure', canonical_silo_code: 'procedures' },
        dtcs: { kind: 'dtc', canonical_silo_code: 'dtcs' },
        tsbs: { kind: 'tsb', canonical_silo_code: 'tsbs' },
        specifications: { kind: 'spec_article', canonical_silo_code: 'specs' },
        diagram_document: { kind: 'diagram', canonical_silo_code: 'diagrams' },
        component_location_document: { kind: 'component_location', canonical_silo_code: 'component-locations' },
        labor_operation: { kind: 'labor', canonical_silo_code: 'labor' }
    };
    const m = map[targetSchema] || { kind: 'other', canonical_silo_code: 'other' };
    const now = new Date().toISOString();
    return {
        ...m,
        motor_article_id: String(motorArticleId),
        vehicle_external_id: String(vehicleExternalId),
        content_source: contentSource,
        enrichment_source: 'parse_path',
        enrichment_version: 'phase1-v1',
        enriched_at: now,
        updated_at: now,
        search_text: ''
    };
}

export function buildContentItemFromCatalogArticle(a, vehicleIdStr, contentSource) {
    const rawParent = a.parentBucket != null ? String(a.parentBucket) : null;
    const rawBucket = a.bucket != null ? String(a.bucket) : null;
    const title = a.title != null ? String(a.title) : '';
    const { rootName, subName } = normalizeCategoryParams(title, rawParent, rawBucket);
    const { kind, canonical_silo_code } = inferKindAndSilo(rootName);

    const searchBits = [title, a.subtitle, a.description, a.code, rawParent, rawBucket].filter(
        (x) => x != null && String(x).trim() !== ''
    );

    const base = {
        kind,
        motor_article_id: String(a.id),
        vehicle_external_id: vehicleIdStr,
        content_source: (a.contentSource && String(a.contentSource)) || contentSource,
        motor_title: a.title != null ? String(a.title) : null,
        motor_subtitle: a.subtitle != null ? String(a.subtitle) : null,
        motor_description: a.description != null ? String(a.description) : null,
        motor_parent_bucket: rawParent,
        motor_bucket: rawBucket,
        motor_code: a.code != null ? String(a.code) : null,
        motor_sort: typeof a.sort === 'number' ? a.sort : null,
        bulletin_number: a.bulletinNumber != null ? String(a.bulletinNumber) : null,
        release_date: a.releaseDate != null ? String(a.releaseDate) : null,
        thumbnail_href: a.thumbnailHref != null ? String(a.thumbnailHref) : null,
        canonical_silo_code,
        display_title: a.title != null ? String(a.title) : null,
        display_subtitle: a.subtitle != null ? String(a.subtitle) : null,
        display_description: a.description != null ? String(a.description) : null,
        enrichment_source: 'motor_raw',
        enrichment_version: 'phase1-v1',
        enriched_at: new Date().toISOString(),
        search_text: searchBits.join(' ').slice(0, 8000),
        metadata_json: {
            normalized_parent_bucket: rootName,
            normalized_bucket: subName
        },
        updated_at: new Date().toISOString()
    };

    const intel = applyCatalogIntelligenceToRow(base);
    const extraBits = [intel.display_title, intel.display_subtitle, intel.display_description].filter(Boolean);
    intel.search_text = [...searchBits, ...extraBits].join(' ').slice(0, 8000);
    intel.enriched_at = new Date().toISOString();
    return intel;
}

/**
 * Same catalog intelligence as `content_item` for `articles` table rows (list UI reads `articles`).
 */
export function buildArticlesTableRowFromMotorCatalogArticle(a, vehicleIdStr, contentSource) {
    const ci = buildContentItemFromCatalogArticle(a, vehicleIdStr, contentSource);
    const rootName = ci.metadata_json?.normalized_parent_bucket ?? 'Other';
    const bucketVal = ci.metadata_json?.normalized_bucket ?? 'Uncategorized';
    return {
        vehicle_id: vehicleIdStr,
        original_id: a.id,
        title: ci.display_title,
        subtitle: ci.display_subtitle,
        code: a.code ?? null,
        description: ci.display_description,
        bucket: bucketVal,
        parent_bucket: rootName,
        thumbnail_href: a.thumbnailHref ?? null,
        bulletin_number: a.bulletinNumber ?? null,
        release_date: a.releaseDate ?? null,
        sort: typeof a.sort === 'number' ? a.sort : null,
        content_source: a.contentSource || contentSource
    };
}
