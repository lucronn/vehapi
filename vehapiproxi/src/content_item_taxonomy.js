/**
 * Canonical silo/kind from normalized Motor root bucket name (from categorize.js).
 */
export function inferKindAndSilo(rootName) {
    const map = {
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
    return map[rootName] || { kind: 'other', canonical_silo_code: 'other' };
}
