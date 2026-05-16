/**
 * SupabaseService — data-only client (auth removed; handled by FirebaseService).
 *
 * This client is retained for legacy write operations in data-sync.service.ts
 * that have not yet been migrated to ApiDataService. These writes target the
 * old Supabase project and are effectively no-ops — all new data goes to
 * Cloud SQL via vehapiproxi. Phase 2 migration will remove this service entirely.
 */
import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../environments/environment';

// Minimal Supabase config — used only for legacy data writes in data-sync.service
// Auth is handled by FirebaseService. Remove when data-sync migration is complete.
const LEGACY_SUPABASE_URL  = 'https://jzwhcoivwzumqrfscnlw.supabase.co';
const LEGACY_SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6d2hjb2l2d3p1bXFyZnNjbmx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODcxOTAsImV4cCI6MjA4NzE2MzE5MH0.B43gsM5l0bQNxtMOPUbPu8lrl87QBGPgrTPm66fdewI';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
    private _client: SupabaseClient = createClient(LEGACY_SUPABASE_URL, LEGACY_SUPABASE_KEY);

    /** Supabase JS client — for legacy data writes only. Do not use for auth. */
    get client(): SupabaseClient {
        return this._client;
    }
}
