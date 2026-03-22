import { Injectable, inject, signal, isDevMode } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { MotorApiService } from './motor-api.service';
import { AiRewriteService } from './ai-rewrite.service';
import { SupabaseService } from './supabase.service';
import { normalizeCategoryParams } from '../utils/categorize.util';
import type { Article } from '../models/motor.models';

@Injectable({
    providedIn: 'root'
})
export class DataSyncService {
    private motorApi = inject(MotorApiService);
    private aiRewrite = inject(AiRewriteService);
    private supabase = inject(SupabaseService);

    // Sync State
    isSyncing = signal(false);
    syncProgress = signal({ current: 0, total: 0, message: 'Ready' });
    private inProgressArticleSyncs = new Set<string>();
    /** One eager reference-data run per vehicle at a time (dashboard remounts). */
    private eagerReferenceSyncInFlight = new Set<string>();

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
            metadata_json: {},
            extractor_version: 'l1-client-v1',
            updated_at: now
        }));

        const { error } = await this.supabase.client
            .from('maintenance_task')
            .upsert(taskRows, { onConflict: 'vehicle_id,interval_value,action,item' });

        if (error) {
            console.warn('[DataSync] maintenance_task L1 upsert skipped:', error.message);
        }
    }

    async checkNormalizationStatus(vehicleId: string): Promise<boolean> {
        const { data } = await this.supabase.client
            .from('vehicles')
            .select('is_normalized')
            .eq('external_id', vehicleId)
            .maybeSingle();

        return !!data?.is_normalized;
    }

    /**
     * Lightweight vehicle registration — called on dashboard load.
     * Only creates/updates the vehicle row (no API). Heavy reference data is
     * filled by {@link eagerSyncVehicleReferenceData} (catalog metadata, specifications
     * from catalog articles, parts, maintenance). Full article HTML stays lazy per article.
     * Fluids → Motor `/fluids` sync is intentionally disabled for now.
     */
    async ensureVehicleRecord(contentSource: string, vehicleId: string, vehicleName: string): Promise<void> {
        const parts = vehicleName.split(' ');
        const year = parseInt(parts[0]) || 0;
        const make = parts[1] || '';
        const model = parts.slice(2).join(' ') || '';

        await this.supabase.client.from('vehicles').upsert({
            external_id: vehicleId,
            content_source: contentSource,
            year,
            make,
            model,
            updated_at: new Date().toISOString()
        }, { onConflict: 'external_id' }).then(null, (e: any) =>
            console.warn('[DataSync] Vehicle upsert failed (non-fatal):', e)
        );
    }

    /**
     * Eagerly syncs non–full-HTML reference data for a vehicle: article catalog
     * (metadata + silo buckets only), fluids, parts, and common maintenance
     * intervals. Skips work when data already exists to limit repeat API traffic.
     * Does **not** fetch per-article HTML (that remains {@link syncSingleArticle}).
     */
    async eagerSyncVehicleReferenceData(contentSource: string, vehicleId: string): Promise<void> {
        const key = `${contentSource}:${vehicleId}`;
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

            setStep(5, 'Article catalog…');
            if (!catalogLikelyComplete) {
                await this.syncArticleCatalogMetadataOnly(contentSource, vehicleId);
            }

            setStep(30, 'Specifications…');
            await this.syncSpecificationsIfMissing(contentSource, vehicleId);

            // FLUIDS: disabled — `/fluids` pipeline deferred (see lazySyncFluids).

            setStep(55, 'Parts catalog…');
            await this.syncPartsIfMissing(contentSource, vehicleId);

            setStep(70, 'Maintenance schedules…');
            await Promise.all([
                ...this.eagerMaintenanceIntervalsMiles.map((interval) =>
                    this.lazySyncMaintenanceInterval(contentSource, vehicleId, interval)
                ),
                ...this.eagerMaintenanceFrequencyCodes.map((code) =>
                    this.lazySyncMaintenanceByFrequency(contentSource, vehicleId, code)
                )
            ]);

            setStep(100, 'Done');
        } catch (e) {
            console.warn('[DataSync] eagerSyncVehicleReferenceData failed (non-fatal):', e);
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
    private async syncArticleCatalogMetadataOnly(contentSource: string, vehicleId: string): Promise<void> {
        const res = await lastValueFrom(this.motorApi.searchArticles(contentSource, vehicleId, ''));
        if (res.header.statusCode !== 200) {
            console.warn('[DataSync] searchArticles for catalog failed', res.header);
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
            console.warn('[DataSync] Could not read existing articles for merge:', existingErr);
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

            return {
                vehicle_id: vehicleId,
                original_id: a.id,
                title: a.title ?? null,
                subtitle: a.subtitle ?? null,
                code: a.code ?? null,
                description: a.description ?? null,
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

        const chunkSize = 200;
        for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const { error } = await this.supabase.client
                .from('articles')
                .upsert(chunk, { onConflict: 'vehicle_id,original_id' });
            if (error) {
                console.warn('[DataSync] Article catalog upsert chunk failed:', error);
            }
        }

        if (details.length > 0) {
            const { error: normErr } = await this.supabase.client
                .from('vehicles')
                .update({ is_normalized: true, updated_at: now })
                .eq('external_id', vehicleId);
            if (normErr) {
                console.warn('[DataSync] is_normalized update failed:', normErr);
            }
        }
    }

    /**
     * Cache years / makes / models (+ embedded engines) JSON for proxy metadataCacheMiddleware.
     * Use paths without `/api` prefix (e.g. `/years`, `/year/2020/makes`).
     */
    async cacheVehicleMetadata(apiPath: string, payload: unknown): Promise<void> {
        let path = apiPath.startsWith('/api/') ? apiPath.slice(4) : apiPath;
        if (!path.startsWith('/')) {
            path = `/${path}`;
        }
        let data: object;
        try {
            data = JSON.parse(JSON.stringify(payload)) as object;
        } catch {
            console.warn('[DataSync] cacheVehicleMetadata: payload not serializable, skipping', path);
            return;
        }
        try {
            const { error } = await this.supabase.client.from('vehicle_metadata').upsert(
                { path, data, updated_at: new Date().toISOString() },
                { onConflict: 'path' }
            );
            if (error) {
                console.warn('[DataSync] cacheVehicleMetadata upsert failed:', path, error);
            }
        } catch (e) {
            console.warn('[DataSync] cacheVehicleMetadata failed (non-fatal):', path, e);
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
            console.warn('[DataSync] syncSpecificationsIfMissing count error:', countErr);
        }
        if ((count ?? 0) > 0) {
            return;
        }

        const { data: rows, error } = await this.supabase.client
            .from('articles')
            .select('original_id,title,description,bucket,parent_bucket')
            .eq('vehicle_id', vehicleId);

        if (error) {
            console.warn('[DataSync] syncSpecificationsIfMissing articles read failed:', error);
            return;
        }

        const specRows = this.buildSpecificationUpsertsFromCatalogRows(vehicleId, rows ?? []);
        if (specRows.length === 0) {
            return;
        }

        const chunkSize = 150;
        for (let i = 0; i < specRows.length; i += chunkSize) {
            const chunk = specRows.slice(i, i + chunkSize);
            const { error: upErr } = await this.supabase.client
                .from('specifications')
                .upsert(chunk, { onConflict: 'vehicle_id,category,name' });
            if (upErr) {
                console.warn('[DataSync] specifications upsert chunk failed:', upErr);
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

    private async syncPartsIfMissing(contentSource: string, vehicleId: string): Promise<void> {
        const { count, error } = await this.supabase.client
            .from('parts')
            .select('*', { count: 'exact', head: true })
            .eq('vehicle_id', vehicleId);

        if (error) {
            console.warn('[DataSync] syncPartsIfMissing count error:', error);
        }
        if ((count ?? 0) > 0) {
            return;
        }
        await this.syncParts(contentSource, vehicleId);
    }

    /**
     * Lazily sync common issues — called by the common-issues section.
     * Checks Supabase cache first; only hits the AI endpoint when missing.
     */
    async lazySyncCommonIssues(contentSource: string, vehicleId: string, vehicleName: string): Promise<void> {
        await this.syncCommonIssues(contentSource, vehicleId, vehicleName);
    }

    /**
     * Lazily sync fluids — **disabled**: Motor `/fluids` + specifications hydration deferred.
     * Specs section still loads non-fluid specifications via catalog-derived rows + article list.
     */
    async lazySyncFluids(_contentSource: string, _vehicleId: string): Promise<void> {
        return;
    }

    /** Lazily sync parts — called by parts section. */
    async lazySyncParts(contentSource: string, vehicleId: string): Promise<void> {
        await this.syncParts(contentSource, vehicleId);
    }

    /**
     * Lazily sync maintenance for a single interval — called by maintenance section
     * when the user selects an interval. Avoids fetching all 6 intervals at once.
     */
    async lazySyncMaintenanceInterval(contentSource: string, vehicleId: string, interval: number): Promise<void> {
        try {
            const { data: existing } = await this.supabase.client
                .from('maintenance_schedules')
                .select('id')
                .eq('vehicle_id', vehicleId)
                .eq('interval_value', interval)
                .limit(1);

            if (existing && existing.length > 0) return;

            const res = await lastValueFrom(this.motorApi.getMaintenanceByIntervals(contentSource, vehicleId, 'miles', interval));
            const schedules = (res.body as any)?.schedules || (res.body as any)?.items || (res.body as any)?.data || [];

            if (schedules.length > 0) {
                const rows = schedules.map((s: any) => ({
                    vehicle_id: vehicleId,
                    interval_value: interval,
                    interval_unit: 'Miles',
                    action: s.action || 'Inspect/Replace',
                    item: s.description || s.item || '',
                    description: s.description ?? null,
                    frequency_code: s.frequency_code ?? s.frequency ?? null,
                    updated_at: new Date().toISOString()
                }));
                await this.supabase.client
                    .from('maintenance_schedules')
                    .upsert(rows, { onConflict: 'vehicle_id,interval_value,action,item' });
                await this.dualWriteMaintenanceTaskL1(rows, 'motor_interval');
            }
        } catch (e) {
            console.warn(`[DataSync] Maintenance sync failed for interval ${interval}`, e);
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
        code: 'F' | 'N' | 'R'
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
                console.warn('[DataSync] lazySyncMaintenanceByFrequency count error:', cErr);
            }
            if ((count ?? 0) > 0) {
                return;
            }

            const res = await lastValueFrom(
                this.motorApi.getMaintenanceByFrequency(contentSource, vehicleId, code, 'All')
            );
            const schedules =
                (res.body as any)?.schedules || (res.body as any)?.items || (res.body as any)?.data || [];

            if (schedules.length === 0) {
                return;
            }

            const rows = schedules.map((s: any) => ({
                vehicle_id: vehicleId,
                interval_value: frequencyIntervalValue,
                interval_unit: 'Frequency',
                action: s.action || 'Inspect/Replace',
                item: s.description || s.item || '',
                description: s.description ?? null,
                frequency_code: code,
                updated_at: new Date().toISOString()
            }));

            await this.supabase.client
                .from('maintenance_schedules')
                .upsert(rows, { onConflict: 'vehicle_id,interval_value,action,item' });
            await this.dualWriteMaintenanceTaskL1(rows, 'motor_frequency');
        } catch (e) {
            console.warn(`[DataSync] Maintenance frequency sync failed for ${code}`, e);
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

            // If we already have the content cached, skip
            if (existing?.original_content) {
                return existing;
            }

            // Use pre-fetched HTML when available; only call API as last resort
            let rawHtml = prefetchedHtml || '';
            if (!rawHtml && !existing) {
                if (isDevMode()) console.log(`[DataSync] Fetching ${item.id} from Motor API (no prefetched HTML)...`);
                const contentRes = await lastValueFrom(this.motorApi.getArticleContent(cs, vid, item.id));
                rawHtml = (contentRes?.body as any)?.html || '';
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
                enhanced_content: '',
                vehicle_id: vid,
                content_source: cs,
                source: cs,
                bucket: item.bucket || '',
                parent_bucket: item.parentBucket || '',
                updated_at: new Date().toISOString()
            };

            const { data: upserted } = await this.supabase.client
                .from('articles')
                .upsert(articleData, { onConflict: 'vehicle_id,original_id' })
                .select()
                .single();
            return upserted ?? articleData;
        } finally {
            this.inProgressArticleSyncs.delete(syncKey);
        }
    }

    private async syncCommonIssues(cs: string, vid: string, name: string) {
        // Attempt to see if we already generated it previously
        const { data: cached } = await this.supabase.client
            .from('common_issues_cache')
            .select('*')
            .eq('vehicle_id', vid)
            .maybeSingle();

        if (!cached) {
            const issues = await lastValueFrom(this.aiRewrite.generateCommonIssues(name));
            if (issues && issues.length > 0) {
                // Upsert newly generated common issues
                await this.supabase.client.from('common_issues_cache').upsert({
                    vehicle_id: vid,
                    source: cs,
                    issues,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'vehicle_id' });
            }
        }
    }


    /** Motor `/fluids` → `specifications` — disabled until fluids pipeline is finalized. */
    private async syncFluids(_cs: string, _vid: string): Promise<void> {
        return;
    }

    /** Parts: payload matches DB columns (vehicle_id, part_number, description, manufacturer, list_price, dealer_price). NormalizedPart also has quantity, fitment_notes for when API/DB support them. */
    private async syncParts(cs: string, vid: string) {
        try {
            const res = await lastValueFrom(this.motorApi.getParts(cs, vid));
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
            console.error('Parts sync failed', e);
        }
    }

    /** @deprecated Use lazySyncMaintenanceInterval for on-demand interval sync */
    private async syncMaintenance(_cs: string, _vid: string) {
        // No-op: maintenance is now synced lazily per interval via lazySyncMaintenanceInterval
    }
}
