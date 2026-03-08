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

    async syncFullVehicle(contentSource: string, vehicleId: string, vehicleName: string): Promise<void> {
        if (this.isSyncing()) return;

        this.isSyncing.set(true);
        this.syncProgress.set({ current: 0, total: 100, message: 'Starting Sync...' });

        try {
            // 1. Common Issues (AI) - Now async logic using Supabase
            this.syncProgress.set({ current: 1, total: 100, message: 'Analyzing Common Issues...' });
            await this.syncCommonIssues(contentSource, vehicleId, vehicleName);

            // 2. Fetch All Articles
            this.syncProgress.set({ current: 5, total: 100, message: 'Fetching Data Lists...' });
            const searchResults = await lastValueFrom(this.motorApi.searchArticles(contentSource, vehicleId, ''));
            const allItems = searchResults?.body?.articleDetails || [];

            const totalItems = allItems.length;
            let processed = 0;

            console.log(`Starting massive sync for ${totalItems} items...`);

            await lastValueFrom(from(allItems).pipe(
                mergeMap(item => {
                    return this.fetchAndSaveContent(contentSource, vehicleId, item).pipe(
                        tap(() => {
                            processed++;
                            const percent = Math.round((processed / totalItems) * 90) + 10;
                            this.syncProgress.set({
                                current: percent,
                                total: 100,
                                message: `Downloading ${processed}/${totalItems} items...`
                            });
                        }),
                        catchError(err => {
                            console.error(`Failed to sync item ${item.id}`, err);
                            return of(null);
                        })
                    );
                }, 5) // Concurrency: 5
            ));

            this.syncProgress.set({ current: 100, total: 100, message: 'Sync Complete!' });
            setTimeout(() => this.isSyncing.set(false), 2000);

        } catch (error) {
            console.error('Sync failed', error);
            this.syncProgress.set({ current: 0, total: 100, message: 'Sync Failed!' });
            this.isSyncing.set(false);
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
                });
            }
        }
    }

    private fetchAndSaveContent(cs: string, vid: string, item: any) {
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

        // Write-over fetch & save logic
        return this.motorApi.getArticleContent(cs, vid, item.id).pipe(
            concatMap(contentRes => {
                const articleData = {
                    id: normalizedId,
                    original_id: item.id,
                    title: item.title || item.code || '',
                    original_content: contentRes.body?.html || '',
                    enhanced_content: '',
                    vehicle_id: vid,
                    source: cs,
                    bucket: item.bucket || '',
                    parent_bucket: item.parentBucket || '',
                    updated_at: new Date().toISOString()
                };

                return from(this.supabase.client.from('articles').upsert(articleData, { onConflict: 'vehicle_id, original_id' }));
            })
        );
    }
}
