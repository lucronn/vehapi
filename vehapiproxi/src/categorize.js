export function normalizeCategoryParams(title, parentBucketRaw, bucketRaw) {
    const rootNameMap = {
        'Procedures': 'Service Procedures',
        'Wiring Diagrams': 'Wiring Diagrams',
        'Component Locations': 'Component Locations',
        'Labor': 'Labor & Estimating',
        'Fluids': 'Fluids & Capacities',
        'Specifications': 'Specifications',
        'Parts': 'Parts Catalog',
        'TSBs': 'Service Bulletins (TSB)',
        'DTCs': 'Diagnostic Codes (DTC)'
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
            const lowerTitle = safeTitle.toLowerCase();
            if (lowerTitle.includes('brake') || lowerTitle.includes('abs')) subName = 'Brakes';
            else if (lowerTitle.includes('air conditioning') || lowerTitle.includes('hvac') || lowerTitle.includes('heater') || lowerTitle.includes('refrigerant')) subName = 'HVAC';
            else if (lowerTitle.includes('engine') || lowerTitle.includes('cylinder') || lowerTitle.includes('crankshaft') || lowerTitle.includes('camshaft') || lowerTitle.includes('valve') || lowerTitle.includes('piston') || lowerTitle.includes('block') || lowerTitle.includes('timing')) subName = 'Engine Mechanical';
            else if (lowerTitle.includes('transmission') || lowerTitle.includes('clutch') || lowerTitle.includes('differential') || lowerTitle.includes('axle') || lowerTitle.includes('driveline') || lowerTitle.includes('transfer case')) subName = 'Transmission & Driveline';
            else if (lowerTitle.includes('sensor') || lowerTitle.includes('module') || lowerTitle.includes('ignition') || lowerTitle.includes('spark') || lowerTitle.includes('battery') || lowerTitle.includes('alternator') || lowerTitle.includes('starter') || lowerTitle.includes('wire') || lowerTitle.includes('electrical') || lowerTitle.includes('relay') || lowerTitle.includes('fuse')) subName = 'Electrical & Sensors';
            else if (lowerTitle.includes('fuel') || lowerTitle.includes('intake') || lowerTitle.includes('exhaust') || lowerTitle.includes('emission') || lowerTitle.includes('throttle')) subName = 'Fuel & Emissions';
            else if (lowerTitle.includes('steering') || lowerTitle.includes('suspension') || lowerTitle.includes('wheel') || lowerTitle.includes('tire') || lowerTitle.includes('alignment') || lowerTitle.includes('strut') || lowerTitle.includes('shock')) subName = 'Steering & Suspension';
            else if (lowerTitle.includes('coolant') || lowerTitle.includes('cooling') || lowerTitle.includes('radiator') || lowerTitle.includes('water pump') || lowerTitle.includes('thermostat')) subName = 'Cooling System';
            else if (lowerTitle.includes('fluid') || lowerTitle.includes('oil') || lowerTitle.includes('lubricant') || lowerTitle.includes('capacity')) subName = 'Fluids & Maintenance';
            else if (lowerTitle.includes('body') || lowerTitle.includes('door') || lowerTitle.includes('window') || lowerTitle.includes('mirror') || lowerTitle.includes('seat') || lowerTitle.includes('interior') || lowerTitle.includes('exterior') || lowerTitle.includes('bumper') || lowerTitle.includes('glass') || lowerTitle.includes('panel')) subName = 'Body & Interior';
            else if (lowerTitle.includes('air bag') || lowerTitle.includes('restraint') || lowerTitle.includes('seat belt')) subName = 'Restraints & Safety';
            else subName = 'General';
        }
    }

    return {
        rootName,
        subName: subName || bucket
    };
}
