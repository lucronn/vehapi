export function normalizeCategoryParams(title: string, parentBucket: string, bucket: string): { rootName: string, subName: string | null } {
    const isOther = parentBucket === 'Other';
    let rootName = isOther ? bucket : parentBucket;
    let subName: string | null = isOther ? null : bucket;

    let safeTitle = title || '';

    if (isOther || subName === rootName || subName === parentBucket || !subName) {
        if (bucket === 'Procedures' && safeTitle.includes(':')) {
            const parts = safeTitle.split(':');
            if (parts.length > 1) {
                subName = parts[0].trim();
            }
        } else if (bucket === 'DTCs' || bucket === 'Diagnostic Trouble Codes' || rootName.includes('Diagnostic') || parentBucket.includes('DTC')) {
            const codeMatch = safeTitle.match(/^([PCBU])\d+/i);
            if (codeMatch) {
                const prefix = codeMatch[1].toUpperCase();
                if (prefix === 'P') subName = 'Powertrain (P-Codes)';
                else if (prefix === 'C') subName = 'Chassis (C-Codes)';
                else if (prefix === 'B') subName = 'Body (B-Codes)';
                else if (prefix === 'U') subName = 'Network (U-Codes)';
                else subName = 'Other Codes';
            } else {
                subName = 'Other Codes';
            }
        } else {
            const lowerTitle = safeTitle.toLowerCase();
            if (lowerTitle.includes('brake') || lowerTitle.includes('abs')) subName = 'Brakes';
            else if (lowerTitle.includes('air conditioning') || lowerTitle.includes('hvac') || lowerTitle.includes('heater') || lowerTitle.includes('refrigerant')) subName = 'HVAC';
            else if (lowerTitle.includes('engine') || lowerTitle.includes('cylinder') || lowerTitle.includes('crankshaft') || lowerTitle.includes('camshaft') || lowerTitle.includes('valve') || lowerTitle.includes('piston') || lowerTitle.includes('block') || lowerTitle.includes('timing')) subName = 'Engine Mechanical';
            else if (lowerTitle.includes('suspension') || lowerTitle.includes('steering') || lowerTitle.includes('strut') || lowerTitle.includes('shock') || lowerTitle.includes('tie rod') || lowerTitle.includes('control arm') || lowerTitle.includes('wheel bearing')) subName = 'Steering & Suspension';
            else if (lowerTitle.includes('transmission') || lowerTitle.includes('transaxle') || lowerTitle.includes('clutch') || lowerTitle.includes('torque converter')) subName = 'Transmission';
            else if (lowerTitle.includes('electrical') || lowerTitle.includes('wiring') || lowerTitle.includes('battery') || lowerTitle.includes('alternator') || lowerTitle.includes('starter') || lowerTitle.includes('generator') || lowerTitle.includes('fuse') || lowerTitle.includes('relay')) subName = 'Electrical';
            else if (lowerTitle.includes('fuel') || lowerTitle.includes('injector') || lowerTitle.includes('pump') || lowerTitle.includes('tank') || lowerTitle.includes('evap')) subName = 'Fuel System';
            else if (lowerTitle.includes('exhaust') || lowerTitle.includes('muffler') || lowerTitle.includes('catalytic') || lowerTitle.includes('converter')) subName = 'Exhaust';
            else if (lowerTitle.includes('cooling') || lowerTitle.includes('radiator') || lowerTitle.includes('water pump') || lowerTitle.includes('thermostat') || lowerTitle.includes('fan')) subName = 'Cooling System';
            else if (lowerTitle.includes('emission') || lowerTitle.includes('egr') || lowerTitle.includes('pcv') || lowerTitle.includes('smog')) subName = 'Emission Control';
            else if (lowerTitle.includes('body') || lowerTitle.includes('door') || lowerTitle.includes('window') || lowerTitle.includes('glass') || lowerTitle.includes('mirror') || lowerTitle.includes('interior') || lowerTitle.includes('exterior') || lowerTitle.includes('trim') || lowerTitle.includes('seat')) subName = 'Body & Interior';
            else if (lowerTitle.includes('airbag') || lowerTitle.includes('air bag') || lowerTitle.includes('srs') || lowerTitle.includes('seatbelt') || lowerTitle.includes('restraint')) subName = 'Restraints';
            else if (lowerTitle.includes('lighting') || lowerTitle.includes('headlight') || lowerTitle.includes('taillight') || lowerTitle.includes('bulb') || lowerTitle.includes('lamp') || lowerTitle.includes('turn signal')) subName = 'Lighting';
            else if (lowerTitle.includes('maintenance') || lowerTitle.includes('fluid') || lowerTitle.includes('oil') || lowerTitle.includes('filter') || lowerTitle.includes('lubrication') || lowerTitle.includes('inspection')) subName = 'Maintenance';
            else if (lowerTitle.includes('driveline') || lowerTitle.includes('axle') || lowerTitle.includes('driveshaft') || lowerTitle.includes('transfer case') || lowerTitle.includes('differential') || lowerTitle.includes('4wd') || lowerTitle.includes('awd')) subName = 'Driveline & Axles';
            else if (lowerTitle.includes('audio') || lowerTitle.includes('radio') || lowerTitle.includes('navigation') || lowerTitle.includes('speaker') || lowerTitle.includes('infotainment') || lowerTitle.includes('display')) subName = 'Audio & Navigation';
            else if (lowerTitle.includes('instrument') || lowerTitle.includes('cluster') || lowerTitle.includes('gauge') || lowerTitle.includes('speedometer')) subName = 'Instrument Cluster';
            else if (lowerTitle.includes('wiper') || lowerTitle.includes('washer')) subName = 'Wipers & Washers';
            else if (lowerTitle.includes('cruise control')) subName = 'Cruise Control';
            else if (lowerTitle.includes('security') || lowerTitle.includes('anti-theft') || lowerTitle.includes('key') || lowerTitle.includes('immobilizer')) subName = 'Security & Locks';
            // Only assign Other if we couldn't match anything and we needed to
            else if (isOther) subName = 'Other';
        }
    }

    if (rootName === 'Labor' || rootName === 'Oem Labor') rootName = 'Labor & Estimating'; // Only override exact matches here if needed
    // Keep standard names for UI matching
    if (rootName === 'Labor & Estimating') rootName = 'Labor'; 
    else if (rootName === 'Specs' || rootName === 'Quick Specs') rootName = 'Specifications';
    else if (rootName === 'Service Intervals') rootName = 'Maintenance';
    else if (rootName === 'Diagnostic Trouble Codes' || rootName === 'DTCs' || rootName === 'Fault Codes') rootName = 'Diagnostics';

    return { rootName, subName };
}
