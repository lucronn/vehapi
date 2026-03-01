import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, Session, User, AuthChangeEvent } from '@supabase/supabase-js';
import { environment } from '../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class SupabaseService {
    private supabase: SupabaseClient;

    constructor() {
        this.supabase = createClient(
            environment.supabase.url,
            environment.supabase.anonKey
        );
    }

    get client(): SupabaseClient {
        return this.supabase;
    }

    get auth() {
        return this.supabase.auth;
    }

    async getSession(): Promise<Session | null> {
        const { data } = await this.supabase.auth.getSession();
        return data.session;
    }

    async getUser(): Promise<User | null> {
        const { data } = await this.supabase.auth.getUser();
        return data.user;
    }

    onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
        return this.supabase.auth.onAuthStateChange(callback);
    }

    async signUpWithEmail(email: string, password: string) {
        return this.supabase.auth.signUp({ email, password });
    }

    async signInWithEmail(email: string, password: string) {
        return this.supabase.auth.signInWithPassword({ email, password });
    }

    async signInWithGoogle() {
        return this.supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin }
        });
    }

    async signOut() {
        return this.supabase.auth.signOut();
    }

    async resetPassword(email: string) {
        return this.supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`
        });
    }
}
