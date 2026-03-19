import { Injectable, signal, computed, inject } from '@angular/core';
import { User, Session } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private supabase = inject(SupabaseService);

    // Reactive state
    private _user = signal<User | null>(null);
    private _session = signal<Session | null>(null);
    private _loading = signal(true);

    // Public readonly signals
    readonly user = this._user.asReadonly();
    readonly session = this._session.asReadonly();
    readonly loading = this._loading.asReadonly();
    readonly isLoggedIn = computed(() => !!this._user());
    readonly userId = computed(() => this._user()?.id ?? null);

    private setSessionState(session: Session | null) {
        const currentSession = this._session();
        const currentUser = this._user();
        const currentUserId = currentUser?.id ?? null;
        const nextUserId = session?.user?.id ?? null;
        const currentToken = currentSession?.access_token ?? null;
        const nextToken = session?.access_token ?? null;

        // Avoid emitting duplicate signal updates for equivalent auth state.
        // This prevents dependent effects from re-triggering on every token read.
        if (currentUserId === nextUserId && currentToken === nextToken) {
            if (this._loading()) this._loading.set(false);
            return;
        }

        this._session.set(session);
        this._user.set(session?.user ?? null);
        this._loading.set(false);
    }

    constructor() {
        // Initialize session on startup
        this.supabase.getSession().then(session => {
            this.setSessionState(session);
        });

        // Listen for auth state changes
        this.supabase.onAuthStateChange((event, session) => {
            this.setSessionState(session);
        });
    }

    async signUpWithEmail(email: string, password: string) {
        const { data, error } = await this.supabase.signUpWithEmail(email, password);
        if (error) throw error;
        return data;
    }

    async signInWithEmail(email: string, password: string) {
        const { data, error } = await this.supabase.signInWithEmail(email, password);
        if (error) throw error;
        return data;
    }

    async signInWithGoogle() {
        const { data, error } = await this.supabase.signInWithGoogle();
        if (error) throw error;
        return data;
    }

    async signOut() {
        const { error } = await this.supabase.signOut();
        if (error) throw error;
    }

    async resetPassword(email: string) {
        const { error } = await this.supabase.resetPassword(email);
        if (error) throw error;
    }

    /** For CreditsService and HTTP interceptor: return access token for API auth (Supabase session).
     * Fetches fresh session from Supabase and refreshes if expired, so article/content requests
     * always have a valid Bearer token for the backend. */
    async getIdToken(): Promise<string | null> {
        const session = await this.supabase.getSession();
        if (!session) {
            this.setSessionState(null);
            return null;
        }

        // Always hydrate signals from the current session, even if we don't refresh.
        // This prevents auth-hydration races (e.g. right after Stripe redirect) where
        // a valid session exists but `authService.user()` is still null.
        this.setSessionState(session);

        // Refresh if token expires in < 60 seconds
        const expiresAt = session.expires_at;
        if (expiresAt && expiresAt * 1000 < Date.now() + 60000) {
            const { data } = await this.supabase.auth.refreshSession();
            if (data.session) {
                this.setSessionState(data.session);
                return data.session.access_token;
            }
        }

        return session.access_token;
    }
}
