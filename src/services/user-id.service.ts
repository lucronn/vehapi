import { Injectable, inject, computed } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * Provides a stable User ID for the application.
 * - If the user is authenticated via Supabase, returns their Supabase UUID.
 * - Otherwise, returns an anonymous local ID stored in localStorage as fallback.
 */
@Injectable({
    providedIn: 'root'
})
export class UserIdService {
    private authService = inject(AuthService);
    private readonly STORAGE_KEY = 'torque_user_id';

    /** Returns the currently active user ID (Supabase UUID or anonymous local ID). */
    readonly userId = computed(() => {
        const supabaseId = this.authService.userId();
        if (supabaseId) return supabaseId;
        return this.getOrCreateAnonymousId();
    });

    /** @deprecated Use `userId` signal instead */
    getUserId(): string {
        return this.userId();
    }

    private getOrCreateAnonymousId(): string {
        let id = localStorage.getItem(this.STORAGE_KEY);
        if (!id) {
            id = this.generateId();
            localStorage.setItem(this.STORAGE_KEY, id);
        }
        return id;
    }

    private generateId(): string {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return 'user_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    }
}
