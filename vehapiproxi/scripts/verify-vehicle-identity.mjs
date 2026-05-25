/**
 * Regression guard for vehicle-name resolution (the "2011 Nissan Rogue shown as
 * 1985 Dodge" class of bug). Exits non-zero on any failure.
 *
 *   node scripts/verify-vehicle-identity.mjs
 */
import 'dotenv/config';
import { resolveVehicleName, parseVehicleId } from '../src/domain/vehicle-identity.js';

let failures = 0;
function check(label, actual, expected) {
    const ok = actual === expected;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
    if (!ok) failures++;
}

// parseVehicleId classification
check('parse ymme', parseVehicleId('2011:Nissan:Rogue').kind, 'ymme');
check('parse composite', parseVehicleId('22470:7835').kind, 'composite');
check('parse base', parseVehicleId('22470').kind, 'base');

// Name resolution
const ymme = await resolveVehicleName('2011:Nissan:Rogue');
check('ymme name', ymme.name, '2011 Nissan Rogue');

const rogue = await resolveVehicleName('22470:7835'); // baseVehicleId:engineId
check('Rogue by baseVehicleId', rogue.name, '2011 Nissan Rogue');

// The bug: model.id 3398 collides with Lumina's real baseVehicleId. Resolving the
// *base id* 3398 returns Lumina (correct for that base id) — proving model.id must
// never be used as a routing key. We assert it does NOT return the Rogue.
const collision = await resolveVehicleName('3398:7835');
check('3398 is NOT mis-resolved to Rogue', collision.name !== '2011 Nissan Rogue', true);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
