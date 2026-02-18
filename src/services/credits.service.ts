
import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { UserIdService } from './user-id.service';
import { environment } from '../environments/environment';

export interface UnlockMap {
    [vehicleId: string]: string[]; // 'specs', 'procedures', 'full', etc.
}

@Injectable({
    providedIn: 'root'
})
export class CreditsService {
    private http = inject(HttpClient);
    private userIdService = inject(UserIdService);

    // State
    balance = signal<number>(100); // Mock initial balance
    unlocks = signal<UnlockMap>({});
    isLoading = signal<boolean>(false);

    // Constants
    readonly COSTS = {
        SPECS: 5,
        FLUIDS: 5,
        PROCEDURES: 10,
        DIAGRAMS: 10,
        FULL_ACCESS: 25 // Per vehicle
    };

    private get headers() {
        return new HttpHeaders().set('x-user-id', this.userIdService.getUserId());
    }

    private get apiUrl() {
        // Determine API URL based on environment (similar to other services)
        return environment.production
            ? 'https://vehapi-gx7nz7bkv-curtt.vercel.app/api/credits' // Production Backend
            : '/api/credits'; // Local Proxy/Dev
    }

    constructor() {
        this.refreshBalance();
    }

    async refreshBalance() {
        // MOCK: Commented out HTTP call
        /*
        try {
            const data = await firstValueFrom(
                this.http.get<{ credits: number, unlocks: UnlockMap }>(
                    `${this.apiUrl}/balance`,
                    { headers: this.headers }
                )
            );
            this.balance.set(data.credits);
            this.unlocks.set(data.unlocks);
        } catch (error) {
            console.error('Failed to fetch credit balance:', error);
        }
        */
        // MOCK Implementation
        console.log('Mock: Refreshing balance to 100');
        // We keep the current balance if it's already set, or default to 100 if we want to reset
        // For now, let's just leave it as is or maybe reset to 100 if we want a fresh start
        // this.balance.set(100);
    }

    async startCheckout(amount: number) {
        this.isLoading.set(true);
        // MOCK: Commented out HTTP call
        /*
        try {
            // Price IDs should ideally be from config/env, here we mock mapped to amounts
            // In reality, you'd pass a priceId corresponding to the package (e.g. 50 credits)
            const priceId = 'price_1Q...'; // TODO: Replace with real Stripe Price ID for "Credits"

            const res = await firstValueFrom(
                this.http.post<{ url: string }>(
                    `${this.apiUrl}/checkout`,
                    { amount, priceId },
                    { headers: this.headers }
                )
            );

            if (res.url) {
                window.location.href = res.url;
            }
        } catch (error) {
            console.error('Checkout failed:', error);
            alert('Failed to start checkout. Please try again.');
        } finally {
            this.isLoading.set(false);
        }
        */

        // MOCK Implementation
        setTimeout(() => {
            this.balance.update(b => b + amount);
            alert(`Mock Checkout: Successfully added ${amount} credits!`);
            this.isLoading.set(false);
        }, 1000); // Simulate network delay
    }

    async unlockModule(vehicleId: string, moduleType: string, cost: number): Promise<boolean> {
        if (this.balance() < cost) {
            return false;
        }

        this.isLoading.set(true);

        // MOCK: Commented out HTTP call
        /*
        try {
            const res = await firstValueFrom(
                this.http.post<{ success: true, credits: number, unlocks: UnlockMap }>(
                    `${this.apiUrl}/unlock`,
                    { vehicleId, moduleType, cost },
                    { headers: this.headers }
                )
            );

            if (res.success) {
                this.balance.set(res.credits);
                this.unlocks.set(res.unlocks);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Unlock failed:', error);
            return false;
        } finally {
            this.isLoading.set(false);
        }
        */

        // MOCK Implementation
        return new Promise((resolve) => {
            setTimeout(() => {
                this.balance.update(b => b - cost);
                this.unlocks.update(u => {
                    const vehicleUnlocks = u[vehicleId] || [];
                    if (!vehicleUnlocks.includes(moduleType)) {
                        vehicleUnlocks.push(moduleType);
                    }
                    return { ...u, [vehicleId]: vehicleUnlocks };
                });
                this.isLoading.set(false);
                resolve(true);
            }, 500);
        });
    }

    hasAccess(vehicleId: string, moduleType: string): boolean {
        const vehicleUnlocks = this.unlocks()[vehicleId] || [];
        return vehicleUnlocks.includes('full') || vehicleUnlocks.includes(moduleType);
    }
}
