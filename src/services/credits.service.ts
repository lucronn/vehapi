
import { Injectable, signal, inject, effect } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { UserIdService } from './user-id.service';
import { AuthService } from './auth.service';
import { LoggerService } from './logger.service';
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
    private logger = inject(LoggerService);

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
    /** User-facing error (checkout, portal, etc.). Clear when starting a new action. */
    lastError = signal<string | null>(null);

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
        COMMON_ISSUES: 5,
        FULL_ACCESS: 25,
        ARTICLE: 100,
    };

    /** Cost for a module type (e.g. 'dtcs' -> COSTS.DTC) */
    getCostForModule(moduleType: string): number {
        const map: Record<string, number> = {
            dtcs: this.COSTS.DTC,
            tsbs: this.COSTS.TSB,
            specs: this.COSTS.SPECS,
            procedures: this.COSTS.PROCEDURES,
            diagrams: this.COSTS.DIAGRAMS,
            parts: this.COSTS.PARTS,
            maintenance: this.COSTS.MAINTENANCE,
            common_issues: this.COSTS.COMMON_ISSUES,
        };
        return map[moduleType] ?? this.COSTS.ARTICLE;
    }

    private get apiUrl() {
        const base = environment.apiUrl.replace(/\/$/, '');
        return `${base}/credits`;
    }

    constructor() {
        effect(() => {
            const userId = this.authService.userId();
            if (userId) {
                this.refreshBalance();
                this.fetchTransactions();
                // Retry any pending Stripe session that failed due to auth not being ready
                const pending = localStorage.getItem(this.PENDING_SESSION_KEY);
                if (pending) {
                    this.fulfillPendingSession(pending).then(ok => {
                        if (ok) {
                            this.refreshBalance();
                            this.fetchTransactions();
                        }
                    });
                }
            } else {
                this.balance.set(0);
                this.unlocks.set({});
                this.transactions.set([]);
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
                headers = headers.set('x-user-id', user.uid);
            } catch (e) {
                this.logger.error('Failed to get ID token', e);
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
        if (!this.authService.user()) return;

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
            this.logger.error('Failed to fetch credit balance:', error);
        }
    }

    async fetchTransactions() {
        if (this.USE_MOCK) return;
        if (!this.authService.user()) return;
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
            this.logger.error('Failed to fetch transactions:', error);
        } finally {
            this.transactionsLoading.set(false);
        }
    }

    private readonly PENDING_SESSION_KEY = 'torque_pending_stripe_session';

    /**
     * After returning from Stripe checkout, verify the session server-side
     * and fulfill credits. Persists the sessionId to localStorage so it can
     * be retried after sign-in if auth wasn't restored in time.
     */
    async verifySession(sessionId: string): Promise<boolean> {
        if (!sessionId) return false;

        localStorage.setItem(this.PENDING_SESSION_KEY, sessionId);

        // Auth may still be loading after a full page redirect from Stripe checkout.
        // Force a session read (helps `authService.user()` become available deterministically).
        try {
            await this.authService.getIdToken();
        } catch {
            // Non-fatal; we'll just rely on the polling below.
        }

        // Wait up to 15 seconds for the session/user to restore.
        for (let i = 0; i < 150 && !this.authService.user(); i++) {
            await new Promise(r => setTimeout(r, 100));
        }
        if (!this.authService.user()) {
            this.logger.warn('Auth not restored after Stripe redirect; session saved for retry after sign-in');
            return false;
        }

        return this.fulfillPendingSession(sessionId);
    }

    /** Called internally and also after sign-in to fulfill any saved Stripe session. */
    async fulfillPendingSession(sessionId?: string): Promise<boolean> {
        const sid = sessionId ?? localStorage.getItem(this.PENDING_SESSION_KEY);
        if (!sid || !this.authService.user()) return false;

        try {
            const headers = await this.getHeaders();
            const res = await firstValueFrom(
                this.http.post<{ fulfilled: boolean; credits?: number; unlocks?: UnlockMap }>(
                    `${this.apiUrl}/verify-session`,
                    { sessionId: sid },
                    { headers }
                )
            );
            if (res.fulfilled) {
                localStorage.removeItem(this.PENDING_SESSION_KEY);
                if (res.credits !== undefined) this.balance.set(res.credits);
                if (res.unlocks) this.unlocks.set(res.unlocks);
                return true;
            }
            return false;
        } catch (error) {
            this.logger.error('Session verification failed:', error);
            return false;
        }
    }

    async startCheckout(amount: number): Promise<{ success: boolean; error?: string }> {
        if (!this.authService.user()) {
            // Caller (e.g. credits dashboard) should show auth modal - don't force Google
            return { success: false, error: 'Sign in required' };
        }

        if (this.USE_MOCK) {
            this.isLoading.set(true);
            setTimeout(() => {
                this.balance.update(b => b + amount);
                this.saveMockData();
                this.isLoading.set(false);
            }, 800);
            return { success: true };
        }

        this.lastError.set(null);
        this.isLoading.set(true);
        try {
            const headers = await this.getHeaders();
            const res = await firstValueFrom(
                this.http.post<{ url: string }>(
                    `${this.apiUrl}/checkout`,
                    { amount, origin: window.location.origin },
                    { headers }
                )
            );

            if (res?.url) {
                window.location.href = res.url;
                return { success: true };
            }
            return { success: false, error: 'No checkout URL received' };
        } catch (err: unknown) {
            const msg = this.extractErrorMessage(err, 'Checkout failed. Please try again.');
            this.logger.error('Checkout failed:', err);
            this.lastError.set(msg);
            return { success: false, error: msg };
        } finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Start checkout in a popup window. Keeps the current page and modals open.
     * Resolves when the popup completes (success or cancel).
     */
    async startCheckoutPopup(amount: number): Promise<{ success: boolean; error?: string }> {
        if (!this.authService.user()) {
            return { success: false, error: 'Sign in required' };
        }

        if (this.USE_MOCK) {
            this.isLoading.set(true);
            setTimeout(() => {
                this.balance.update(b => b + amount);
                this.saveMockData();
                this.isLoading.set(false);
            }, 800);
            return { success: true };
        }

        this.lastError.set(null);
        this.isLoading.set(true);
        try {
            const headers = await this.getHeaders();
            const res = await firstValueFrom(
                this.http.post<{ url: string }>(
                    `${this.apiUrl}/checkout`,
                    { amount, origin: window.location.origin },
                    { headers }
                )
            );

            if (!res?.url) {
                return { success: false, error: 'No checkout URL received' };
            }

            const popup = window.open(res.url, 'stripe_checkout', 'width=600,height=700,scrollbars=yes,resizable=yes');
            if (!popup) {
                return { success: false, error: 'Popup blocked. Please allow popups for this site.' };
            }

            return new Promise<{ success: boolean; error?: string }>((resolve) => {
                const cleanup = (result: { success: boolean; error?: string }) => {
                    window.removeEventListener('message', handler);
                    clearInterval(poll);
                    resolve(result);
                };
                const handler = (event: MessageEvent) => {
                    if (event.data?.type === 'stripe-checkout-complete') {
                        cleanup({ success: event.data.success ?? false });
                    }
                };
                window.addEventListener('message', handler);

                const poll = setInterval(() => {
                    if (popup.closed) {
                        cleanup({ success: false, error: 'Checkout was closed' });
                    }
                }, 500);
            });
        } catch (err: unknown) {
            const msg = this.extractErrorMessage(err, 'Checkout failed. Please try again.');
            this.logger.error('Checkout failed:', err);
            this.lastError.set(msg);
            return { success: false, error: msg };
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

        this.lastError.set(null);
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
            const msg = this.extractErrorMessage(err, 'Unable to open billing. Make a purchase first to manage payment methods.');
            this.logger.error('Billing portal failed:', err);
            this.lastError.set(msg);
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
                this.http.post<{ success: true; credits: number; unlocks: UnlockMap } | { success: false }>(
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
        } catch (error: unknown) {
            this.logger.error('Unlock failed:', error);
            const err = error as { error?: string | { error?: string } };
            const msg = typeof err?.error === 'string' ? err.error : err?.error?.error ?? 'Unlock failed';
            this.lastError.set(msg);
            return false;
        } finally {
            this.isLoading.set(false);
        }
    }

    /** Unlock a single article for 100 credits (stored as article:articleId in unlocks) */
    async unlockArticle(vehicleId: string, vehicleName: string, articleId: string): Promise<boolean> {
        return this.unlockModule(vehicleId, vehicleName, `article:${articleId}`, this.COSTS.ARTICLE);
    }

    hasAccess(vehicleId: string, moduleType: string, articleId?: string): boolean {
        if ((environment as any).debugBypassPaywall && !environment.production) return true;
        const vehicleUnlocks = this.unlocks()[vehicleId] || [];
        if (vehicleUnlocks.includes('full') || vehicleUnlocks.includes(moduleType)) return true;
        if (articleId && vehicleUnlocks.includes(`article:${articleId}`)) return true;
        return false;
    }

    /** All-modules unlock for a vehicle (same as `moduleType` `full` on the server). */
    hasFullVehicleUnlock(vehicleId: string): boolean {
        const vehicleUnlocks = this.unlocks()[vehicleId] || [];
        return vehicleUnlocks.includes('full');
    }

    /** Extract user-friendly error message from HttpErrorResponse, AbortError, or unknown error. */
    private extractErrorMessage(err: unknown, fallback: string): string {
        if (err && typeof err === 'object') {
            if ('name' in err && (err as { name: string }).name === 'AbortError') {
                return 'Request was interrupted. Please try again.';
            }
            const body = 'error' in err ? (err as { error: unknown }).error : undefined;
            if (typeof body === 'string' && body) return body;
            if (body && typeof body === 'object' && body !== null && 'error' in body) {
                return String((body as { error: unknown }).error);
            }
            const status = 'status' in err ? (err as { status: number }).status : undefined;
            if (status && status >= 500) {
                return 'Server error. Please try again in a moment.';
            }
        }
        return fallback;
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
