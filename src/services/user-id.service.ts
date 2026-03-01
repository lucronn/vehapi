
import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class UserIdService {
    private readonly STORAGE_KEY = 'torque_user_id';
    private userId: string | null = null;

    constructor() {
        this.userId = localStorage.getItem(this.STORAGE_KEY);
        if (!this.userId) {
            this.userId = this.generateId();
            localStorage.setItem(this.STORAGE_KEY, this.userId);
        }
    }

    getUserId(): string {
        return this.userId!;
    }

    private generateId(): string {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return 'user_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    }
}
