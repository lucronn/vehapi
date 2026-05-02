const SUB_CATEGORY_RULES = [
    { category: 'Brakes', keywords: ['brake', 'abs'], weight: 2 },
    { category: 'HVAC', keywords: ['air conditioning', 'hvac', 'heater', 'refrigerant'], weight: 2 },
    { category: 'Engine Mechanical', keywords: ['engine', 'cylinder', 'crankshaft', 'camshaft', 'valve', 'piston', 'block', 'timing'], weight: 1 },
    { category: 'Transmission & Driveline', keywords: ['transmission', 'clutch', 'differential', 'axle', 'driveline', 'transfer case'], weight: 1 },
    { category: 'Electrical & Sensors', keywords: ['sensor', 'module', 'ignition', 'spark', 'battery', 'alternator', 'starter', 'wire', 'electrical', 'relay', 'fuse'], weight: 1 },
    { category: 'Fuel & Emissions', keywords: ['fuel', 'intake', 'exhaust', 'emission', 'throttle'], weight: 1 },
    { category: 'Steering & Suspension', keywords: ['steering', 'suspension', 'wheel', 'tire', 'alignment', 'strut', 'shock'], weight: 1 },
    { category: 'Cooling System', keywords: ['coolant', 'cooling', 'radiator', 'water pump', 'thermostat'], weight: 2 },
    { category: 'Fluids & Maintenance', keywords: ['fluid', 'oil', 'lubricant', 'capacity'], weight: 1 },
    { category: 'Body & Interior', keywords: ['body', 'door', 'window', 'mirror', 'seat', 'interior', 'exterior', 'bumper', 'glass', 'panel'], weight: 1 },
    { category: 'Restraints & Safety', keywords: ['air bag', 'restraint', 'seat belt'], weight: 2 },
];

function inferSubCategoryFromTitle(title) {
    const lower = (title || '').toLowerCase();
    if (!lower) return 'General';

    let bestCategory = 'General';
    let bestScore = 0;

    for (const { category, keywords, weight } of SUB_CATEGORY_RULES) {
        let score = 0;
        for (const kw of keywords) {
            if (lower.includes(kw)) score += weight;
        }
        if (score > bestScore) {
            bestScore = score;
            bestCategory = category;
        }
    }

    return bestCategory;
}

export function normalizeCategoryParams(title, parentBucketRaw, bucketRaw) {
    const rootNameMap = {
        Procedures: 'Service Procedures',
        'Repair Procedures': 'Service Procedures',
        'Scheduled Maintenance': 'Service Procedures',
        Maintenance: 'Service Procedures',
        'Wiring Diagrams': 'Wiring Diagrams',
        'Component Locations': 'Component Locations',
        Labor: 'Labor & Estimating',
        'Labor & Time': 'Labor & Estimating',
        Fluids: 'Fluids & Capacities',
        'Fluids and Capacities': 'Fluids & Capacities',
        Specifications: 'Specifications',
        Parts: 'Parts Catalog',
        TSBs: 'Service Bulletins (TSB)',
        'Service Bulletins': 'Service Bulletins (TSB)',
        DTCs: 'Diagnostic Codes (DTC)',
        Diagnostics: 'Diagnostic Codes (DTC)',
        'Diagnostic Codes': 'Diagnostic Codes (DTC)',
        'Trouble Codes': 'Diagnostic Codes (DTC)'
    };

    let parentBucket = parentBucketRaw || 'Other';
    let bucket = bucketRaw || 'Uncategorized';
    
    const isOther = parentBucket === 'Other';
    let rootName = isOther ? bucket : parentBucket;
    rootName = rootNameMap[rootName] || rootName;
    
    let subName = isOther ? null : bucket;

    let safeTitle = title || '';

    if (isOther || subName === rootName || subName === parentBucket || !subName) {
        if (bucket === 'Procedures' && safeTitle.includes(':')) {
            const parts = safeTitle.split(':');
            if (parts.length > 1) {
                subName = parts[0].trim();
            }
        } else if (bucket === 'DTCs' || rootName === 'Diagnostic Codes (DTC)' || parentBucket === 'DTCs') {
            const codeMatch = safeTitle.match(/^([PCBU])\d+/i);
            if (codeMatch) {
                const prefix = codeMatch[1].toUpperCase();
                if (prefix === 'P') subName = 'Powertrain (P-Codes)';
                else if (prefix === 'C') subName = 'Chassis (C-Codes)';
                else if (prefix === 'B') subName = 'Body (B-Codes)';
                else if (prefix === 'U') subName = 'Network (U-Codes)';
            } else {
                subName = 'Other Codes';
            }
        } else {
            subName = inferSubCategoryFromTitle(safeTitle);
        }
    }

    return {
        rootName,
        subName: subName || bucket
    };
}
