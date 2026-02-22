import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../environments/environment';
import { from, Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { NormalizedProcedure, NormalizedVehicle, NormalizedTSB, NormalizedDTC, NormalizedMaintenanceSchedule, NormalizedLabor, NormalizedPart, NormalizedSpecification } from '../models/normalized_schema';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient | null = null;
  private isConfigured = false;

  constructor() {
    this.initializeClient();
  }

  private initializeClient() {
    // Check if configuration exists and has valid values (not placeholder)
    if (environment.supabase &&
        environment.supabase.url &&
        environment.supabase.url !== 'https://PLACEHOLDER_PROJECT_ID.supabase.co' &&
        environment.supabase.key) {
      try {
        this.supabase = createClient(environment.supabase.url, environment.supabase.key);
        this.isConfigured = true;
        console.log('[SupabaseService] Client initialized successfully');
      } catch (err) {
        console.error('[SupabaseService] Failed to initialize client:', err);
        this.isConfigured = false;
      }
    } else {
      console.warn('[SupabaseService] Configuration missing or invalid (placeholder URL detected). Caching disabled.');
      this.isConfigured = false;
    }
  }

  get isEnabled(): boolean {
    return this.isConfigured && !!this.supabase;
  }

  // --- Generic Helpers ---

  /**
   * Helper to execute a query securely and handle errors
   */
  private async executeQuery<T>(queryPromise: PromiseLike<any>): Promise<T | null> {
    if (!this.isEnabled) return null;
    try {
      const { data, error } = await queryPromise;
      if (error) {
        console.error('[SupabaseService] Query Error:', error);
        return null;
      }
      return data as T;
    } catch (err) {
      console.error('[SupabaseService] Unexpected Error:', err);
      return null;
    }
  }

  // --- Vehicles ---

  getVehicleByExternalId(externalId: string): Observable<NormalizedVehicle | null> {
    if (!this.isEnabled || !this.supabase) return of(null);

    return from(this.executeQuery<NormalizedVehicle[]>(
      this.supabase.from('vehicles').select('*').eq('external_id', externalId).limit(1)
    )).pipe(
      map(data => (data && data.length > 0) ? data[0] : null),
      catchError(() => of(null))
    );
  }

  async insertVehicle(vehicle: NormalizedVehicle): Promise<NormalizedVehicle | null> {
    if (!this.isEnabled || !this.supabase) return null;

    const result = await this.executeQuery<NormalizedVehicle[]>(
      this.supabase.from('vehicles').insert(vehicle).select()
    );
    return (result && result.length > 0) ? result[0] : null;
  }

  // --- Procedures (Articles) ---

  getProcedureByExternalId(externalId: string): Observable<NormalizedProcedure | null> {
    if (!this.isEnabled || !this.supabase) return of(null);

    // TODO: Join with required parts/tools if normalized into other tables
    // For now assuming JSONB columns in 'procedures' table as per schema
    return from(this.executeQuery<NormalizedProcedure[]>(
      this.supabase.from('procedures').select('*').eq('external_id', externalId).limit(1)
    )).pipe(
      map(data => (data && data.length > 0) ? data[0] : null),
      catchError(() => of(null))
    );
  }

  async insertProcedure(procedure: NormalizedProcedure): Promise<NormalizedProcedure | null> {
    if (!this.isEnabled || !this.supabase) return null;

    const result = await this.executeQuery<NormalizedProcedure[]>(
      this.supabase.from('procedures').insert(procedure).select()
    );
    return (result && result.length > 0) ? result[0] : null;
  }

  // --- TSBs ---

  getTSBByBulletinNumber(bulletinNumber: string): Observable<NormalizedTSB | null> {
    if (!this.isEnabled || !this.supabase) return of(null);

    return from(this.executeQuery<NormalizedTSB[]>(
      this.supabase.from('tsbs').select('*').eq('bulletin_number', bulletinNumber).limit(1)
    )).pipe(
      map(data => (data && data.length > 0) ? data[0] : null),
      catchError(() => of(null))
    );
  }

  async insertTSB(tsb: NormalizedTSB): Promise<NormalizedTSB | null> {
    if (!this.isEnabled || !this.supabase) return null;

    const result = await this.executeQuery<NormalizedTSB[]>(
      this.supabase.from('tsbs').insert(tsb).select()
    );
    return (result && result.length > 0) ? result[0] : null;
  }

  // --- DTCs ---

  getDTCByCode(code: string, vehicleId: string): Observable<NormalizedDTC | null> {
    if (!this.isEnabled || !this.supabase) return of(null);

    return from(this.executeQuery<NormalizedDTC[]>(
      this.supabase.from('dtcs').select('*').eq('code', code).eq('vehicle_id', vehicleId).limit(1)
    )).pipe(
      map(data => (data && data.length > 0) ? data[0] : null),
      catchError(() => of(null))
    );
  }

  async insertDTC(dtc: NormalizedDTC): Promise<NormalizedDTC | null> {
    if (!this.isEnabled || !this.supabase) return null;

    const result = await this.executeQuery<NormalizedDTC[]>(
      this.supabase.from('dtcs').insert(dtc).select()
    );
    return (result && result.length > 0) ? result[0] : null;
  }

  // --- Maintenance ---

  getMaintenanceSchedules(vehicleId: string): Observable<NormalizedMaintenanceSchedule[]> {
    if (!this.isEnabled || !this.supabase) return of([]);

    return from(this.executeQuery<NormalizedMaintenanceSchedule[]>(
        this.supabase.from('maintenance_schedules').select('*').eq('vehicle_id', vehicleId)
    )).pipe(
        map(data => data || []),
        catchError(() => of([]))
    );
  }

  async insertMaintenanceSchedules(schedules: NormalizedMaintenanceSchedule[]): Promise<NormalizedMaintenanceSchedule[] | null> {
      if (!this.isEnabled || !this.supabase || schedules.length === 0) return null;

      const result = await this.executeQuery<NormalizedMaintenanceSchedule[]>(
          this.supabase.from('maintenance_schedules').insert(schedules).select()
      );
      return result;
  }

  // --- Generic Bulk Insert ---
  // Useful for batch processing parts, labor, etc.
  async bulkInsert<T>(table: string, items: T[]): Promise<T[] | null> {
      if (!this.isEnabled || !this.supabase || items.length === 0) return null;

      const result = await this.executeQuery<T[]>(
          this.supabase.from(table).insert(items).select()
      );
      return result;
  }
}
