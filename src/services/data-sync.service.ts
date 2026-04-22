import { Injectable, inject, signal } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { MotorApiService } from './motor-api.service';
import { LoggerService } from './logger.service';
import { VehiclePersistenceService } from './vehicle-persistence.service';
import { AiRewriteService } from './ai-rewrite.service';
import { SupabaseService } from './supabase.service';
import { normalizeCategoryParams } from '../utils/categorize.util';
import { improveCatalogArticleRow } from '../utils/catalog-intelligence.util';
import {
    flattenMaintenanceFrequencyResponseBody,
    flattenMaintenanceIntervalResponseBody
} from '../utils/maintenance-response.util';
import type { Article, CommonIssue } from '../models/motor.models';
import type { ContentItem, NormalizedArticle } from '../models/normalized_schema';

/** Resolved canonical body from Supabase (structured or cached enhanced HTML). */
export interface CanonicalArticleBodyResult {
    safeHtml: string;
    rawForTutorial: string;
    source: 'content_item' | 'enhanced_cache';
}

@Injectable({
    providedIn: 'root'
})
export class DataSyncService {
    private logger = inject(LoggerService);
    private motorApi = inject(MotorApiService);
    private aiRewrite = inject(AiRewriteService);
    private supabase = inject(SupabaseService);
    private vehiclePersistence = inject(VehiclePersistenceService);

    // Sync State
    isSyncing = signal(false);
    syncProgress = signal({ current: 0, total: 0, message: 'Ready' });
    private inProgressArticleSyncs = new Set<string>();
    /** One eager reference-data run per vehicle at a time (dashboard remounts). */
    private eagerReferenceSyncInFlight = new Set<string>();
    /** Dedupe concurrent Motor `/fluids` → `specifications` upserts (eager + specs section). */
    private fluidSyncPromises = new Map<string, Promise<void>>();
    /** Browser anon clients are read-only after RLS tightening; disable metadata writes after first deny. */
    private metadataClientWriteDisabled = false;
    /** Browser client write path is disabled after first RLS/auth deny. */
    private clientWriteDisabled = false;

    /** Mile intervals to prefetch into `maintenance_schedules` (each skipped if already present). */
    private readonly eagerMaintenanceIntervalsMiles = [7500, 15000, 30000, 45000, 60000, 100000];

    /** Motor maintenance-by-frequency type codes (not mile intervals). */
    private readonly eagerMaintenanceFrequencyCodes = ['F', 'N', 'R'] as const;

    /**
     * L1 `maintenance_task` — same composite key as `maintenance_schedules` (idempotent dual-write).
     * No-op if table missing (migration not applied); logs a short warning.
     */
    private async dualWriteMaintenanceTaskL1(
        rows: {
            vehicle_id: string;
            interval_value: number;
            interval_unit: string;
            action: string;
            item: string;
            description: string | null;
            frequency_code: string | null;
            task_metadata?: Record<string, unknown> | null;
        }[],
        ingestSource: 'motor_interval' | 'motor_frequency'
    ): Promise<void> {
        if (rows.length === 0) return;
        const now = new Date().toISOString();
        const severityFromCode = (code: string | null | undefined): string | null => {
            if (!code) return null;
            if (code === 'F') return 'fixed_severe';
            if (code === 'N') return 'normal';
            if (code === 'R') return 'related';
            return null;
        };
        const taskRows = rows.map((r) => ({
            vehicle_id: r.vehicle_id,
            interval_value: r.interval_value,
            interval_unit: r.interval_unit || 'Miles',
            action: r.action,
            item: r.item,
            description: r.description,
            frequency_code: r.frequency_code,
            ingest_source: ingestSource,
            severity_bucket:
                ingestSource === 'motor_frequency' ? severityFromCode(r.frequency_code) : null,
            metadata_json:
                r.task_metadata && Object.keys(r.task_metadata).length > 0 ? r.task_metadata : {},
            extractor_version: 'l1-client-v1',
            updated_at: now
        }));

        if (this.clientWriteDisabled) return;
        const { error } = await this.supabase.client
            .from('maintenance_task')
            .upsert(taskRows, { onConflict: 'vehicle_id,interval_value,action,item' });

        if (error) {
            if (this.isClientWriteDenied(error)) { this.clientWriteDisabled = true; return; }
            this.logger.warn('[DataSync] maintenance_task L1 upsert skipped:', error.message);
        }
    }

    /**
     * Motor `articleDetails` can list the same `id` more than once. Supabase upsert rejects duplicate
     * `(vehicle_id, original_id)` in one batch (Postgres 21000).
     */
    private dedupeArticleCatalogRows<T extends { original_id: string }>(rows: T[]): T[] {
        const map = new Map<string, T>();
        for (const row of rows) {
            map.set(row.original_id, row);
        }
        return [...map.values()];
    }

    async checkNormalizationStatus(vehicleId: string): Promise<boolean> {
        const { data, error } = await this.supabase.client
            .from('vehicles')
            .select('is_normalized')
            .eq('external_id', vehicleId)
            .maybeSingle();

        if (!error && data !== null) {
            return !!data.is_normalized;
        }

        this.logger.warn(`[DataSync] is_normalized read failed or missing for ${vehicleId}, falling back to articles count:`, error);
        
        const { count } = await this.supabase.client
            .from('articles')
            .select('*', { count: 'exact', head: true })
            .eq('vehicle_id', vehicleId);
            
        return (count ?? 0) > 0;
    }

    /**
     * Lightweight vehicle registration — called on dashboard load.
     * Only creates/updates the vehicle row (no API). Heavy reference data is
     * filled by {@link eagerSyncVehicleReferenceData} (catalog metadata, specifications
     * from catalog articles, fluids via `/fluids`, parts, maintenance). Full article HTML stays lazy per article.
     */
    async ensureVehicleRecord(contentSource: string, vehicleId: string, vehicleName: string): Promise<void> {
        if (this.clientWriteDisabled) {
            return;
        }
        const parts = vehicleName.split(' ');
        const year = parseInt(parts[0]) || 0;
        const make = parts[1] || '';
        const model = parts.slice(2).join(' ') || '';

        const { error } = await this.supabase.client.from('vehicles').upsert({
            external_id: vehicleId,
            content_source: contentSource,
            year,
            make,
            model,
            updated_at: new Date().toISOString()
        }, { onConflict: 'external_id' });
        if (error) {
            if (this.isClientWriteDenied(error)) {
                this.clientWriteDisabled = true;
                this.logger.info('[DataSync] Disabling browser DB writes (RLS/auth read-only).');
                return;
            }
            this.logger.warn('[DataSync] Vehicle upsert failed (non-fatal):', error);
        }
    }

    /**
     * Eagerly syncs non–full-HTML reference data for a vehicle: article catalog
     * (metadata + silo buckets only), fluids, parts, and common maintenance
     * intervals. Skips work when data already exists to limit repeat API traffic.
     * Does **not** fetch per-article HTML (that remains {@link syncSingleArticle}).
     * @param motorVehicleId Composite Motor vehicle id when the route uses an OEM shard (e.g. GeneralMotors) — aligns parts/maintenance/catalog with `/articles/v2` routing.
     */
    async eagerSyncVehicleReferenceData(
        contentSource: string,
        vehicleId: string,
        motorVehicleId?: string
    ): Promise<void> {
        const key = `${contentSource}:${vehicleId}:${motorVehicleId ?? ''}`;
        if (this.eagerReferenceSyncInFlight.has(key)) {
            return;
        }
        this.eagerReferenceSyncInFlight.add(key);

        this.isSyncing.set(true);
        this.syncProgress.set({ current: 0, total: 100, message: 'Starting…' });

        const setStep = (pct: number, message: string) =>
            this.syncProgress.set({ current: pct, total: 100, message });

        try {
            const [{ data: vehicleRow }, { count: articleCount }] = await Promise.all([
                this.supabase.client
                    .from('vehicles')
                    .select('is_normalized')
                    .eq('external_id', vehicleId)
                    .maybeSingle(),
                this.supabase.client
                    .from('articles')
                    .select('*', { count: 'exact', head: true })
                    .eq('vehicle_id', vehicleId)
            ]);

            const catalogLikelyComplete = !!vehicleRow?.is_normalized && (articleCount ?? 0) >= 10;
            /** DB drift: normalized flag without rows — must re-ingest catalog (no Motor fallback in UI). */
            const needsCatalogRepair = !!vehicleRow?.is_normalized && (articleCount ?? 0) === 0;

            setStep(5, 'Article catalog…');
            if (!catalogLikelyComplete || needsCatalogRepair) {
                await this.syncArticleCatalogMetadataOnly(contentSource, vehicleId, motorVehicleId);
            }

            setStep(30, 'Specifications…');
            await this.syncSpecificationsIfMissing(contentSource, vehicleId);

            setStep(42, 'Fluids…');
            await this.syncFluidsIfMissing(contentSource, vehicleId);

            setStep(55, 'Parts catalog…');
            await this.syncPartsIfMissing(contentSource, vehicleId, motorVehicleId);

            setStep(70, 'Maintenance schedules…');
            await Promise.all([
                ...this.eagerMaintenanceIntervalsMiles.map((interval) =>
                    this.lazySyncMaintenanceInterval(contentSource, vehicleId, interval, motorVehicleId)
                ),
                ...this.eagerMaintenanceFrequencyCodes.map((code) =>
                    this.lazySyncMaintenanceByFrequency(contentSource, vehicleId, code, motorVehicleId)
                )
            ]);

            const { count: finalArticleCount } = await this.supabase.client
                .from('articles')
                .select('*', { count: 'exact', head: true })
                .eq('vehicle_id', vehicleId);

            if (!this.clientWriteDisabled) {
                const nowIso = new Date().toISOString();
                if ((finalArticleCount ?? 0) > 0) {
                    const { error: normErr } = await this.supabase.client
                        .from('vehicles')
                        .update({ is_normalized: true, updated_at: nowIso })
                        .eq('external_id', vehicleId);
                    if (normErr) {
                        if (this.isClientWriteDenied(normErr)) {
                            this.clientWriteDisabled = true;
                        }
                        this.logger.warn('[DataSync] is_normalized update failed:', normErr);
                    }
                } else if (vehicleRow?.is_normalized) {
                    const { error: clearErr } = await this.supabase.client
                        .from('vehicles')
                        .update({ is_normalized: false, updated_at: nowIso })
                        .eq('external_id', vehicleId);
                    if (clearErr) {
                        if (this.isClientWriteDenied(clearErr)) {
                            this.clientWriteDisabled = true;
                        }
                        this.logger.warn('[DataSync] is_normalized clear failed:', clearErr);
                    } else {
                        this.logger.warn(
                            '[DataSync] No article rows after reference sync; cleared is_normalized drift for',
                            vehicleId
                        );
                    }
                }
            }

            setStep(100, 'Done');
        } catch (e) {
            this.logger.warn('[DataSync] eagerSyncVehicleReferenceData failed (non-fatal):', e);
        } finally {
            this.isSyncing.set(false);
            this.eagerReferenceSyncInFlight.delete(key);
            this.syncProgress.set({ current: 0, total: 100, message: 'Ready' });
        }
    }

    /**
     * One `articles/v2` call (empty search) → upsert catalog rows without clobbering
     * stored `original_content` / `enhanced_content` when already present.
     */
    private async syncArticleCatalogMetadataOnly(
        contentSource: string,
        vehicleId: string,
        motorVehicleId?: string
    ): Promise<void> {
        const res = await lastValueFrom(
            this.motorApi.searchArticles(contentSource, vehicleId, '', motorVehicleId, { catalogSync: true })
        );
        if (res.header.statusCode !== 200) {
            this.logger.warn('[DataSync] searchArticles for catalog failed', res.header);
            return;
        }

        const details = (res.body as { articleDetails?: Article[] })?.articleDetails ?? [];
        if (details.length === 0) {
            return;
        }

        const { data: existingRows, error: existingErr } = await this.supabase.client
            .from('articles')
            .select('original_id, original_content, enhanced_content')
            .eq('vehicle_id', vehicleId);

        if (existingErr) {
            this.logger.warn('[DataSync] Could not read existing articles for merge:', existingErr);
        }

        const existingById = new Map<string, { original_content: string | null; enhanced_content: string | null }>();
        for (const row of existingRows ?? []) {
            const oid = (row as { original_id: string }).original_id;
            existingById.set(oid, {
                original_content: (row as { original_content: string | null }).original_content ?? null,
                enhanced_content: (row as { enhanced_content: string | null }).enhanced_content ?? null
            });
        }

        const now = new Date().toISOString();
        const rows = details.map((a) => {
            const parentBucket = a.parentBucket ?? 'Other';
            const bucket = a.bucket ?? 'Uncategorized';
            const { rootName, subName } = normalizeCategoryParams(a.title ?? '', parentBucket, bucket);
            const bucketVal = subName ?? bucket;
            const prev = existingById.get(a.id);
            const preserveHtml = prev?.original_content && prev.original_content.length > 0;
            const preserveEnhanced = prev?.enhanced_content && prev.enhanced_content.length > 0;

            const improved = improveCatalogArticleRow({
                title: a.title,
                subtitle: a.subtitle,
                description: a.description,
                code: a.code,
                parentBucket,
                bucket,
                rootName,
                subName
            });

            return {
                vehicle_id: vehicleId,
                original_id: a.id,
                title: improved.title,
                subtitle: improved.subtitle,
                code: a.code ?? null,
                description: improved.description,
                bucket: bucketVal,
                parent_bucket: rootName,
                thumbnail_href: a.thumbnailHref ?? null,
                bulletin_number: a.bulletinNumber ?? null,
                release_date: a.releaseDate ?? null,
                sort: typeof a.sort === 'number' ? a.sort : null,
                content_source: contentSource,
                source: contentSource,
                original_content: preserveHtml ? prev!.original_content : null,
                enhanced_content: preserveEnhanced ? prev!.enhanced_content : null,
                updated_at: now
            };
        });

        const dedupedRows = this.dedupeArticleCatalogRows(rows);
        if (dedupedRows.length < rows.length) {
            this.logger.warn(
                `[DataSync] Deduped ${rows.length - dedupedRows.length} duplicate original_id(s) for vehicle ${vehicleId}`
            );
        }

        if (this.clientWriteDisabled) {
            return;
        }
        const chunkSize = 200;
        for (let i = 0; i < dedupedRows.length; i += chunkSize) {
            const chunk = dedupedRows.slice(i, i + chunkSize);
            const { error } = await this.supabase.client
                .from('articles')
                .upsert(chunk, { onConflict: 'vehicle_id,original_id' });
            if (error) {
                if (this.isClientWriteDenied(error)) {
                    this.clientWriteDisabled = true;
                    this.logger.info('[DataSync] Disabling browser DB writes after articles catalog upsert deny.');
                    return;
                }
                this.logger.warn('[DataSync] Article catalog upsert chunk failed:', error);
            }
        }

        /** `is_normalized` is set only in {@link eagerSyncVehicleReferenceData} after verifying rows exist. */
    }

    /**
     * Cache years / makes / models (+ embedded engines) JSON for proxy metadataCacheMiddleware.
     * Use paths without `/api` prefix (e.g. `/years`, `/year/2020/makes`).
     */
    async cacheVehicleMetadata(apiPath: string, payload: unknown): Promise<void> {
        if (this.metadataClientWriteDisabled || this.clientWriteDisabled) {
            return;
        }
        let path = apiPath.startsWith('/api/') ? apiPath.slice(4) : apiPath;
        if (!path.startsWith('/')) {
            path = `/${path}`;
        }
        let data: object;
        try {
            data = JSON.parse(JSON.stringify(payload)) as object;
        } catch {
            this.logger.warn('[DataSync] cacheVehicleMetadata: payload not serializable, skipping', path);
            return;
        }
        try {
            const { error } = await this.supabase.client.from('vehicle_metadata').upsert(
                { path, data, updated_at: new Date().toISOString() },
                { onConflict: 'path' }
            );
            if (error) {
                if (this.isClientWriteDenied(error)) {
                    this.metadataClientWriteDisabled = true;
                    this.clientWriteDisabled = true;
                    this.logger.info('[DataSync] Disabling client vehicle_metadata cache writes (RLS read-only).');
                    return;
                }
                this.logger.warn('[DataSync] cacheVehicleMetadata upsert failed:', path, error);
            }
        } catch (e) {
            this.logger.warn('[DataSync] cacheVehicleMetadata failed (non-fatal):', path, e);
        }
    }

    /**
     * Upsert `specifications` rows from `articles` catalog metadata (no article HTML).
     * Skips when non-fluid spec rows already exist.
     */
    private async syncSpecificationsIfMissing(_contentSource: string, vehicleId: string): Promise<void> {
        const { count, error: countErr } = await this.supabase.client
            .from('specifications')
            .select('*', { count: 'exact', head: true })
            .eq('vehicle_id', vehicleId)
            .neq('category', 'Fluids');

        if (countErr) {
            this.logger.warn('[DataSync] syncSpecificationsIfMissing count error:', countErr);
        }
        if ((count ?? 0) > 0) {
            return;
        }

        const { data: rows, error } = await this.supabase.client
            .from('articles')
            .select('original_id,title,description,bucket,parent_bucket')
            .eq('vehicle_id', vehicleId);

        if (error) {
            this.logger.warn('[DataSync] syncSpecificationsIfMissing articles read failed:', error);
            return;
        }

        const specRows = this.buildSpecificationUpsertsFromCatalogRows(vehicleId, rows ?? []);
        if (specRows.length === 0) {
            return;
        }

        if (this.clientWriteDisabled) return;
        const chunkSize = 150;
        for (let i = 0; i < specRows.length; i += chunkSize) {
            const chunk = specRows.slice(i, i + chunkSize);
            const { error: upErr } = await this.supabase.client
                .from('specifications')
                .upsert(chunk, { onConflict: 'vehicle_id,category,name' });
            if (upErr) {
                if (this.isClientWriteDenied(upErr)) { this.clientWriteDisabled = true; return; }
                this.logger.warn('[DataSync] specifications upsert chunk failed:', upErr);
            }
        }
    }

    private buildSpecificationUpsertsFromCatalogRows(
        vehicleId: string,
        rows: { original_id: string; title: string | null; description: string | null; bucket: string | null; parent_bucket: string | null }[]
    ): Record<string, unknown>[] {
        const now = new Date().toISOString();
        const out: Record<string, unknown>[] = [];
        for (const r of rows) {
            const bucket = r.bucket ?? '';
            const parent = r.parent_bucket ?? '';
            const title = r.title ?? '';
            if (!this.isSpecificationCatalogArticle(bucket, parent, title)) {
                continue;
            }
            const category = parent.trim() || 'Specifications';
            const name = title.trim() || `Article ${r.original_id}`;
            out.push({
                vehicle_id: vehicleId,
                category,
                name,
                value: (r.description ?? '').trim() || null,
                unit: null,
                display_text: null,
                metadata: { originalArticleId: r.original_id, bucket, parent_bucket: parent },
                updated_at: now
            });
        }
        return out;
    }

    /** Spec-like catalog entries; excludes fluids silos (fluids handled later). */
    private isSpecificationCatalogArticle(bucket: string, parent: string, title: string): boolean {
        const b = bucket.toLowerCase();
        const p = parent.toLowerCase();
        const t = title.toLowerCase();
        if (p.includes('fluid') || b.includes('fluid') || p.includes('fluids') || b.includes('fluids')) {
            return false;
        }
        return (
            b.includes('specification') ||
            b.includes('specs') ||
            t.includes('specification') ||
            t.includes('specs') ||
            t.includes('torque') ||
            t.includes('alignment') ||
            t.includes('tire')
        );
    }

    private async syncPartsIfMissing(
        contentSource: string,
        vehicleId: string,
        motorVehicleId?: string
    ): Promise<void> {
        const { count, error } = await this.supabase.client
            .from('parts')
            .select('*', { count: 'exact', head: true })
            .eq('vehicle_id', vehicleId);

        if (error) {
            this.logger.warn('[DataSync] syncPartsIfMissing count error:', error);
        }
        if ((count ?? 0) > 0) {
            return;
        }
        await this.syncParts(contentSource, vehicleId, motorVehicleId);
    }

    async getArticleTitleFromSupabase(vehicleId: string, articleId: string): Promise<string | null> {
        const { data } = await this.supabase.client
            .from('articles')
            .select('title')
            .eq('vehicle_id', vehicleId)
            .eq('original_id', articleId)
            .maybeSingle();
        return data?.title || null;
    }

    async getCachedCommonIssues(vehicleId: string): Promise<CommonIssue[] | null> {
        const { data } = await this.supabase.client
            .from('common_issues_cache')
            .select('issues')
            .eq('vehicle_id', vehicleId)
            .maybeSingle();
        return (data?.issues as CommonIssue[]) || null;
    }

    async resolveRelatedLinks(vehicleId: string, codes: string[]): Promise<Record<string, string>> {
        if (!codes || codes.length === 0) return {};
        
        // Find matching articles by code, bulletin_number, or original_id
        // Since Supabase `in` filter works on arrays, we can construct an OR query
        const queryStr = codes.map(c => {
            const clean = c.replace(/'/g, "''");
            return `code.eq.'${clean}',bulletin_number.eq.'${clean}',original_id.eq.'${clean}'`;
        }).join(',');
        
        const { data } = await this.supabase.client
            .from('articles')
            .select('original_id, code, bulletin_number')
            .eq('vehicle_id', vehicleId)
            .or(queryStr);
            
        const map: Record<string, string> = {};
        if (data) {
            for (const row of data) {
                // Match back to the input codes
                for (const c of codes) {
                    if (row.code === c || row.bulletin_number === c || row.original_id === c) {
                        map[c] = row.original_id;
                    }
                }
            }
        }
        return map;
    }

    /**
     * Lazily sync common issues — called by the common-issues section.
     * Checks Supabase cache first; only hits the AI endpoint when missing.
     */
    async lazySyncCommonIssues(contentSource: string, vehicleId: string, vehicleName: string, generatedIssues?: CommonIssue[]): Promise<void> {
        await this.syncCommonIssues(contentSource, vehicleId, vehicleName, generatedIssues);
    }

    /**
     * Lazily sync fluids — Motor `/fluids` → `specifications` rows (`category: 'Fluids'`), skipped when already present.
     * Specs section awaits this before `loadSpecs` so normalized vehicles see cached fluids.
     */
    lazySyncFluids(contentSource: string, vehicleId: string): Promise<void> {
        return this.syncFluidsIfMissing(contentSource, vehicleId);
    }

    /**
     * When no `Fluids` rows exist for the vehicle, fetch Motor `/fluids` and upsert into `specifications`.
     */
    private syncFluidsIfMissing(contentSource: string, vehicleId: string): Promise<void> {
        const key = `${contentSource}:${vehicleId}`;
        const existing = this.fluidSyncPromises.get(key);
        if (existing) return existing;

        const p = (async () => {
            try {
                const { count, error: countErr } = await this.supabase.client
                    .from('specifications')
                    .select('*', { count: 'exact', head: true })
                    .eq('vehicle_id', vehicleId)
                    .eq('category', 'Fluids');

                if (countErr) {
                    this.logger.warn('[DataSync] syncFluidsIfMissing count error:', countErr);
                }
                if ((count ?? 0) > 0) return;

                await this.syncFluids(contentSource, vehicleId);
            } catch (e) {
                this.logger.warn('[DataSync] syncFluidsIfMissing failed (non-fatal):', e);
            } finally {
                this.fluidSyncPromises.delete(key);
            }
        })();

        this.fluidSyncPromises.set(key, p);
        return p;
    }

    /** Lazily sync parts — called by parts section. */
    async lazySyncParts(contentSource: string, vehicleId: string, motorVehicleId?: string): Promise<void> {
        await this.syncParts(contentSource, vehicleId, motorVehicleId);
    }

    /**
     * Lazily sync maintenance for a single interval — called by maintenance section
     * when the user selects an interval. Avoids fetching all 6 intervals at once.
     */
    async lazySyncMaintenanceInterval(
        contentSource: string,
        vehicleId: string,
        interval: number,
        motorVehicleId?: string
    ): Promise<void> {
        try {
            const { data: existing } = await this.supabase.client
                .from('maintenance_schedules')
                .select('id')
                .eq('vehicle_id', vehicleId)
                .eq('interval_value', interval)
                .limit(1);

            if (existing && existing.length > 0) return;

            const res = await lastValueFrom(
                this.motorApi.getMaintenanceByIntervals(
                    contentSource,
                    vehicleId,
                    'miles',
                    interval,
                    undefined,
                    undefined,
                    motorVehicleId
                )
            );
            const flat = flattenMaintenanceIntervalResponseBody(res.body, interval);

            if (flat.length > 0) {
                const now = new Date().toISOString();
                const rows = flat.map((s) => ({
                    vehicle_id: vehicleId,
                    interval_value: interval,
                    interval_unit: 'Miles',
                    action: s.action,
                    item: s.item,
                    description: s.description,
                    frequency_code: s.frequency_code ?? null,
                    task_metadata: s.task_metadata ?? null,
                    updated_at: now
                }));
                if (this.clientWriteDisabled) return;
                const scheduleRows = rows.map(
                    ({ task_metadata: _m, ...rest }) => rest
                ) as Omit<(typeof rows)[0], 'task_metadata'>[];
                await this.supabase.client
                    .from('maintenance_schedules')
                    .upsert(scheduleRows, { onConflict: 'vehicle_id,interval_value,action,item' });
                await this.dualWriteMaintenanceTaskL1(rows, 'motor_interval');
            }
        } catch (e) {
            this.logger.warn(`[DataSync] Maintenance sync failed for interval ${interval}`, e);
        }
    }

    /**
     * Sync maintenance schedules for Motor frequency type F / N / R (not mileage-based).
     * Uses `interval_unit: 'Frequency'` and small sentinel `interval_value` per code so rows
     * do not collide with mile intervals (7500+).
     */
    async lazySyncMaintenanceByFrequency(
        contentSource: string,
        vehicleId: string,
        code: 'F' | 'N' | 'R',
        motorVehicleId?: string
    ): Promise<void> {
        const frequencyIntervalValue = code === 'F' ? 1 : code === 'N' ? 2 : 3;
        try {
            const { count, error: cErr } = await this.supabase.client
                .from('maintenance_schedules')
                .select('*', { count: 'exact', head: true })
                .eq('vehicle_id', vehicleId)
                .eq('interval_unit', 'Frequency')
                .eq('frequency_code', code);

            if (cErr) {
                this.logger.warn('[DataSync] lazySyncMaintenanceByFrequency count error:', cErr);
            }
            if ((count ?? 0) > 0) {
                return;
            }

            const res = await lastValueFrom(
                this.motorApi.getMaintenanceByFrequency(
                    contentSource,
                    vehicleId,
                    code,
                    'All',
                    undefined,
                    motorVehicleId
                )
            );
            const flat = flattenMaintenanceFrequencyResponseBody(res.body);

            if (flat.length === 0) {
                return;
            }

            const now = new Date().toISOString();
            const rows = flat.map((s) => ({
                vehicle_id: vehicleId,
                interval_value: frequencyIntervalValue,
                interval_unit: 'Frequency',
                action: s.action,
                item: s.item,
                description: s.description,
                frequency_code: code,
                task_metadata: s.task_metadata ?? null,
                updated_at: now
            }));
            if (this.clientWriteDisabled) return;
            const scheduleRows = rows.map(
                ({ task_metadata: _m, ...rest }) => rest
            ) as Omit<(typeof rows)[0], 'task_metadata'>[];

            await this.supabase.client
                .from('maintenance_schedules')
                .upsert(scheduleRows, { onConflict: 'vehicle_id,interval_value,action,item' });
            await this.dualWriteMaintenanceTaskL1(rows, 'motor_frequency');
        } catch (e) {
            this.logger.warn(`[DataSync] Maintenance frequency sync failed for ${code}`, e);
        }
    }

    /**
     * Fetch `articles` row for viewer (enhanced cache, etc.).
     */
    async fetchArticleRowForViewer(vehicleId: string, originalId: string): Promise<NormalizedArticle | null> {
        const { data, error } = await this.supabase.client
            .from('articles')
            .select(
                'id, vehicle_id, original_id, enhanced_content, original_content, title, content_source'
            )
            .eq('vehicle_id', vehicleId)
            .eq('original_id', originalId)
            .maybeSingle();
        if (error) {
            this.logger.warn('[DataSync] fetchArticleRowForViewer:', error.message);
            return null;
        }
        return (data as NormalizedArticle) ?? null;
    }

    /**
     * Fetch normalized `content_item` for this catalog article (structured display fields).
     */
    async fetchContentItemForArticle(
        vehicleExternalId: string,
        motorArticleId: string,
        contentSource: string
    ): Promise<ContentItem | null> {
        const tryOne = async (source: string) => {
            const { data, error } = await this.supabase.client
                .from('content_item')
                .select('*')
                .eq('vehicle_external_id', vehicleExternalId)
                .eq('motor_article_id', motorArticleId)
                .eq('content_source', source)
                .maybeSingle();
            if (error) {
                this.logger.warn('[DataSync] content_item fetch:', error.message);
                return null;
            }
            return (data as ContentItem) ?? null;
        };
        let row = await tryOne(contentSource);
        if (!row && contentSource.toUpperCase() !== 'MOTOR') {
            row = await tryOne('MOTOR');
        }
        return row;
    }

    /**
     * Prefer Supabase structured / cached body over ad-hoc Motor HTML + rewrite.
     * Returns null if nothing canonical is available (caller uses Motor path).
     */
    async tryApplyCanonicalArticleBody(
        vehicleId: string,
        articleId: string,
        contentSource: string,
        sanitizeHtml: (raw: string) => string
    ): Promise<CanonicalArticleBodyResult | null> {
        const [articleRow, ci] = await Promise.all([
            this.fetchArticleRowForViewer(vehicleId, articleId),
            this.fetchContentItemForArticle(vehicleId, articleId, contentSource)
        ]);

        const long = ci?.display_long_description?.trim();
        const short = ci?.display_description?.trim();
        const enriched = Boolean(ci?.enriched_at || ci?.enrichment_source);
        const enrichmentSource = (ci?.enrichment_source || '').toLowerCase();
        // Catalog-intel "display_description" is a teaser summary, not the full article body.
        // Never use it as canonical content in the viewer.
        const isCatalogSummaryOnly =
            enrichmentSource.includes('catalog_intel') || enrichmentSource.includes('catalog-intel');
        const allowShortSummaryFallback = !isCatalogSummaryOnly;

        let rawBody = '';
        if (long) {
            rawBody = long.includes('<') ? long : this.wrapStructuredPlainText(long);
        } else if (allowShortSummaryFallback && enriched && short && short.length >= 40) {
            rawBody = short.includes('<') ? short : this.wrapStructuredPlainText(short);
        }

        if (rawBody) {
            const safe = sanitizeHtml(rawBody);
            if (safe) {
                return { safeHtml: safe, rawForTutorial: rawBody, source: 'content_item' };
            }
        }

        const ec = articleRow?.enhanced_content?.trim();
        if (ec) {
            const safe = sanitizeHtml(ec);
            if (safe) {
                return { safeHtml: safe, rawForTutorial: ec, source: 'enhanced_cache' };
            }
        }
        return null;
    }

    private wrapStructuredPlainText(text: string): string {
        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/\n/g, '<br />');
        return `<div class="torque-prose torque-structured-body">${escaped}</div>`;
    }

    /**
     * Persist LLM-rewritten HTML so repeat views use Supabase instead of re-calling /api/rewrite.
     */
    async persistArticleEnhancedHtml(vehicleId: string, originalId: string, html: string): Promise<void> {
        const trimmed = html?.trim();
        if (!trimmed || this.clientWriteDisabled) return;
        const { error } = await this.supabase.client
            .from('articles')
            .update({ enhanced_content: trimmed, updated_at: new Date().toISOString() })
            .eq('vehicle_id', vehicleId)
            .eq('original_id', originalId);
        if (error) {
            this.logger.warn('[DataSync] persistArticleEnhancedHtml failed:', error.message);
        }
    }

    /**
     * Lazy synchronization: Saves a single article's content to Supabase.
     * Called by ArticleViewerComponent AFTER it already has the HTML content,
     * so no additional API call is needed.
     *
     * @param cs Content source
     * @param vid Vehicle ID
     * @param item Article metadata (id, title, bucket, etc.)
     * @param prefetchedHtml HTML already fetched by the article viewer (avoids double-fetch)
     */
    async syncSingleArticle(cs: string, vid: string, item: any, prefetchedHtml?: string): Promise<any> {
        const syncKey = `${vid}:${item.id}`;
        if (this.inProgressArticleSyncs.has(syncKey)) {
            return Promise.resolve(null);
        }
        this.inProgressArticleSyncs.add(syncKey);

        try {
            const { data: existing } = await this.supabase.client
                .from('articles')
                .select('*')
                .eq('vehicle_id', vid)
                .eq('original_id', item.id)
                .maybeSingle();

            const existingHtml = typeof existing?.original_content === 'string' ? existing.original_content.trim() : '';
            // If we already have the content cached, skip
            if (existingHtml) {
                return existing;
            }

            // Use pre-fetched HTML when available; only call API as last resort
            let rawHtml = prefetchedHtml || '';
            if (!rawHtml && !existingHtml) {
                this.logger.info(`[DataSync] Fetching ${item.id} from proxy for ingest/cache...`);
                if (String(item.id || '').startsWith('L:')) {
                    const laborRes = await lastValueFrom(this.motorApi.getLaborDetails(cs, vid, item.id));
                    rawHtml = (laborRes?.body as any)?.content || (laborRes?.body as any)?.html || '';
                } else {
                    const contentRes = await lastValueFrom(this.motorApi.getArticleContent(cs, vid, item.id));
                    rawHtml = (contentRes?.body as any)?.html || '';
                    if (!rawHtml && (contentRes?.body as any)?.pdfDataUri) {
                        rawHtml = (contentRes.body as any).pdfDataUri;
                    }
                }
            }

            const articleData: Record<string, any> = {
                original_id: item.id,
                title: item.title || item.code || '',
                subtitle: item.subtitle ?? null,
                code: item.code ?? null,
                description: item.description ?? null,
                thumbnail_href: item.thumbnailHref ?? null,
                bulletin_number: item.bulletinNumber ?? null,
                release_date: item.releaseDate ?? null,
                sort: typeof item.sort === 'number' ? item.sort : null,
                original_content: rawHtml || (existing?.original_content ?? ''),
                enhanced_content: (existing as NormalizedArticle)?.enhanced_content ?? '',
                vehicle_id: vid,
                content_source: cs,
                source: cs,
                bucket: item.bucket || '',
                parent_bucket: item.parentBucket || '',
                updated_at: new Date().toISOString()
            };

            const { data: upserted, error: upsertError } = await this.supabase.client
                .from('articles')
                .upsert(articleData, { onConflict: 'vehicle_id,original_id' })
                .select()
                .single();
            if (upsertError) {
                if (this.isClientWriteDenied(upsertError)) {
                    this.clientWriteDisabled = true;
                    // Expected in production after RLS tightening: browser anon clients are read-only.
                    // Content ingest was still triggered through proxy GET above.
                    this.logger.info('[DataSync] Browser write blocked by RLS; waiting for backend ingest path.', {
                        articleId: item.id,
                        vehicleId: vid
                    });
                    return existing ?? articleData;
                }
                this.logger.warn('[DataSync] Article upsert failed:', upsertError);
            }
            return upserted ?? articleData;
        } finally {
            this.inProgressArticleSyncs.delete(syncKey);
        }
    }

    private isClientWriteDenied(error: any): boolean {
        const msg = String(error?.message || '').toLowerCase();
        const details = String(error?.details || '').toLowerCase();
        const hint = String(error?.hint || '').toLowerCase();
        const status = Number(error?.status || 0);
        return (
            error?.code === '42501' ||
            status === 401 ||
            status === 403 ||
            msg.includes('row-level security') ||
            msg.includes('permission denied') ||
            msg.includes('unauthorized') ||
            details.includes('row-level security') ||
            details.includes('permission denied') ||
            hint.includes('row-level security')
        );
    }

    private async syncCommonIssues(cs: string, vid: string, name: string, generatedIssues?: CommonIssue[]) {
        if (this.clientWriteDisabled) return;

        const { data: cached } = await this.supabase.client
            .from('common_issues_cache')
            .select('updated_at')
            .eq('vehicle_id', vid)
            .maybeSingle();

        if (!cached) {
            try {
                let issues = generatedIssues;
                if (!issues) {
                    const res = await lastValueFrom(this.aiRewrite.generateCommonIssues(name, vid));
                    issues = res.issues;
                }

                if (issues && issues.length > 0) {
                    const { error } = await this.supabase.client.from('common_issues_cache').upsert({
                        vehicle_id: vid,
                        source: cs,
                        issues,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'vehicle_id' });
                    
                    if (error) {
                        if (this.isClientWriteDenied(error)) {
                            this.clientWriteDisabled = true;
                            this.logger.warn(`Browser Supabase write disabled after auth/RLS deny (syncCommonIssues)`);
                        } else {
                            this.logger.warn(`common_issues_cache upsert failed: ${error.message}`);
                        }
                    }
                }
            } catch (err) {
                this.logger.warn(`Failed to sync common issues: ${err}`);
            }
        }
    }


    /** Motor `/fluids` → `specifications` (`category: 'Fluids'`). */
    private async syncFluids(cs: string, vid: string): Promise<void> {
        try {
            const pv = this.vehiclePersistence.getVehicle();
            const motorInfo =
                pv &&
                pv.vehicleId === vid &&
                pv.motorBaseVehicleId &&
                pv.motorEngineId
                    ? {
                          baseVehicleId: pv.motorBaseVehicleId,
                          engineId: pv.motorEngineId
                      }
                    : undefined;
            const res = await lastValueFrom(this.motorApi.getFluids(cs, vid, motorInfo));
            const body = res.body as unknown;
            const bodyObj = body && typeof body === 'object' ? (body as { data?: unknown }) : null;
            const raw = (
                bodyObj && Array.isArray(bodyObj.data)
                    ? bodyObj.data
                    : Array.isArray(body)
                      ? body
                      : []
            ) as Record<string, unknown>[];

            const now = new Date().toISOString();
            const rows: Record<string, unknown>[] = [];
            for (const item of raw) {
                const row = this.mapFluidApiItemToSpecificationRow(vid, item, now);
                if (row) rows.push(row);
            }
            if (rows.length === 0) return;
            if (this.clientWriteDisabled) return;

            const chunkSize = 100;
            for (let i = 0; i < rows.length; i += chunkSize) {
                const chunk = rows.slice(i, i + chunkSize);
                const { error: upErr } = await this.supabase.client
                    .from('specifications')
                    .upsert(chunk, { onConflict: 'vehicle_id,category,name' });
                if (upErr) {
                    if (this.isClientWriteDenied(upErr)) { this.clientWriteDisabled = true; return; }
                    this.logger.warn('[DataSync] fluids specifications upsert chunk failed:', upErr);
                }
            }
        } catch (e) {
            this.logger.warn('[DataSync] syncFluids failed (non-fatal):', e);
        }
    }

    private mapFluidApiItemToSpecificationRow(
        vehicleId: string,
        item: Record<string, unknown>,
        now: string
    ): Record<string, unknown> | null {
        const title = String(
            item.title ?? item.name ?? item.fluidName ?? item.description ?? item.fluidType ?? ''
        ).trim();
        if (!title) return null;
        const capacity = String(item.capacity ?? item.volume ?? item.amount ?? '').trim();
        const specification = String(
            item.specification ?? item.spec ?? item.viscosity ?? item.notes ?? ''
        ).trim();
        const bucket = String(item.bucket ?? 'Fluids').trim() || 'Fluids';
        return {
            vehicle_id: vehicleId,
            category: 'Fluids',
            name: title,
            value: capacity || null,
            unit: null,
            display_text: specification || null,
            metadata: {
                originalFluidId: item.id ?? item.fluidId ?? null,
                bucket
            },
            updated_at: now
        };
    }

    /** Parts: payload matches DB columns (vehicle_id, part_number, description, manufacturer, list_price, dealer_price). NormalizedPart also has quantity, fitment_notes for when API/DB support them. */
    private async syncParts(cs: string, vid: string, motorVehicleId?: string) {
        if (this.clientWriteDisabled) return;
        try {
            const res = await lastValueFrom(this.motorApi.getParts(cs, vid, '', motorVehicleId));
            const parts = res.body?.data || [];
            if (parts.length > 0) {
                const partData = parts.map((p: any) => ({
                    vehicle_id: vid,
                    part_number: p.partNumber ?? '',
                    description: p.description ?? null,
                    manufacturer: p.manufacturer ?? null,
                    list_price: p.listPrice ?? null,
                    dealer_price: p.dealerPrice ?? null,
                    updated_at: new Date().toISOString()
                }));
                await this.supabase.client.from('parts').upsert(partData, { onConflict: 'vehicle_id,part_number' });
            }
        } catch (e) {
            this.logger.error('Parts sync failed', e);
        }
    }

    /** @deprecated Use lazySyncMaintenanceInterval for on-demand interval sync */
    private async syncMaintenance(_cs: string, _vid: string) {
        // No-op: maintenance is now synced lazily per interval via lazySyncMaintenanceInterval
    }
}
