import { Injectable, inject, signal } from '@angular/core';
import { from, lastValueFrom, of } from 'rxjs';
import { catchError, concatMap, mergeMap, tap } from 'rxjs/operators';
import { MotorApiService } from './motor-api.service';
import { AiRewriteService } from './ai-rewrite.service';
import { SupabaseService } from './supabase.service';

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
     * Only creates/updates the vehicle record. No silo API calls.
     * Article catalog is populated by the proxy background worker when
     * articles/v2 passes through; silo data is synced lazily by each section.
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
     * Lazily sync common issues — called by the common-issues section.
     * Checks Supabase cache first; only hits the AI endpoint when missing.
     */
    async lazySyncCommonIssues(contentSource: string, vehicleId: string, vehicleName: string): Promise<void> {
        await this.syncCommonIssues(contentSource, vehicleId, vehicleName);
    }

    /** Lazily sync fluids into specifications table — called by specs section. */
    async lazySyncFluids(contentSource: string, vehicleId: string): Promise<void> {
        await this.syncFluids(contentSource, vehicleId);
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
            }
        } catch (e) {
            console.warn(`[DataSync] Maintenance sync failed for interval ${interval}`, e);
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
                console.log(`[DataSync] Fetching ${item.id} from Motor API (no prefetched HTML)...`);
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


    private async syncFluids(cs: string, vid: string) {
        try {
            const res = await lastValueFrom(this.motorApi.getFluids(cs, vid));
            const fluids = res.body?.data || [];
            if (fluids.length > 0) {
                const specData = fluids.map((f: any) => ({
                    vehicle_id: vid,
                    category: 'Fluids',
                    name: f.title ?? '',
                    value: f.capacity ?? '',
                    unit: f.unit ?? null,
                    display_text: (f.capacity || f.specification) ? `${f.capacity || ''} - ${f.specification || ''}`.trim() : null,
                    metadata: (f.id != null || f.bucket != null || f.specification != null) ? { id: f.id, bucket: f.bucket, specification: f.specification } : null,
                    updated_at: new Date().toISOString()
                }));
                await this.supabase.client.from('specifications').upsert(specData, { onConflict: 'vehicle_id,category,name' });
            }
        } catch (e) {
            console.error('Fluids sync failed', e);
        }
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
