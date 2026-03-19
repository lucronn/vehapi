/**
 * Article access control: maps bucket names to module types and verifies unlocks.
 * Single source of truth for locked/unlocked logic.
 */

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

/**
 * Checks if user has access to an article.
 * @param {string[]} vehicleUnlocks - Unlocks for this vehicle (e.g. ['dtcs', 'article:123'])
 * @param {string} articleId
 * @param {string|null} moduleType - From bucketToModuleType(bucket, parentBucket)
 * @returns {{ allowed: boolean, moduleType?: string }}
 */
export function checkArticleAccess(vehicleUnlocks, articleId, moduleType) {
    const articleKey = `article:${articleId}`;
    if (vehicleUnlocks.includes(articleKey) || vehicleUnlocks.includes('full')) {
        return { allowed: true };
    }
    if (!moduleType) {
        return { allowed: false };
    }
    const hasAccess = vehicleUnlocks.includes(moduleType);
    return { allowed: hasAccess, moduleType };
}
