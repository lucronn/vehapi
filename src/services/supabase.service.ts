/**
 * SupabaseService — NO-OP STUB.
 *
 * The old Supabase project is decommissioned. All data is in Cloud SQL,
 * accessed via the vehapiproxi backend. This stub satisfies the
 * SupabaseClient type so existing callers in data-sync.service.ts continue
 * to compile, but every call is a silent no-op returning empty results.
 *
 * TODO: Remove this file and all callers in a follow-up refactor.
 */
import { Injectable } from '@angular/core';

/** Minimal fluent builder that mimics the Supabase JS client API surface. */
function makeNoOpBuilder(): any {
    const noop: any = new Proxy(
        async () => ({ data: null, error: null, count: 0 }),
        {
            get(_target, _prop) {
                return noop;
            },
            apply() {
                return Promise.resolve({ data: null, error: null, count: 0 });
            }
        }
    );
    return noop;
}

/** No-op Supabase client stub — all methods return empty/null results immediately. */
const NO_OP_CLIENT: any = new Proxy(
    {},
    {
        get(_target, prop) {
            if (prop === 'from' || prop === 'rpc' || prop === 'storage') {
                return () => makeNoOpBuilder();
            }
            return () => Promise.resolve({ data: null, error: null, count: 0 });
        }
    }
);

@Injectable({ providedIn: 'root' })
export class SupabaseService {
    /** No-op client stub — all queries silently return empty results. */
    get client(): any {
        return NO_OP_CLIENT;
    }
}
