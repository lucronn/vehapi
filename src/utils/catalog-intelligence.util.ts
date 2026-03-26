/**
 * Mirrors vehapiproxi/src/catalog_intelligence.js + content_item_taxonomy.js for `articles` upserts.
 * Keeps list copy and silo inference aligned with worker `content_item` rows.
 */

const SILO_LABELS: Record<string, string> = {
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

/** Same keys as vehapiproxi/src/content_item_taxonomy.js inferKindAndSilo */
const KIND_SILO_BY_ROOT: Record<string, { kind: string; canonical_silo_code: string }> = {
    'Diagnostic Codes (DTC)': { kind: 'dtc', canonical_silo_code: 'dtcs' },
    'Service Bulletins (TSB)': { kind: 'tsb', canonical_silo_code: 'tsbs' },
    'Service Procedures': { kind: 'procedure', canonical_silo_code: 'procedures' },
    'Wiring Diagrams': { kind: 'diagram', canonical_silo_code: 'diagrams' },
    'Component Locations': { kind: 'component_location', canonical_silo_code: 'component-locations' },
    Specifications: { kind: 'spec_article', canonical_silo_code: 'specs' },
    'Fluids & Capacities': { kind: 'spec_article', canonical_silo_code: 'specs' },
    'Parts Catalog': { kind: 'parts_listing', canonical_silo_code: 'parts' },
    'Labor & Estimating': { kind: 'labor', canonical_silo_code: 'labor' }
};

function norm(s: string | null | undefined): string {
    if (s == null) return '';
    return String(s).trim().replace(/\s+/g, ' ');
}

function inferKindAndSiloFromRoot(rootName: string): { kind: string; canonical_silo_code: string } {
    return KIND_SILO_BY_ROOT[rootName] ?? { kind: 'other', canonical_silo_code: 'other' };
}

/** Align with vehapiproxi/src/catalog_intelligence.js inferKindAndSiloFromHeuristics */
function inferKindAndSiloFromHeuristics(
    title: string,
    parentBucket: string | null | undefined,
    bucket: string | null | undefined
): { kind: string; canonical_silo_code: string; confidence: 'high' | 'medium' | 'low' } {
    const t = norm(title).toLowerCase();
    const p = norm(parentBucket).toLowerCase();
    const b = norm(bucket).toLowerCase();
    const hay = `${p} ${b} ${t}`;

    if (/\b(tsb|technical service|service bulletin|recall|campaign)\b/i.test(hay)) {
        return { kind: 'tsb', canonical_silo_code: 'tsbs', confidence: 'high' };
    }
    if (
        /\b(dtc|diagnostic|trouble code|obd|mil)\b/i.test(hay) ||
        /^[pcbu]\d{4,5}\b/i.test(norm(title))
    ) {
        return { kind: 'dtc', canonical_silo_code: 'dtcs', confidence: 'high' };
    }
    if (/\b(wiring|schematic|circuit)\b/i.test(hay) || /\bdiagram\b/i.test(hay)) {
        return { kind: 'diagram', canonical_silo_code: 'diagrams', confidence: 'medium' };
    }
    if (/\b(component location|connector|harness pinout|pin out)\b/i.test(hay)) {
        return {
            kind: 'component_location',
            canonical_silo_code: 'component-locations',
            confidence: 'medium'
        };
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
 * Same resolution order as vehapiproxi/src/catalog_intelligence.js resolveKindAndSilo.
 */
export function resolveKindAndSilo(
    rootName: string,
    title: string,
    parentBucket: string | null | undefined,
    bucket: string | null | undefined
): { kind: string; canonical_silo_code: string } {
    const primary = inferKindAndSiloFromRoot(rootName);
    if (primary.canonical_silo_code !== 'other') {
        return primary;
    }
    const h = inferKindAndSiloFromHeuristics(title, parentBucket, bucket);
    return { kind: h.kind, canonical_silo_code: h.canonical_silo_code };
}

export function buildImprovedArticleDisplay(input: {
    motor_title: string | null | undefined;
    motor_subtitle: string | null | undefined;
    motor_description: string | null | undefined;
    motor_code: string | null | undefined;
    canonical_silo_code: string;
    subName: string | null | undefined;
    rootName: string | null | undefined;
}): { display_title: string; display_subtitle: string; display_description: string } {
    const motorTitle = norm(input.motor_title);
    const motorSub = norm(input.motor_subtitle);
    const motorDesc = norm(input.motor_description);
    const code = norm(input.motor_code);
    const silo = input.canonical_silo_code || 'other';
    const siloLabel = SILO_LABELS[silo] ?? SILO_LABELS.other;
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

    return { display_title, display_subtitle, display_description };
}

/**
 * Map Motor article fields → improved list copy for `articles` table.
 * `rootName` / `subName` come from {@link normalizeCategoryParams} (Angular), matching vehapiproxi categorize.js.
 */
export function improveCatalogArticleRow(input: {
    title: string | null | undefined;
    subtitle: string | null | undefined;
    description: string | null | undefined;
    code: string | null | undefined;
    parentBucket: string;
    bucket: string;
    rootName: string;
    subName: string | null;
}): { title: string | null; subtitle: string | null; description: string | null } {
    const resolved = resolveKindAndSilo(
        input.rootName,
        input.title ?? '',
        input.parentBucket,
        input.bucket
    );

    const d = buildImprovedArticleDisplay({
        motor_title: input.title,
        motor_subtitle: input.subtitle,
        motor_description: input.description,
        motor_code: input.code,
        canonical_silo_code: resolved.canonical_silo_code,
        subName: input.subName,
        rootName: input.rootName
    });

    return {
        title: d.display_title || (input.title ?? null),
        subtitle: d.display_subtitle || (input.subtitle ?? null),
        description: d.display_description || (input.description ?? null)
    };
}
