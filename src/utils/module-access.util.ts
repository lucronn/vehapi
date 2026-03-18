/**
 * Maps article bucket/parentBucket names to credits module types.
 * Used to enforce access control when opening articles (e.g. from browse-all, direct URL).
 */
const BUCKET_TO_MODULE: Array<{ patterns: string[]; module: string }> = [
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
 * Derives the credits module type from an article's bucket or parentBucket.
 * Returns null if no match (caller should treat as locked).
 */
export function bucketToModuleType(bucket?: string | null, parentBucket?: string | null): string | null {
  const combined = [bucket, parentBucket].filter(Boolean).join(' ').toLowerCase();
  if (!combined) return null;

  for (const { patterns, module } of BUCKET_TO_MODULE) {
    if (patterns.some(p => combined.includes(p))) return module;
  }
  return null;
}
