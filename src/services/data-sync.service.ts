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

    async checkNormalizationStatus(vehicleId: string): Promise<boolean> {
        const { data } = await this.supabase.client
            .from('vehicles')
            .select('is_normalized')
            .eq('external_id', vehicleId)
            .maybeSingle();

        return !!data?.is_normalized;
    }

    async syncFullVehicle(contentSource: string, vehicleId: string, vehicleName: string): Promise<void> {
        if (this.isSyncing()) return;

        // Note: Full sync is largely deprecated in favor of lazy sync, 
        // but we keep a "lite" version for core metadata and essential silos.
        this.isSyncing.set(true);
        this.syncProgress.set({ current: 0, total: 100, message: 'Starting Sync...' });

        try {
            // 0. Ensure vehicle exists in DB (or register it)
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
            }, { onConflict: 'external_id' });

            // 1. Common Issues (AI) - Keep eager as it's a dashboard feature
            this.syncProgress.set({ current: 20, total: 100, message: 'Analyzing Common Issues...' });
            await this.syncCommonIssues(contentSource, vehicleId, vehicleName);

            // 2. Sync Specialized Silos (Fluids, Parts, Maintenance) - Keep eager/semi-eager for now
            this.syncProgress.set({ current: 50, total: 100, message: 'Syncing Specs & Maintenance...' });
            await Promise.all([
                this.syncFluids(contentSource, vehicleId),
                this.syncMaintenance(contentSource, vehicleId)
            ]);

            // 3. Mark as metadata-ready (not necessarily fully normalized yet)
            await this.supabase.client.from('vehicles').update({
                updated_at: new Date().toISOString()
            }).eq('external_id', vehicleId);

            this.syncProgress.set({ current: 100, total: 100, message: 'Sync Complete!' });
            setTimeout(() => this.isSyncing.set(false), 1000);

        } catch (error) {
            console.error('Sync failed', error);
            this.isSyncing.set(false);
        }
    }

    /**
     * Lazy synchronization: Fetches, processes, and saves a single article 
     * ONLY if it doesn't already exist in Supabase articles table.
     */
    async syncSingleArticle(cs: string, vid: string, item: any): Promise<any> {
        // Construct Article ID properly based on Bucket to normalize
        const parentOrBucket = item.parentBucket || item.bucket || '';
        let normalizedId = item.id;

        if (parentOrBucket.includes('Codes') || parentOrBucket.includes('DTC')) {
            normalizedId = `DTC:${item.code || item.id}`;
        } else if (parentOrBucket.includes('Bulletin') || parentOrBucket.includes('TSB')) {
            normalizedId = `TSB:${item.bulletinNumber || item.id}`;
        } else if (parentOrBucket.includes('Procedures')) {
            normalizedId = `P:${item.id}`;
        }

        // 1. Check if we already have it in Supabase
        const { data: existing } = await this.supabase.client
            .from('articles')
            .select('*')
            .eq('vehicle_id', vid)
            .eq('original_id', item.id)
            .maybeSingle();

        if (existing) {
            console.log(`[DataSync] Serving ${item.id} from Supabase cache`);
            return existing;
        }

        // 2. Fallback to API and Save
        console.log(`[DataSync] Fetching ${item.id} from Motor API for lazy normalization...`);
        const contentRes = await lastValueFrom(this.motorApi.getArticleContent(cs, vid, item.id));
        const rawHtml = (contentRes?.body as any)?.html || '';

        const articleData = {
            id: normalizedId,
            original_id: item.id,
            title: item.title || item.code || '',
            original_content: rawHtml,
            enhanced_content: '',
            vehicle_id: vid,
            source: cs,
            bucket: item.bucket || '',
            parent_bucket: item.parentBucket || '',
            updated_at: new Date().toISOString()
        };

        await this.supabase.client.from('articles').upsert(articleData, { onConflict: 'vehicle_id, original_id' });
        
        return articleData;
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
                });
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
                    name: f.title,
                    value: f.capacity || '',
                    unit: '',
                    display_text: `${f.capacity || ''} - ${f.specification || ''} `,
                    metadata: { id: f.id, bucket: f.bucket, specification: f.specification },
                    updated_at: new Date().toISOString()
                }));
                await this.supabase.client.from('specifications').upsert(specData);
            }
        } catch (e) {
            console.error('Fluids sync failed', e);
        }
    }

    private async syncParts(cs: string, vid: string) {
        try {
            const res = await lastValueFrom(this.motorApi.getParts(cs, vid));
            const parts = res.body?.data || [];
            if (parts.length > 0) {
                const partData = parts.map((p: any) => ({
                    vehicle_id: vid,
                    part_number: p.partNumber,
                    description: p.description,
                    manufacturer: p.manufacturer,
                    list_price: p.listPrice,
                    dealer_price: p.dealerPrice,
                    updated_at: new Date().toISOString()
                }));
                await this.supabase.client.from('parts').upsert(partData);
            }
        } catch (e) {
            console.error('Parts sync failed', e);
        }
    }

    private async syncMaintenance(cs: string, vid: string) {
        try {
            const intervals = [5000, 10000, 15000, 30000, 60000, 100000];
            const allSchedules: any[] = [];

            for (const interval of intervals) {
                try {
                    const res = await lastValueFrom(this.motorApi.getMaintenanceByIntervals(cs, vid, 'miles', interval));
                    const schedules = (res.body as any)?.schedules || (res.body as any)?.items || (res.body as any)?.data || [];

                    schedules.forEach((s: any) => {
                        allSchedules.push({
                            vehicle_id: vid,
                            interval_value: interval,
                            interval_unit: 'Miles',
                            action: s.action || 'Inspect/Replace',
                            item: s.description || '',
                            description: s.description || '',
                            updated_at: new Date().toISOString()
                        });
                    });
                } catch (err) {
                    console.warn(`Maintenance fetch failed for interval ${interval} `, err);
                }
            }

            if (allSchedules.length > 0) {
                await this.supabase.client.from('maintenance_schedules').upsert(allSchedules);
            }
        } catch (e) {
            console.error('Maintenance sync failed', e);
        }
    }
}
