/**
 * Server-side reference ingest: fluids → specifications, parts → parts,
 * maintenance → maintenance_schedules + maintenance_task (ported from Angular DataSyncService
 * + maintenance-response.util.ts). Uses service-role REST via insertParsedData.
 */
import { insertParsedData } from '../db.service.js';
import logger from '../logger.js';

// --- Ported from src/utils/maintenance-response.util.ts ---

function asRecord(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

function applicationIdKey(v) {
    if (v == null) return null;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? String(n) : s;
}

function buildApplicationsByIdMap(applications) {
    const map = new Map();
    for (const a of applications) {
        const ar = asRecord(a);
        if (!ar) continue;
        const id = ar.applicationId ?? ar.applicationID ?? ar.application_id;
        const key = applicationIdKey(id);
        if (key) map.set(key, ar);
    }
    return map;
}

function mapLegacyScheduleRow(s) {
    const action = String(s.action ?? s.Action ?? 'Inspect/Replace');
    const desc = s.description ?? s.Description ?? s.item ?? s.Item;
    const item = String(desc ?? '').trim() || action;
    const freq = s.frequency_code ?? s.frequency ?? s.Frequency ?? null;
    return {
        action,
        item,
        description: desc != null ? String(desc) : null,
        frequency_code: freq != null ? String(freq) : null
    };
}

function pickIntervalBucket(intervals, requestedMiles) {
    if (!intervals.length) return null;
    const exact = intervals.find((x) => x.interval === requestedMiles);
    if (exact) return exact;

    let best = intervals[0];
    let bestDiff = Math.abs(best.interval - requestedMiles);
    for (let i = 1; i < intervals.length; i++) {
        const cur = intervals[i];
        const d = Math.abs(cur.interval - requestedMiles);
        if (d < bestDiff || (d === bestDiff && cur.interval > best.interval)) {
            best = cur;
            bestDiff = d;
        }
    }
    return best;
}

function mapApplicationToFlat(app, motorIntervalMiles) {
    const scheduleId = app.maintenanceScheduleId ?? app.maintenance_schedule_id;
    const appId = app.applicationID ?? app.applicationId ?? app.application_id;
    const hasIds = scheduleId != null && appId != null;
    const tax = asRecord(app.taxonomy);
    const literalFromTaxonomy =
        tax?.literalName != null ? String(tax.literalName).trim() : '';
    const desc =
        app.description ?? app.Description ?? app.item ?? app.Item ?? app.name ?? app.Name;
    const action = String(app.action ?? app.Action ?? (hasIds ? 'Service' : 'Inspect/Replace'));
    const itemText = literalFromTaxonomy
        ? literalFromTaxonomy
        : desc != null && String(desc).trim()
          ? String(desc).trim()
          : hasIds
            ? `Maintenance schedule ${scheduleId} (ref ${appId})`
            : action;
    const meta = {};
    if (scheduleId != null) meta.maintenanceScheduleId = scheduleId;
    if (appId != null) meta.applicationID = appId;
    if (motorIntervalMiles != null) meta.motorIntervalMiles = motorIntervalMiles;
    if (literalFromTaxonomy) meta.taxonomyLiteralName = literalFromTaxonomy;
    const tid = tax?.taxonomyID ?? tax?.taxonomyId;
    if (tid != null) meta.taxonomyID = tid;
    return {
        action,
        item: itemText,
        description:
            literalFromTaxonomy
                ? literalFromTaxonomy
                : desc != null
                  ? String(desc)
                  : hasIds
                    ? itemText
                    : null,
        frequency_code: app.frequency_code != null ? String(app.frequency_code) : null,
        motor_interval_miles: motorIntervalMiles,
        task_metadata: Object.keys(meta).length ? meta : null
    };
}

export function flattenMaintenanceIntervalResponseBody(body, requestedIntervalMiles) {
    const b = asRecord(body);
    if (!b) return [];

    const out = [];

    const intervalsRaw = b.intervals;
    if (Array.isArray(intervalsRaw) && intervalsRaw.length > 0) {
        const normalized = [];
        for (const raw of intervalsRaw) {
            const ir = asRecord(raw);
            if (!ir) continue;
            const mile = Number(ir.interval ?? ir.Interval);
            const apps = ir.applications ?? ir.Applications;
            if (!Number.isFinite(mile) || !Array.isArray(apps)) continue;
            normalized.push({ interval: mile, applications: apps });
        }
        const bucket = pickIntervalBucket(normalized, requestedIntervalMiles);
        if (!bucket) return [];

        const topApps = b.applications;
        const fullById =
            Array.isArray(topApps) && topApps.length > 0
                ? buildApplicationsByIdMap(topApps)
                : null;

        for (const a of bucket.applications) {
            const ar = asRecord(a);
            if (!ar) continue;
            const stubId = ar.applicationID ?? ar.applicationId ?? ar.application_id;
            const key = applicationIdKey(stubId);
            const full = key && fullById ? fullById.get(key) : undefined;
            const source = full ? { ...full, ...ar } : ar;
            out.push(mapApplicationToFlat(source, bucket.interval));
        }
        return out;
    }

    let list = [];
    if (Array.isArray(b.schedules)) {
        const first = b.schedules[0];
        const fr = asRecord(first);
        if (fr && Array.isArray(fr.items)) {
            list = b.schedules.flatMap((g) => (Array.isArray(g.items) ? g.items : []));
        } else {
            list = b.schedules;
        }
    } else if (Array.isArray(b.items)) {
        list = b.items;
    } else if (Array.isArray(b.data)) {
        list = b.data;
    } else if (Array.isArray(b.applications)) {
        for (const a of b.applications) {
            const ar = asRecord(a);
            if (ar) out.push(mapApplicationToFlat(ar, null));
        }
        return out;
    }

    for (const row of list) {
        const sr = asRecord(row);
        if (sr) out.push(mapLegacyScheduleRow(sr));
    }
    return out;
}

export function flattenMaintenanceFrequencyResponseBody(body) {
    const b = asRecord(body);
    if (!b) return [];

    if (Array.isArray(b.schedules)) {
        const first = b.schedules[0];
        const fr = asRecord(first);
        if (fr && Array.isArray(fr.items)) {
            const list = b.schedules.flatMap((g) => (Array.isArray(g.items) ? g.items : []));
            return list.map((row) => mapLegacyScheduleRow(asRecord(row) ?? {}));
        }
        return b.schedules.map((row) => mapLegacyScheduleRow(asRecord(row) ?? {}));
    }

    if (Array.isArray(b.applications)) {
        return b.applications.map((a) => mapApplicationToFlat(asRecord(a) ?? {}, null));
    }

    if (Array.isArray(b.items)) {
        return b.items.map((row) => mapLegacyScheduleRow(asRecord(row) ?? {}));
    }
    if (Array.isArray(b.data)) {
        return b.data.map((row) => mapLegacyScheduleRow(asRecord(row) ?? {}));
    }

    return [];
}

// --- Fluids → specifications (DataSyncService.mapFluidApiItemToSpecificationRow) ---

function mapFluidApiItemToSpecificationRow(vehicleId, item, now) {
    const row = asRecord(item) ?? {};
    const title = String(
        row.title ?? row.name ?? row.fluidName ?? row.description ?? row.fluidType ?? ''
    ).trim();
    if (!title) return null;
    const capacity = String(row.capacity ?? row.volume ?? row.amount ?? '').trim();
    const specification = String(
        row.specification ?? row.spec ?? row.viscosity ?? row.notes ?? ''
    ).trim();
    const bucket = String(row.bucket ?? 'Fluids').trim() || 'Fluids';
    return {
        vehicle_id: vehicleId,
        category: 'Fluids',
        name: title,
        value: capacity || null,
        unit: null,
        display_text: specification || null,
        metadata: {
            originalFluidId: row.id ?? row.fluidId ?? null,
            bucket
        },
        updated_at: now
    };
}

function unwrapMotorResponsePayload(body) {
    const r = asRecord(body);
    if (r && r.body != null && typeof r.body === 'object' && !Array.isArray(r.body)) {
        return r.body;
    }
    return body;
}

/**
 * @param {*} body Motor `/fluids` JSON body
 */
export async function upsertFluidsFromMotorBody(vehicleId, body, { dryRun = false } = {}) {
    const un = unwrapMotorResponsePayload(body);
    const bodyObj = asRecord(un);
    const raw = Array.isArray(bodyObj?.data) ? bodyObj.data : Array.isArray(un) ? un : [];
    const now = new Date().toISOString();
    const rows = [];
    for (const item of raw) {
        const row = mapFluidApiItemToSpecificationRow(vehicleId, item, now);
        if (row) rows.push(row);
    }
    if (rows.length === 0) {
        return { success: true, count: 0 };
    }
    if (dryRun) {
        return { success: true, count: rows.length, dryRun: true };
    }
    const chunkSize = 100;
    for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const r = await insertParsedData('specifications', chunk);
        if (!r.success) {
            logger.warn('[reference_data] fluids chunk failed:', r.error);
            return { success: false, error: r.error, count: i };
        }
    }
    return { success: true, count: rows.length };
}

/**
 * @param {*} body Raw Motor parts response (array or `{ data, items }` shaped)
 */
export async function upsertPartsFromMotorBody(vehicleId, body, { dryRun = false } = {}) {
    const un = unwrapMotorResponsePayload(body);
    const bodyAny = un;
    const rawItems = Array.isArray(bodyAny)
        ? bodyAny
        : Array.isArray(bodyAny?.data)
            ? bodyAny.data
            : Array.isArray(bodyAny?.items)
                ? bodyAny.items
                : [];
    const parsePrice = (v) => {
        if (v == null || v === '') return null;
        const n = Number.parseFloat(String(v).replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) ? n : null;
    };
    const partData = rawItems.map((item) => {
        const p = asRecord(item) ?? {};
        return {
            vehicle_id: vehicleId,
            part_number: p.partNumber ?? p.part_number ?? '',
            description: p.partDescription ?? p.description ?? null,
            manufacturer: p.manufacturer ?? null,
            list_price: p.listPrice ?? parsePrice(p.price),
            dealer_price: p.dealerPrice ?? null,
            updated_at: new Date().toISOString()
        };
    }).filter((r) => r.part_number !== '');

    if (partData.length === 0) {
        return { success: true, count: 0 };
    }
    if (dryRun) {
        return { success: true, count: partData.length, dryRun: true };
    }
    const r = await insertParsedData('parts', partData);
    if (!r.success) {
        return { success: false, error: r.error, count: 0 };
    }
    return { success: true, count: partData.length };
}

function severityFromFrequencyCode(code) {
    if (!code) return null;
    if (code === 'F') return 'fixed_severe';
    if (code === 'N') return 'normal';
    if (code === 'R') return 'related';
    return null;
}

async function dualWriteMaintenanceTaskL1(rows, ingestSource) {
    if (rows.length === 0) return { success: true };
    const now = new Date().toISOString();
    const taskRows = rows.map((r) => ({
        vehicle_id: r.vehicle_id,
        interval_value: r.interval_value,
        interval_unit: r.interval_unit || 'Miles',
        action: r.action != null && String(r.action).trim() ? String(r.action) : 'Inspect/Replace',
        item: r.item,
        description: r.description,
        frequency_code: r.frequency_code,
        ingest_source: ingestSource,
        severity_bucket:
            ingestSource === 'motor_frequency' ? severityFromFrequencyCode(r.frequency_code) : null,
        metadata_json:
            r.task_metadata && Object.keys(r.task_metadata).length > 0 ? r.task_metadata : {},
        extractor_version: 'l1-worker-v1',
        updated_at: now
    }));
    return insertParsedData('maintenance_task', taskRows);
}

/**
 * @param {*} body Motor maintenanceSchedules/intervals JSON body
 */
export async function upsertMaintenanceIntervalFromMotorBody(
    vehicleId,
    intervalMiles,
    body,
    { dryRun = false } = {}
) {
    const flat = flattenMaintenanceIntervalResponseBody(unwrapMotorResponsePayload(body), intervalMiles);
    if (flat.length === 0) {
        return { success: true, count: 0 };
    }
    const now = new Date().toISOString();
    const rows = flat.map((s) => ({
        vehicle_id: vehicleId,
        interval_value: intervalMiles,
        interval_unit: 'Miles',
        action: s.action,
        item: s.item,
        description: s.description,
        frequency_code: s.frequency_code ?? null,
        task_metadata: s.task_metadata ?? null,
        updated_at: now
    }));
    const scheduleRows = rows.map(({ task_metadata: _m, ...rest }) => rest);
    if (dryRun) {
        return { success: true, count: scheduleRows.length, dryRun: true };
    }
    const sch = await insertParsedData('maintenance_schedules', scheduleRows);
    if (!sch.success) {
        return { success: false, error: sch.error, count: 0 };
    }
    const task = await dualWriteMaintenanceTaskL1(rows, 'motor_interval');
    if (!task.success) {
        logger.warn('[reference_data] maintenance_task (interval) upsert:', task.error);
    }
    return { success: true, count: scheduleRows.length };
}

/**
 * @param {'F'|'N'|'R'} frequencyCode
 * @param {*} body Motor maintenanceSchedules/frequency JSON body
 */
export async function upsertMaintenanceFrequencyFromMotorBody(
    vehicleId,
    frequencyCode,
    body,
    { dryRun = false } = {}
) {
    const frequencyIntervalValue = frequencyCode === 'F' ? 1 : frequencyCode === 'N' ? 2 : 3;
    const flat = flattenMaintenanceFrequencyResponseBody(unwrapMotorResponsePayload(body));
    if (flat.length === 0) {
        return { success: true, count: 0 };
    }
    const now = new Date().toISOString();
    const rows = flat.map((s) => ({
        vehicle_id: vehicleId,
        interval_value: frequencyIntervalValue,
        interval_unit: 'Frequency',
        action: s.action,
        item: s.item,
        description: s.description,
        frequency_code: frequencyCode,
        task_metadata: s.task_metadata ?? null,
        updated_at: now
    }));
    const scheduleRows = rows.map(({ task_metadata: _m, ...rest }) => rest);
    if (dryRun) {
        return { success: true, count: scheduleRows.length, dryRun: true };
    }
    const sch = await insertParsedData('maintenance_schedules', scheduleRows);
    if (!sch.success) {
        return { success: false, error: sch.error, count: 0 };
    }
    const task = await dualWriteMaintenanceTaskL1(rows, 'motor_frequency');
    if (!task.success) {
        logger.warn('[reference_data] maintenance_task (frequency) upsert:', task.error);
    }
    return { success: true, count: scheduleRows.length };
}
