/**
 * Motor maintenance API bodies vary by endpoint: legacy flat `schedules` / `items` / `data`,
 * interval ladder `intervals[].applications[]` (schedule + application IDs), frequency
 * `schedules[].items[]` or top-level `applications`.
 */

export interface FlatMaintenanceApplication {
    action: string;
    item: string;
    description: string | null;
    frequency_code?: string | null;
    /** Milestone from Motor when using `intervals[]` (may differ from requested UI interval). */
    motor_interval_miles?: number | null;
    task_metadata?: Record<string, unknown> | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function mapLegacyScheduleRow(s: Record<string, unknown>): FlatMaintenanceApplication {
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

/**
 * Pick the Motor interval bucket whose `interval` best matches the mileage the UI requested.
 * Tie-break toward the higher milestone (upcoming service).
 */
function pickIntervalBucket(
    intervals: { interval: number; applications: unknown[] }[],
    requestedMiles: number
): { interval: number; applications: unknown[] } | null {
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

function mapApplicationToFlat(
    app: Record<string, unknown>,
    motorIntervalMiles: number | null
): FlatMaintenanceApplication {
    const scheduleId = app.maintenanceScheduleId ?? app.maintenance_schedule_id;
    const appId = app.applicationID ?? app.applicationId ?? app.application_id;
    const hasIds = scheduleId != null && appId != null;
    const desc =
        app.description ?? app.Description ?? app.item ?? app.Item ?? app.name ?? app.Name;
    const action = String(app.action ?? app.Action ?? (hasIds ? 'Service' : 'Inspect/Replace'));
    const itemText =
        desc != null && String(desc).trim()
            ? String(desc).trim()
            : hasIds
              ? `Maintenance schedule ${scheduleId} (ref ${appId})`
              : action;
    const meta: Record<string, unknown> = {};
    if (scheduleId != null) meta.maintenanceScheduleId = scheduleId;
    if (appId != null) meta.applicationID = appId;
    if (motorIntervalMiles != null) meta.motorIntervalMiles = motorIntervalMiles;
    return {
        action,
        item: itemText,
        description: desc != null ? String(desc) : hasIds ? itemText : null,
        frequency_code: app.frequency_code != null ? String(app.frequency_code) : null,
        motor_interval_miles: motorIntervalMiles,
        task_metadata: Object.keys(meta).length ? meta : null
    };
}

/**
 * Normalize `getMaintenanceByIntervals` response body to display/sync rows.
 */
export function flattenMaintenanceIntervalResponseBody(
    body: unknown,
    requestedIntervalMiles: number
): FlatMaintenanceApplication[] {
    const b = asRecord(body);
    if (!b) return [];

    const out: FlatMaintenanceApplication[] = [];

    const intervalsRaw = b.intervals;
    if (Array.isArray(intervalsRaw) && intervalsRaw.length > 0) {
        const normalized: { interval: number; applications: unknown[] }[] = [];
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
        for (const a of bucket.applications) {
            const ar = asRecord(a);
            if (!ar) continue;
            out.push(mapApplicationToFlat(ar, bucket.interval));
        }
        return out;
    }

    let list: unknown[] = [];
    if (Array.isArray(b.schedules)) {
        const first = b.schedules[0];
        const fr = asRecord(first);
        if (fr && Array.isArray(fr.items)) {
            list = (b.schedules as Record<string, unknown>[]).flatMap((g) =>
                Array.isArray(g.items) ? g.items : []
            );
        } else {
            list = b.schedules as unknown[];
        }
    } else if (Array.isArray(b.items)) {
        list = b.items as unknown[];
    } else if (Array.isArray(b.data)) {
        list = b.data as unknown[];
    } else if (Array.isArray(b.applications)) {
        for (const a of b.applications as unknown[]) {
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

/**
 * Normalize `getMaintenanceByFrequency` response body.
 */
export function flattenMaintenanceFrequencyResponseBody(body: unknown): FlatMaintenanceApplication[] {
    const b = asRecord(body);
    if (!b) return [];

    if (Array.isArray(b.schedules)) {
        const first = b.schedules[0];
        const fr = asRecord(first);
        if (fr && Array.isArray(fr.items)) {
            const list = (b.schedules as Record<string, unknown>[]).flatMap((g) =>
                Array.isArray(g.items) ? g.items : []
            );
            return list.map((row) => mapLegacyScheduleRow(asRecord(row) ?? {}));
        }
        return (b.schedules as unknown[]).map((row) => mapLegacyScheduleRow(asRecord(row) ?? {}));
    }

    if (Array.isArray(b.applications)) {
        return (b.applications as unknown[]).map((a) =>
            mapApplicationToFlat(asRecord(a) ?? {}, null)
        );
    }

    if (Array.isArray(b.items)) {
        return (b.items as unknown[]).map((row) => mapLegacyScheduleRow(asRecord(row) ?? {}));
    }
    if (Array.isArray(b.data)) {
        return (b.data as unknown[]).map((row) => mapLegacyScheduleRow(asRecord(row) ?? {}));
    }

    return [];
}

/**
 * Map flattened rows to UI `MaintenanceSchedule` shape (id synthetic when missing).
 */
export function flatMaintenanceToUiRows(
    flat: FlatMaintenanceApplication[],
    interval?: number
): {
    id: string;
    description: string;
    interval?: number;
    frequency?: string;
    action: string;
    taskMetadata?: Record<string, unknown> | null;
}[] {
    return flat.map((r, i) => ({
        id: `m-${i}-${r.item.slice(0, 24)}`,
        description: r.description ?? r.item,
        interval,
        frequency: r.frequency_code ?? undefined,
        action: r.action,
        taskMetadata: r.task_metadata && Object.keys(r.task_metadata).length ? r.task_metadata : null
    }));
}
