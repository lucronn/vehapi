/**
 * Article access control: maps bucket names to module types and verifies unlocks.
 * Single source of truth for locked/unlocked logic.
 */
import { inferKindAndSiloFromHeuristics } from './catalog_intelligence.js';

/** Bucket/parentBucket patterns → credits module type */
const BUCKET_TO_MODULE = [
    { patterns: ['diagnostic trouble codes', 'dtcs', 'fault codes', 'diagnostic codes', 'p-codes', 'c-codes', 'b-codes', 'u-codes'], module: 'dtcs' },
    { patterns: ['technical service bulletins', 'tsbs', 'bulletin', 'service bulletins'], module: 'tsbs' },
    { patterns: ['procedure', 'labor', 'service procedures', 'engine mechanical', 'transmission', 'electrical', 'brakes', 'hvac', 'cooling', 'fuel', 'suspension', 'steering', 'body', 'restraints', 'maintenance', 'general'], module: 'procedures' },
    { patterns: ['wiring diagrams', 'diagrams', 'system wiring'], module: 'diagrams' },
    { patterns: ['component locations', 'component location diagrams'], module: 'diagrams' },
    { patterns: ['specification', 'specs', 'fluid', 'capacity', 'alignment'], module: 'specs' },
    { patterns: ['maintenance schedule', 'service intervals'], module: 'maintenance' },
    { patterns: ['parts', 'part catalog'], module: 'parts' },
    { patterns: ['common issues', 'common issue'], module: 'common_issues' },
];

/**
 * Maps article bucket/parentBucket to credits module type.
 * @param {string} bucket
 * @param {string} parentBucket
 * @returns {string|null} Module type or null if unmappable
 */
export function bucketToModuleType(bucket, parentBucket) {
    const combined = [bucket, parentBucket].filter(Boolean).join(' ').toLowerCase();
    if (!combined) return null;
    for (const { patterns, module } of BUCKET_TO_MODULE) {
        if (patterns.some(p => combined.includes(p))) return module;
    }
    return null;
}

/** OBD-II style code in `articles.code` (e.g. P0420). */
export function looksLikeObdDtcCode(code) {
    if (code == null || typeof code !== 'string') return false;
    const c = code.trim().replace(/\s+/g, '');
    return /^[PCBU]\d{4}[A-Z0-9]?$/i.test(c);
}

/** Non-empty `articles.bulletin_number` strongly indicates a TSB-style row. */
export function hasMeaningfulBulletinNumber(bulletin_number) {
    if (bulletin_number == null) return false;
    return String(bulletin_number).trim().length >= 2;
}

function siloCanonicalToCreditsModule(canonicalSiloCode) {
    switch (canonicalSiloCode) {
        case 'dtcs':
            return 'dtcs';
        case 'tsbs':
            return 'tsbs';
        case 'specs':
            return 'specs';
        case 'diagrams':
            return 'diagrams';
        case 'component-locations':
            return 'diagrams';
        case 'procedures':
            return 'procedures';
        case 'parts':
            return 'parts';
        default:
            return null;
    }
}

/**
 * Resolves credits module for unlock checks when bucket strings are missing or overly broad.
 * Uses `code` / `bulletin_number`, then bucket patterns, then catalog heuristics (title + buckets).
 * @param {{ bucket?: string|null, parent_bucket?: string|null, title?: string|null, code?: string|null, bulletin_number?: string|null }} meta
 * @returns {string|null}
 */
/**
 * When `articles` has no row (empty catalog) or metadata cannot be resolved, infer the credits
 * module from Motor-style article id prefixes so section unlocks (e.g. dtcs) still match on prod.
 * @param {string} articleId
 * @returns {string|null}
 */
export function inferModuleTypeFromArticleId(articleId) {
    if (articleId == null || typeof articleId !== 'string') return null;
    const id = articleId.trim();
    if (!id) return null;
    const upper = id.toUpperCase();
    if (upper.startsWith('DTC:')) return 'dtcs';
    if (upper.startsWith('TSB:')) return 'tsbs';
    if (upper.startsWith('SPEC:')) return 'specs';
    if (upper.startsWith('L:')) return 'procedures';
    // Fluid / spec bundles (e.g. F:…-SPEC:…)
    if (upper.startsWith('F:') || id.includes('-SPEC:')) return 'specs';
    if (upper.startsWith('PART') || upper.includes('PART:')) return 'parts';
    return null;
}

export function resolveModuleTypeFromCatalogMetadata(meta) {
    if (!meta || typeof meta !== 'object') return null;
    if (looksLikeObdDtcCode(meta.code)) return 'dtcs';
    if (hasMeaningfulBulletinNumber(meta.bulletin_number)) return 'tsbs';

    const fromBucket = bucketToModuleType(meta.bucket, meta.parent_bucket);
    if (fromBucket && fromBucket !== 'procedures') return fromBucket;

    const h = inferKindAndSiloFromHeuristics(
        meta.title || '',
        meta.parent_bucket,
        meta.bucket
    );
    const inferred = siloCanonicalToCreditsModule(h.canonical_silo_code);
    if (!inferred || h.confidence === 'low') return fromBucket || null;
    if (inferred === 'procedures') return fromBucket || null;
    if (fromBucket === 'procedures' || !fromBucket) return inferred;
    return fromBucket || inferred;
}

/**
 * Checks if user has access to an article.
 * @param {string[]} vehicleUnlocks - Unlocks for this vehicle (e.g. ['dtcs', 'article:123'])
 * @param {string} articleId
 * @param {string|null} moduleType - From bucketToModuleType(bucket, parentBucket)
 * @returns {{ allowed: boolean, moduleType?: string }}
 */
export function checkArticleAccess(vehicleUnlocks, articleId, moduleType) {
    const unlocks = Array.isArray(vehicleUnlocks) ? vehicleUnlocks : [];
    const articleKey = `article:${articleId}`;
    if (unlocks.includes(articleKey) || unlocks.includes('full')) {
        return { allowed: true };
    }
    if (!moduleType) {
        return { allowed: false };
    }
    const hasAccess = unlocks.includes(moduleType);
    return { allowed: hasAccess, moduleType };
}
