import { expect, test, describe, beforeEach, mock } from 'bun:test';

// Mock tokens
class MockHttpClientToken {}
class MockUserIdServiceToken {}

// Mock dependencies
const mockHttpClient = {
    get: () => ({ subscribe: () => {} }),
    post: () => ({ subscribe: () => {} })
};

const mockUserIdService = {
    getUserId: () => 'test-user-id'
};

// Mock @angular/common/http
mock.module('@angular/common/http', () => ({
    HttpClient: MockHttpClientToken,
    HttpHeaders: class {
        set() { return this; }
    }
}));

// Mock services/user-id.service
mock.module('./user-id.service', () => ({
    UserIdService: MockUserIdServiceToken
}));

// Mock environments/environment
mock.module('../environments/environment', () => ({
    environment: {
        production: false
    }
}));

import '@angular/compiler';
// Mock @angular/core
mock.module('@angular/core', () => ({
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

// Import the service under test
// Note: We use dynamic import to ensure mocks are applied before the module is loaded
const { CreditsService } = await import('./credits.service');

describe('CreditsService', () => {
    let service: any;

    beforeEach(() => {
        service = new CreditsService();
        // Reset state for each test
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
});
