/**
 * Catalog Intelligence Upgrade — rule-first taxonomy + display copy beyond raw Motor fields.
 * @see docs/plans/2026-03-18-normalization-schema-design.md (Catalog Intelligence Upgrade)
 */
import { inferKindAndSilo } from './content_item_taxonomy.js';

export const CATALOG_INTEL_ENRICHMENT_VERSION = 'catalog-intel-v1';

const SILO_LABELS = {
    dtcs: 'Diagnostic trouble codes',
    tsbs: 'Service bulletins',
    procedures: 'Service procedures',
    diagrams: 'Wiring diagrams',
    'component-locations': 'Component locations',
    specs: 'Specifications',
    parts: 'Parts',
    labor: 'Labor',
    maintenance: 'Maintenance',
    other: 'Service information'
};

/**
 * @param {string | null | undefined} s
 */
function norm(s) {
    if (s == null) return '';
    return String(s).trim().replace(/\s+/g, ' ');
}

/**
 * When normalizeCategoryParams + inferKindAndSilo yields `other`, infer from raw buckets + title.
 * @param {string} title
 * @param {string | null} parentBucket
 * @param {string | null} bucket
 * @returns {{ kind: string, canonical_silo_code: string, confidence: 'high'|'medium'|'low' }}
 */
export function inferKindAndSiloFromHeuristics(title, parentBucket, bucket) {
    const t = norm(title).toLowerCase();
    const p = norm(parentBucket).toLowerCase();
    const b = norm(bucket).toLowerCase();
    const hay = `${p} ${b} ${t}`;

    if (/\b(tsb|technical service|service bulletin|recall|campaign)\b/i.test(hay)) {
        return { kind: 'tsb', canonical_silo_code: 'tsbs', confidence: 'high' };
    }
    if (/\b(dtc|diagnostic|trouble code|obd|mil)\b/i.test(hay) || /^[pcbu]\d{4,5}\b/i.test(norm(title))) {
        return { kind: 'dtc', canonical_silo_code: 'dtcs', confidence: 'high' };
    }
    if (/\b(wiring|schematic|circuit)\b/i.test(hay) || /\bdiagram\b/i.test(hay)) {
        return { kind: 'diagram', canonical_silo_code: 'diagrams', confidence: 'medium' };
    }
    if (/\b(component location|connector|harness pinout|pin out)\b/i.test(hay)) {
        return { kind: 'component_location', canonical_silo_code: 'component-locations', confidence: 'medium' };
    }
    if (/\b(labor|operation time|flat rate)\b/i.test(hay)) {
        return { kind: 'labor', canonical_silo_code: 'labor', confidence: 'medium' };
    }
    if (/\b(part|catalog|oem)\b/i.test(hay) && /\bnumber\b/i.test(hay)) {
        return { kind: 'parts_listing', canonical_silo_code: 'parts', confidence: 'low' };
    }
    if (/\b(spec|torque|capacity|fluid|pressure)\b/i.test(hay)) {
        return { kind: 'spec_article', canonical_silo_code: 'specs', confidence: 'medium' };
    }
    if (/\b(maintenance|interval|schedule|service schedule)\b/i.test(hay)) {
        return { kind: 'procedure', canonical_silo_code: 'procedures', confidence: 'low' };
    }
    if (/\b(procedure|repair|removal|installation|replace)\b/i.test(hay)) {
        return { kind: 'procedure', canonical_silo_code: 'procedures', confidence: 'low' };
    }
    return { kind: 'other', canonical_silo_code: 'other', confidence: 'low' };
}

/**
 * Resolve kind + silo: primary from rootName map, else heuristics.
 * @param {string} rootName
 * @param {string} title
 * @param {string | null} parentBucket
 * @param {string | null} bucket
 */
export function resolveKindAndSilo(rootName, title, parentBucket, bucket) {
    const primary = inferKindAndSilo(rootName);
    if (primary.canonical_silo_code !== 'other') {
        return { ...primary, taxonomy_confidence: 'high', taxonomy_path: 'rootName_map' };
    }
    const h = inferKindAndSiloFromHeuristics(title, parentBucket, bucket);
    return {
        kind: h.kind,
        canonical_silo_code: h.canonical_silo_code,
        taxonomy_confidence: h.confidence,
        taxonomy_path: 'heuristic_fallback'
    };
}

/**
 * Rule-based improved display copy (no LLM). Preserves motor_* separately on the row.
 * @param {object} input
 * @param {string | null} input.motor_title
 * @param {string | null} input.motor_subtitle
 * @param {string | null} input.motor_description
 * @param {string | null} input.motor_code
 * @param {string} input.canonical_silo_code
 * @param {string | null} input.subName
 * @param {string | null} input.rootName
 */
export function buildImprovedDisplayFields(input) {
    const motorTitle = norm(input.motor_title);
    const motorSub = norm(input.motor_subtitle);
    const motorDesc = norm(input.motor_description);
    const code = norm(input.motor_code);
    const silo = input.canonical_silo_code || 'other';
    const siloLabel = SILO_LABELS[silo] || SILO_LABELS.other;
    const sub = norm(input.subName);
    const root = norm(input.rootName);

    let effectiveCode = code;
    if (!effectiveCode && motorTitle) {
        const m = motorTitle.match(/^([PCBU]\d{4,5})\b/i);
        if (m) effectiveCode = m[1].toUpperCase();
    }
    let display_title = motorTitle || effectiveCode || 'Untitled service document';
    if (
        effectiveCode &&
        motorTitle &&
        !motorTitle.toUpperCase().includes(effectiveCode) &&
        silo === 'dtcs'
    ) {
        display_title = `${effectiveCode} — ${motorTitle}`;
    }

    let display_subtitle = motorSub;
    if (!display_subtitle) {
        if (effectiveCode) display_subtitle = effectiveCode;
        else if (sub && sub !== root) display_subtitle = sub;
        else if (root) display_subtitle = root;
        else display_subtitle = siloLabel;
    }

    let display_description = motorDesc;
    if (!display_description || display_description.length < 24) {
        const parts = [siloLabel];
        if (sub && sub !== display_subtitle) parts.push(sub);
        if (motorTitle) parts.push(motorTitle);
        display_description = `${parts.join(' · ')}. Open for full service details.`;
    } else if (display_description.length < 80 && siloLabel) {
        display_description = `${siloLabel}: ${display_description}`;
    }

    const changedTitle = display_title !== motorTitle;
    const changedSub = display_subtitle !== motorSub;
    const changedDesc = display_description !== motorDesc;

    return {
        display_title,
        display_subtitle,
        display_description,
        copy_changed: changedTitle || changedSub || changedDesc
    };
}

/**
 * @param {object} row content_item-shaped object from buildContentItemFromCatalogArticle base
 */
export function applyCatalogIntelligenceToRow(row) {
    const rootName = row.metadata_json?.normalized_parent_bucket || null;
    const subName = row.metadata_json?.normalized_bucket || null;
    const resolved = resolveKindAndSilo(
        typeof rootName === 'string' ? rootName : '',
        row.motor_title || '',
        row.motor_parent_bucket,
        row.motor_bucket
    );

    const copy = buildImprovedDisplayFields({
        motor_title: row.motor_title,
        motor_subtitle: row.motor_subtitle,
        motor_description: row.motor_description,
        motor_code: row.motor_code,
        canonical_silo_code: resolved.canonical_silo_code,
        subName,
        rootName
    });

    const taxonomyChanged =
        resolved.canonical_silo_code !== row.canonical_silo_code || resolved.kind !== row.kind;
    const enrichment_source =
        copy.copy_changed || taxonomyChanged || resolved.taxonomy_path === 'heuristic_fallback'
            ? 'rules_catalog_intel_v1'
            : 'motor_raw';

    return {
        ...row,
        kind: resolved.kind,
        canonical_silo_code: resolved.canonical_silo_code,
        display_title: copy.display_title,
        display_subtitle: copy.display_subtitle,
        display_description: copy.display_description,
        enrichment_source,
        enrichment_version: CATALOG_INTEL_ENRICHMENT_VERSION,
        metadata_json: {
            ...(row.metadata_json && typeof row.metadata_json === 'object' ? row.metadata_json : {}),
            catalog_intel: {
                taxonomy_path: resolved.taxonomy_path,
                taxonomy_confidence: resolved.taxonomy_confidence,
                copy_rule: copy.copy_changed ? 'improved_display_v1' : 'motor_mirror',
                needs_llm_enrichment:
                    !copy.display_title ||
                    !copy.display_subtitle ||
                    !copy.display_description
            }
        }
    };
}
