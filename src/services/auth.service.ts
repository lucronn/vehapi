import { Injectable, signal, computed, inject } from '@angular/core';
import { User } from 'firebase/auth';
import { FirebaseService } from './firebase.service';

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private firebase = inject(FirebaseService);

    // Reactive state
    private _user = signal<User | null>(null);
    private _loading = signal(true);

    // Public readonly signals
    readonly user = this._user.asReadonly();
    readonly loading = this._loading.asReadonly();
    readonly isLoggedIn = computed(() => !!this._user());
    /** Firebase UID — used as userId across credits, interceptor, and data services. */
    readonly userId = computed(() => this._user()?.uid ?? null);
    /** User email — for display in UI. */
    readonly userEmail = computed(() => this._user()?.email ?? null);

    constructor() {
        // Subscribe to Firebase auth state — fires immediately with current user then on every change
        this.firebase.onAuthStateChange((user) => {
            this._user.set(user);
            this._loading.set(false);
        });
        // Complete any pending redirect-based sign-in (Google fallback path)
        this.firebase.resolveRedirectResult();
    }

    async signUpWithEmail(email: string, password: string) {
        const result = await this.firebase.signUpWithEmail(email, password);
        return result.user;
    }

    async signInWithEmail(email: string, password: string) {
        const result = await this.firebase.signInWithEmail(email, password);
        return result.user;
    }

    async signInWithGoogle() {
        const result = await this.firebase.signInWithGoogle();
        return result.user;
    }

    async signOut() {
        await this.firebase.signOut();
    }

    async resetPassword(email: string) {
        await this.firebase.resetPassword(email);
    }

    /**
     * Returns a valid Firebase ID token for the current user.
     * Firebase SDK automatically refreshes the token when it expires (1-hour TTL).
     * Used by the auth interceptor to attach Bearer tokens to API requests.
     */
    async getIdToken(): Promise<string | null> {
        const user = this._user();
        if (!user) return null;
        return user.getIdToken();
    }
}
