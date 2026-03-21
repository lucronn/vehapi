/**
 * Maps Motor catalog articles → content_item rows (phase-1 normalization).
 * @see docs/plans/2026-03-18-normalization-schema-design.md
 */
import { normalizeCategoryParams } from './categorize.js';

/** @param {string} rootName From normalizeCategoryParams().rootName */
export function inferKindAndSilo(rootName) {
    const map = {
        'Diagnostic Codes (DTC)': { kind: 'dtc', canonical_silo_code: 'dtcs' },
        'Service Bulletins (TSB)': { kind: 'tsb', canonical_silo_code: 'tsbs' },
        'Service Procedures': { kind: 'procedure', canonical_silo_code: 'procedures' },
        'Wiring Diagrams': { kind: 'diagram', canonical_silo_code: 'diagrams' },
        'Component Locations': { kind: 'component_location', canonical_silo_code: 'component-locations' },
        'Specifications': { kind: 'spec_article', canonical_silo_code: 'specs' },
        'Fluids & Capacities': { kind: 'spec_article', canonical_silo_code: 'specs' },
        'Parts Catalog': { kind: 'parts_listing', canonical_silo_code: 'parts' },
        'Labor & Estimating': { kind: 'labor', canonical_silo_code: 'labor' }
    };
    return map[rootName] || { kind: 'other', canonical_silo_code: 'other' };
}

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
        specifications: { kind: 'spec_article', canonical_silo_code: 'specs' }
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

    return {
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
}
