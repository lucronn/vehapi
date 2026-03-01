import { Injectable, inject, signal } from '@angular/core';
import { forkJoin, from, lastValueFrom, of } from 'rxjs';
import { catchError, concatMap, map, mergeMap, tap, toArray } from 'rxjs/operators';
import { MotorApiService } from './motor-api.service';
import { FirebaseService } from './firebase.service';
// import { GeminiService } from './gemini.service'; // Removed

@Injectable({
    providedIn: 'root'
})
export class DataSyncService {
    private motorApi = inject(MotorApiService);
    private firebase = inject(FirebaseService);
    // private geminiApi = inject(GeminiService); // Removed

    // Sync State
    isSyncing = signal(false);
    syncProgress = signal({ current: 0, total: 0, message: 'Ready' });

    async syncFullVehicle(contentSource: string, vehicleId: string, vehicleName: string): Promise<void> {
        return; // DATABASE SYNC DISABLED - Legacy Mode
        if (this.isSyncing()) return;

        this.isSyncing.set(true);
        this.syncProgress.set({ current: 0, total: 100, message: 'Starting Sync...' });

        try {
            // 1. Common Issues (AI)
            this.syncProgress.set({ current: 1, total: 100, message: 'Analyzing Common Issues...' });
            await this.syncCommonIssues(contentSource, vehicleId, vehicleName);

            // 2. Fetch All Lists
            this.syncProgress.set({ current: 5, total: 100, message: 'Fetching Data Lists...' });
            const lists = await lastValueFrom(forkJoin({
                // dtcs: this.motorApi.getDtcs(contentSource, vehicleId), // REMOVED API
                // tsbs: this.motorApi.getTsbs(contentSource, vehicleId), // REMOVED API
                // procedures: this.motorApi.getProcedures(contentSource, vehicleId), // REMOVED API
                // diagrams: this.motorApi.getAllDiagrams(contentSource, vehicleId), // REMOVED API
                fluids: this.motorApi.getFluids(contentSource, vehicleId),
                // specs: this.motorApi.getSpecs(contentSource, vehicleId), // REMOVED API
                parts: this.motorApi.getParts(contentSource, vehicleId, ''),
                // labor: this.motorApi.getLaborOperations(contentSource, vehicleId) // REMOVED API
            }));

            // 3. Save Lists to Firebase
            await Promise.all([
                // this.firebase.saveDtcList(contentSource, vehicleId, lists.dtcs.body.data),
                // this.firebase.saveTsbList(contentSource, vehicleId, lists.tsbs.body.data),
                // this.firebase.saveProcedureList(contentSource, vehicleId, lists.procedures.body.data),
                // Add others once FirebaseService is updated
            ]);

            // 4. Calculate Total Work for Content Sync
            const allItems: any[] = [
                // ...lists.dtcs.body.data.map((i: any) => ({ ...i, type: 'dtc' })),
                // ...lists.tsbs.body.data.map((i: any) => ({ ...i, type: 'tsb' })),
                // Sync ALL procedures as per user request
                // ...lists.procedures.body.data.map((i: any) => ({ ...i, type: 'procedure' })),
            ];

            const totalItems = allItems.length;
            let processed = 0;

            // 5. Heavy Lift: Sync Content for items
            // We process in chunks to verify concurrency
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
        return; // DATABASE SYNC DISABLED
        /*
        // Check cache first
        const cached = await this.firebase.getCommonIssues(cs, vid);
        if (!cached) {
            // const issues = await lastValueFrom(this.geminiApi.findCommonIssues(name)); // AI DISABLED
            // await this.firebase.saveCommonIssues(cs, vid, issues);
            console.log('Skipping Common Issues Sync (AI Disabled)');
        }
        */
    }

    private fetchAndSaveContent(cs: string, vid: string, item: any) {
        // If it's already cached, skip?
        // Ideally yes, but checking cache for 1000 items is also 1000 reads.
        // Maybe just write-over? Or check `firebase.getArticle`?
        // Let's blindly fetch & save for now, ensuring we have latest.
        // Actually, `motorApi.getArticleContent` is what we need.

        // Construct Article ID properly.
        // DTCs IDs are usually "DTC:..." in the list.
        // TSBs IDs are "TSB:..."
        // Procedures are "P:..."

        return this.motorApi.getArticleContent(cs, vid, item.id).pipe(
            concatMap(contentRes => {
                return from(this.firebase.saveArticle({
                    id: item.id,
                    title: item.title || item.code || '',
                    originalContent: contentRes.body.html,
                    enhancedContent: '',
                    vehicleId: vid,
                    source: cs,
                    timestamp: Date.now()
                }));
            })
        );
    }
}
