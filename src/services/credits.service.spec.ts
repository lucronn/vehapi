const {
    MockHttpClientToken,
    MockUserIdServiceToken,
    mockHttpClient,
    mockUserIdService,
} = vi.hoisted(() => {
    const MockHttpClientToken = class {};
    const MockUserIdServiceToken = class {};
    const mockHttpClient: Record<string, any> = {
        get: () => ({ subscribe: () => {} }),
        post: () => ({ subscribe: () => {} })
    };
    const mockUserIdService = {
        getUserId: () => 'test-user-id'
    };
    return { MockHttpClientToken, MockUserIdServiceToken, mockHttpClient, mockUserIdService };
});

vi.mock('@angular/common/http', () => ({
    HttpClient: MockHttpClientToken,
    HttpHeaders: class {
        set() { return this; }
    }
}));

vi.mock('./user-id.service', () => ({
    UserIdService: MockUserIdServiceToken
}));

vi.mock('../environments/environment', () => ({
    environment: {
        production: false,
        apiUrl: '/api'
    }
}));

import '@angular/compiler';

vi.mock('@angular/core', () => ({
    Injectable: () => (target: any) => target,
    computed: (fn: any) => fn,
    inject: (token: any) => {
        if (token === MockHttpClientToken) return mockHttpClient;
        if (token === MockUserIdServiceToken) return mockUserIdService;
        if (token && token.name === 'AuthService') return {
            user: () => null,
            getIdToken: async () => null,
            signInWithGoogle: async () => null
        };
        return null;
    },
    effect: () => {},
    signal: (initialValue: any) => {
        let value = initialValue;
        const s: any = () => value;
        s.set = (v: any) => { value = v; };
        s.update = (fn: any) => { value = fn(value); };
        return s;
    }
}));

vi.mock('rxjs', () => ({
    firstValueFrom: async (obs: any) => {
        return obs.toPromise();
    }
}));

const mockLocalStorage = {
    store: {} as Record<string, string>,
    getItem(key: string) {
        return this.store[key] || null;
    },
    setItem(key: string, value: string) {
        this.store[key] = String(value);
    },
    removeItem(key: string) {
        delete this.store[key];
    },
    clear() {
        this.store = {};
    }
};

const originalLocalStorage = (globalThis as any).localStorage;
(globalThis as any).localStorage = mockLocalStorage;

const { CreditsService } = await import('./credits.service');

describe('CreditsService', () => {
    let service: any;

    afterAll(() => {
        (globalThis as any).localStorage = originalLocalStorage;
    });

    beforeEach(() => {
        mockLocalStorage.clear();
        service = new CreditsService();
        service.unlocks.set({});
    });

    describe('hasAccess', () => {
        test('should return true if module type is explicitly unlocked', () => {
            service.unlocks.set({
                'vehicle-123': ['specs']
            });
            expect(service.hasAccess('vehicle-123', 'specs')).toBe(true);
        });

        test('should return true if full access is unlocked', () => {
            service.unlocks.set({
                'vehicle-123': ['full']
            });
            expect(service.hasAccess('vehicle-123', 'specs')).toBe(true);
        });

        test('hasFullVehicleUnlock reflects full in unlock list', () => {
            service.unlocks.set({ 'vehicle-123': ['full'] });
            expect(service.hasFullVehicleUnlock('vehicle-123')).toBe(true);
            expect(service.hasFullVehicleUnlock('other')).toBe(false);
        });

        test('should return false if vehicle has no unlocks', () => {
            service.unlocks.set({});
            expect(service.hasAccess('vehicle-123', 'specs')).toBe(false);
        });

        test('should return false if vehicle has unlocks but not for the specific module', () => {
            service.unlocks.set({
                'vehicle-123': ['procedures']
            });
            expect(service.hasAccess('vehicle-123', 'specs')).toBe(false);
        });

        test('should handle unknown vehicle IDs gracefully', () => {
            service.unlocks.set({
                'vehicle-456': ['specs']
            });
            expect(service.hasAccess('vehicle-123', 'specs')).toBe(false);
        });

        test('should return true for multiple unlocked modules', () => {
            service.unlocks.set({
                'vehicle-123': ['specs', 'diagrams']
            });
            expect(service.hasAccess('vehicle-123', 'diagrams')).toBe(true);
            expect(service.hasAccess('vehicle-123', 'specs')).toBe(true);
            expect(service.hasAccess('vehicle-123', 'procedures')).toBe(false);
        });
    });

    describe('unlockModule (USE_MOCK = false)', () => {
        let postMock: any;

        beforeEach(() => {
            (service as any).useMock = false;
            service.balance.set(100);

            postMock = vi.fn(() => ({
                toPromise: async () => ({
                    success: true,
                    credits: 80,
                    unlocks: { 'vehicle-123': ['specs'] }
                })
            }));
            mockHttpClient.post = postMock;
        });

        test('should return false immediately if balance is insufficient', async () => {
            service.balance.set(5);
            const result = await service.unlockModule('vehicle-123', 'procedures', 10);
            expect(result).toBe(false);
            expect(postMock).not.toHaveBeenCalled();
        });

        test('should make HTTP POST request and update state on success', async () => {
            const cost = 20;
            const result = await service.unlockModule('vehicle-123', 'specs', cost);

            expect(result).toBe(true);
            expect(postMock).toHaveBeenCalledTimes(1);

            const [url, body, options] = postMock.mock.calls[0];
            expect(url).toContain('/api/credits/unlock');
            expect(body).toEqual({
                vehicleId: 'vehicle-123',
                moduleType: 'specs',
                cost
            });
            expect(options.headers).toBeDefined();

            expect(service.balance()).toBe(80);
            expect(service.unlocks()).toEqual({ 'vehicle-123': ['specs'] });
        });

        test('should set isLoading to true before request and false after completion', async () => {
            let loadingDuringRequest = false;

            postMock = vi.fn(() => ({
                toPromise: async () => {
                    loadingDuringRequest = service.isLoading();
                    return {
                        success: true,
                        credits: 90,
                        unlocks: {}
                    };
                }
            }));
            mockHttpClient.post = postMock;

            expect(service.isLoading()).toBe(false);

            const promise = service.unlockModule('vehicle-123', 'specs', 10);

            await promise;

            expect(loadingDuringRequest).toBe(true);
            expect(service.isLoading()).toBe(false);
        });

        test('should handle API success: false response correctly', async () => {
            postMock = vi.fn(() => ({
                toPromise: async () => ({
                    success: false
                })
            }));
            mockHttpClient.post = postMock;

            const initialBalance = service.balance();
            const result = await service.unlockModule('vehicle-123', 'specs', 10);

            expect(result).toBe(false);
            expect(service.balance()).toBe(initialBalance);
            expect(service.isLoading()).toBe(false);
        });

        test('should catch HTTP errors and return false', async () => {
            postMock = vi.fn(() => ({
                toPromise: async () => {
                    throw new Error('Network error');
                }
            }));
            mockHttpClient.post = postMock;

            const consoleSpy = vi.fn();
            const originalError = console.error;
            console.error = consoleSpy;

            const result = await service.unlockModule('vehicle-123', 'specs', 10);

            expect(result).toBe(false);
            expect(consoleSpy).toHaveBeenCalled();
            expect(service.isLoading()).toBe(false);

            console.error = originalError;
        });
    });
});
