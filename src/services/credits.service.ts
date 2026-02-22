
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

    // Set this to true to use local storage instead of backend
    private readonly USE_MOCK = false;
    private readonly STORAGE_KEYS = {
        BALANCE: 'torque_mock_balance',
        UNLOCKS: 'torque_mock_unlocks'
    };

    // State
    balance = signal<number>(10); // Starting credits - enough for one unlock
    unlocks = signal<UnlockMap>({});
    isLoading = signal<boolean>(false);

    // Constants
    readonly COSTS = {
        SPECS: 5,
        FLUIDS: 5,
        MAINTENANCE: 5,
        COMMON_ISSUES: 5,
        DTC: 5,
        TSB: 5,
        PROCEDURES: 10,
        DIAGRAMS: 10,
        PARTS: 10,
        FULL_ACCESS: 25 // Per vehicle
    };

    private get headers() {
        return new HttpHeaders().set('x-user-id', this.userIdService.getUserId());
    }

    private get apiUrl() {
        return environment.production
            ? 'https://vehapi-gx7nz7bkv-curtt.vercel.app/api/credits'
            : '/api/credits';
    }

    constructor() {
        this.refreshBalance();
    }

    async refreshBalance() {
        if (this.USE_MOCK) {
            this.loadMockData();
            return;
        }

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
            // Fallback to mock on error if needed, but for now just log
        }
    }

    async startCheckout(amount: number) {
        if (this.USE_MOCK) {
            this.isLoading.set(true);
            setTimeout(() => {
                this.balance.update(b => b + amount);
                this.saveMockData();
                this.isLoading.set(false);
            }, 800);
            return;
        }

        this.isLoading.set(true);
        try {
            const res = await firstValueFrom(
                this.http.post<{ url: string }>(
                    `${this.apiUrl}/checkout`,
                    { amount },
                    { headers: this.headers }
                )
            );

            if (res.url) {
                window.location.href = res.url;
            }
        } catch (error) {
            console.error('Checkout failed:', error);
            // Fallback gracefully without alert on mobile
        } finally {
            this.isLoading.set(false);
        }
    }

    async unlockModule(vehicleId: string, moduleType: string, cost: number): Promise<boolean> {
        if (this.balance() < cost) {
            return false;
        }

        if (this.USE_MOCK) {
            this.isLoading.set(true);
            return new Promise((resolve) => {
                setTimeout(() => {
                    this.balance.update(b => b - cost);
                    const currentUnlocks = { ...this.unlocks() };
                    if (!currentUnlocks[vehicleId]) {
                        currentUnlocks[vehicleId] = [];
                    }
                    if (!currentUnlocks[vehicleId].includes(moduleType)) {
                        currentUnlocks[vehicleId].push(moduleType);
                    }
                    this.unlocks.set(currentUnlocks);
                    this.saveMockData();
                    this.isLoading.set(false);
                    resolve(true);
                }, 500);
            });
        }

        this.isLoading.set(true);

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
    }

    hasAccess(vehicleId: string, moduleType: string): boolean {
        const vehicleUnlocks = this.unlocks()[vehicleId] || [];
        return vehicleUnlocks.includes('full') || vehicleUnlocks.includes(moduleType);
    }

    private loadMockData() {
        const savedBalance = localStorage.getItem(this.STORAGE_KEYS.BALANCE);
        const savedUnlocks = localStorage.getItem(this.STORAGE_KEYS.UNLOCKS);

        if (savedBalance !== null) {
            this.balance.set(parseInt(savedBalance, 10));
        } else {
            // Default starting balance for testing
            this.balance.set(10);
            this.saveMockData();
        }

        if (savedUnlocks) {
            try {
                this.unlocks.set(JSON.parse(savedUnlocks));
            } catch (e) {
                this.unlocks.set({});
            }
        }
    }

    private saveMockData() {
        localStorage.setItem(this.STORAGE_KEYS.BALANCE, this.balance().toString());
        localStorage.setItem(this.STORAGE_KEYS.UNLOCKS, JSON.stringify(this.unlocks()));
    }
}
