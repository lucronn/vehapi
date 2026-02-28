
import { Injectable, signal, inject, effect } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { UserIdService } from './user-id.service';
import { AuthService } from './auth.service';
import { environment } from '../environments/environment';

export interface UnlockMap {
    [vehicleId: string]: string[];
}

export interface Transaction {
    id: string;
    user_id: string;
    amount: number;
    type: 'purchase' | 'unlock' | 'refund';
    stripe_session_id: string | null;
    stripe_payment_intent: string | null;
    usd_cents: number | null;
    vehicle_id: string | null;
    vehicle_name: string | null;
    module_type: string | null;
    created_at: string;
}

@Injectable({
    providedIn: 'root'
})
export class CreditsService {
    private http = inject(HttpClient);
    private userIdService = inject(UserIdService);
    private authService = inject(AuthService);

    private readonly USE_MOCK = false;
    private readonly STORAGE_KEYS = {
        BALANCE: 'torque_mock_balance',
        UNLOCKS: 'torque_mock_unlocks'
    };

    // State
    balance = signal<number>(0);
    unlocks = signal<UnlockMap>({});
    transactions = signal<Transaction[]>([]);
    isLoading = signal<boolean>(false);
    transactionsLoading = signal<boolean>(false);
    portalLoading = signal<boolean>(false);

    // Constants
    readonly COSTS = {
        SPECS: 5,
        FLUIDS: 5,
        MAINTENANCE: 5,
        DTC: 5,
        TSB: 5,
        PROCEDURES: 10,
        DIAGRAMS: 10,
        PARTS: 10,
        FULL_ACCESS: 25
    };

    private get apiUrl() {
        return environment.production
            ? 'https://vehapiproxi.vercel.app/api/credits'
            : '/api/credits';
    }

    constructor() {
        // Automatically refresh balance when user logs in
        effect(() => {
            const user = this.authService.user();
            if (user) {
                this.refreshBalance();
            } else {
                // Reset state on logout
                this.balance.set(0);
                this.unlocks.set({});
            }
        });
    }

    private async getHeaders(): Promise<HttpHeaders> {
        let headers = new HttpHeaders();
        const user = this.authService.user();

        if (user) {
            try {
                const token = await this.authService.getIdToken();
                if (token) {
                    headers = headers.set('Authorization', `Bearer ${token}`);
                }
                headers = headers.set('x-user-id', user.id);
            } catch (e) {
                console.error('Failed to get ID token', e);
            }
        } else {
             // Fallback for guest (if supported) or unauthenticated requests
             headers = headers.set('x-user-id', this.userIdService.getUserId());
        }
        return headers;
    }

    async refreshBalance() {
        if (this.USE_MOCK) {
            this.loadMockData();
            return;
        }

        try {
            const headers = await this.getHeaders();
            const data = await firstValueFrom(
                this.http.get<{ credits: number, unlocks: UnlockMap }>(
                    `${this.apiUrl}/balance`,
                    { headers }
                )
            );
            this.balance.set(data.credits);
            this.unlocks.set(data.unlocks);
        } catch (error) {
            console.error('Failed to fetch credit balance:', error);
        }
    }

    async fetchTransactions() {
        if (this.USE_MOCK) return;
        this.transactionsLoading.set(true);
        try {
            const headers = await this.getHeaders();
            const res = await firstValueFrom(
                this.http.get<{ transactions: Transaction[] }>(
                    `${this.apiUrl}/transactions`,
                    { headers }
                )
            );
            this.transactions.set(res.transactions ?? []);
        } catch (error) {
            console.error('Failed to fetch transactions:', error);
        } finally {
            this.transactionsLoading.set(false);
        }
    }

    async startCheckout(amount: number) {
        if (!this.authService.user()) {
            // Prompt for login if not logged in
            try {
                await this.authService.signInWithGoogle();
                // After login, effect will trigger refreshBalance.
                // We should probably wait or continue?
                // For now, let's just return and let user click again or continue.
                // But better to just proceed if login successful.
                if (!this.authService.user()) return;
            } catch (e) {
                return; // Login failed/cancelled
            }
        }

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
            const headers = await this.getHeaders();
            const res = await firstValueFrom(
                this.http.post<{ url: string }>(
                    `${this.apiUrl}/checkout`,
<<<<<<< HEAD
                    { amount },
=======
                    { amount, origin: window.location.origin },
>>>>>>> origin/main
                    { headers }
                )
            );

            if (res.url) {
                window.location.href = res.url;
            }
        } catch (error) {
            console.error('Checkout failed:', error);
        } finally {
            this.isLoading.set(false);
        }
    }

    /** Open Stripe Customer Billing Portal (payment methods, invoices). Requires at least one purchase. */
    async openBillingPortal(): Promise<void> {
        if (!this.authService.user()) {
            try {
                await this.authService.signInWithGoogle();
                if (!this.authService.user()) return;
            } catch {
                return;
            }
        }

        if (this.USE_MOCK) return;

        this.portalLoading.set(true);
        try {
            const headers = await this.getHeaders();
            const res = await firstValueFrom(
                this.http.post<{ url: string }>(
                    `${this.apiUrl}/portal`,
                    { origin: window.location.origin },
                    { headers }
                )
            );
            if (res?.url) {
                window.location.href = res.url;
            }
        } catch (err: unknown) {
            const body = err && typeof err === 'object' && 'error' in err ? (err as { error: unknown }).error : undefined;
            const msg = (body && typeof body === 'object' && body !== null && 'error' in body)
                ? String((body as { error: unknown }).error)
                : 'Unable to open billing. Make a purchase first to manage payment methods.';
            console.error('Billing portal failed:', err);
            alert(msg);
        } finally {
            this.portalLoading.set(false);
        }
    }

    async unlockModule(vehicleId: string, vehicleName: string, moduleType: string, cost: number): Promise<boolean> {
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
            const headers = await this.getHeaders();
            const res = await firstValueFrom(
                this.http.post<{ success: true, credits: number, unlocks: UnlockMap }>(
                    `${this.apiUrl}/unlock`,
                    { vehicleId, vehicleName, moduleType, cost },
                    { headers }
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
