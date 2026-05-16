import { Injectable } from '@angular/core';
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
    getAuth,
    Auth,
    User,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    GoogleAuthProvider,
    signOut,
    sendPasswordResetEmail,
    onAuthStateChanged,
    Unsubscribe
} from 'firebase/auth';
import { environment } from '../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class FirebaseService {
    private app: FirebaseApp;
    private _auth: Auth;

    constructor() {
        // Avoid re-initializing if already set up (e.g. hot-reload)
        this.app = getApps().length
            ? getApps()[0]
            : initializeApp(environment.firebase);
        this._auth = getAuth(this.app);
    }

    get auth(): Auth {
        return this._auth;
    }

    async getCurrentUser(): Promise<User | null> {
        return this._auth.currentUser;
    }

    onAuthStateChange(callback: (user: User | null) => void): Unsubscribe {
        return onAuthStateChanged(this._auth, callback);
    }

    async signUpWithEmail(email: string, password: string) {
        return createUserWithEmailAndPassword(this._auth, email, password);
    }

    async signInWithEmail(email: string, password: string) {
        return signInWithEmailAndPassword(this._auth, email, password);
    }

    async signInWithGoogle() {
        const provider = new GoogleAuthProvider();
        // Try popup first; fall back to redirect when COOP blocks cross-window
        // comms (Vite/esbuild dev server sets COOP: same-origin by default).
        try {
            return await signInWithPopup(this._auth, provider);
        } catch (e: any) {
            const transient = ['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request'];
            if (transient.includes(e?.code) || /Cross-Origin-Opener-Policy/i.test(String(e?.message || ''))) {
                await signInWithRedirect(this._auth, provider);
                return null; // result is picked up by getRedirectResult() on page load
            }
            throw e;
        }
    }

    /** Call once on app boot to complete a redirect-based sign-in. */
    async resolveRedirectResult() {
        try {
            return await getRedirectResult(this._auth);
        } catch {
            return null;
        }
    }

    async signOut() {
        return signOut(this._auth);
    }

    async resetPassword(email: string) {
        return sendPasswordResetEmail(this._auth, email, {
            url: `${window.location.origin}/reset-password`
        });
    }

    /**
     * Returns a fresh Firebase ID token for the current user.
     * Firebase caches and auto-refreshes tokens (1-hour TTL).
     * forceRefresh=true fetches a new token even if current one is valid.
     */
    async getIdToken(forceRefresh = false): Promise<string | null> {
        const user = this._auth.currentUser;
        if (!user) return null;
        return user.getIdToken(forceRefresh);
    }
}
