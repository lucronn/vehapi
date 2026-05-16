/**
 * ApiDataService — replaces direct Supabase PostgREST calls with requests to
 * the vehapiproxi /api/data/:table endpoint.
 *
 * Provides a Supabase-compatible chainable query interface so existing service
 * code needs minimal changes:
 *
 *   Before: supabase.client.from('articles').select('*').eq('vehicle_id', vehicleId)
 *   After:  api.from('articles').select('*').eq('vehicle_id', vehicleId)
 *
 * The query is built lazily and executed when awaited or subscribed (thenable).
 */
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

// ---------------------------------------------------------------------------
// Query builder — mirrors the Supabase PostgREST chained API shape used in this app
// ---------------------------------------------------------------------------

interface QueryResult<T = any> {
    data: T[] | null;
    count: number | null;
    error: { message: string } | null;
}

class ApiQuery<T = any> {
    private _table: string;
    private _select = '*';
    private _filters: Record<string, string> = {};
    private _limit: number | null = null;
    private _countOnly = false;
    private _http: HttpClient;
    private _baseUrl: string;

    constructor(table: string, http: HttpClient, baseUrl: string) {
        this._table = table;
        this._http = http;
        this._baseUrl = baseUrl;
    }

    select(cols: string, opts?: { head?: boolean; count?: 'exact' }): this {
        this._select = cols;
        if (opts?.head || opts?.count === 'exact') this._countOnly = true;
        return this;
    }

    eq(column: string, value: string | number): this {
        this._filters[column] = String(value);
        return this;
    }

    limit(n: number): this {
        this._limit = n;
        return this;
    }

    // Make the query thenable so existing code can `await` it directly
    then<TResult1 = QueryResult<T>, TResult2 = never>(
        onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
        return this._execute().then(onfulfilled, onrejected);
    }

    private async _execute(): Promise<QueryResult<T>> {
        try {
            let params = new HttpParams();
            if (this._select && this._select !== '*') {
                params = params.set('select', this._select);
            }
            for (const [k, v] of Object.entries(this._filters)) {
                params = params.set(k, v);
            }
            if (this._limit !== null) {
                params = params.set('limit', String(this._limit));
            }
            if (this._countOnly) {
                params = params.set('count', '1');
                const res = await firstValueFrom(
                    this._http.get<{ count: number }>(`${this._baseUrl}/data/${this._table}`, { params })
                );
                return { data: null, count: res.count ?? 0, error: null };
            }

            const res = await firstValueFrom(
                this._http.get<{ data: T[]; count: number }>(`${this._baseUrl}/data/${this._table}`, { params })
            );
            return { data: res.data ?? [], count: res.count ?? 0, error: null };
        } catch (err: any) {
            const message = err?.error?.error || err?.message || 'Request failed';
            return { data: null, count: null, error: { message } };
        }
    }
}

// ---------------------------------------------------------------------------
// Upsert builder
// ---------------------------------------------------------------------------

class ApiUpsert {
    private _http: HttpClient;
    private _baseUrl: string;
    private _table: string;
    private _onConflict: string | null = null;

    constructor(table: string, http: HttpClient, baseUrl: string) {
        this._table = table;
        this._http = http;
        this._baseUrl = baseUrl;
    }

    onConflict(cols: string): this {
        this._onConflict = cols;
        return this;
    }

    async execute(rows: object | object[]): Promise<{ error: { message: string } | null }> {
        try {
            const body: any = { rows: Array.isArray(rows) ? rows : [rows] };
            if (this._onConflict) body.onConflict = this._onConflict;
            await firstValueFrom(
                this._http.post<any>(`${this._baseUrl}/data/${this._table}`, body)
            );
            return { error: null };
        } catch (err: any) {
            return { error: { message: err?.error?.error || err?.message || 'Upsert failed' } };
        }
    }

    then<TResult1 = { error: null }, TResult2 = never>(
        onfulfilled?: ((v: { error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
        return this.execute({}).then(onfulfilled, onrejected);
    }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class ApiDataService {
    private http = inject(HttpClient);
    private baseUrl = environment.apiUrl;

    /**
     * Start a read query. Mirrors supabase.client.from(table).select(...).eq(...)
     * Usage:
     *   const { data, error } = await this.api.from('articles').select('*').eq('vehicle_id', id)
     */
    from<T = any>(table: string): ApiQuery<T> {
        return new ApiQuery<T>(table, this.http, this.baseUrl);
    }

    /**
     * Upsert rows into a table.
     * Usage:
     *   await this.api.upsert('vehicles', { external_id: id, ... }, 'external_id')
     */
    async upsert(
        table: string,
        rows: object | object[],
        onConflict?: string
    ): Promise<{ error: { message: string } | null }> {
        const builder = new ApiUpsert(table, this.http, this.baseUrl);
        if (onConflict) builder.onConflict(onConflict);
        return builder.execute(rows);
    }
}
