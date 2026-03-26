import { WindowManagerService } from './window-manager.service';

const { mockSignal } = vi.hoisted(() => {
    const mockSignal = (initialValue: any) => {
        let _val = initialValue;
        const s = () => _val;
        s.set = (v: any) => { _val = v; };
        s.update = (fn: (val: any) => any) => { _val = fn(_val); };
        return s;
    };
    return { mockSignal };
});

vi.mock('@angular/core', () => ({
    Injectable: () => (target: any) => target,
    signal: mockSignal,
    Type: class {},
    TemplateRef: class {}
}));

vi.mock('@angular/core/rxjs-interop', () => ({
    takeUntilDestroyed: () => (source: any) => source,
}));

describe('WindowManagerService', () => {
    let service: WindowManagerService;
    let originalCrypto: any;
    let originalWindow: any;

    beforeEach(() => {
        originalCrypto = global.crypto;

        let uuidCounter = 0;
        const mockCrypto = {
            ...global.crypto,
            randomUUID: () => `test-uuid-${++uuidCounter}`
        };

        try {
            global.crypto = mockCrypto as any;
        } catch (e) {
             Object.defineProperty(global, 'crypto', {
                value: mockCrypto,
                writable: true,
                configurable: true
            });
        }

        originalWindow = global.window;
        const mockMatchMedia = (query: string) => ({
            matches: true,
            addEventListener: () => {},
            addListener: () => {},
        });

        const listeners: Record<string, Function[]> = {};
        const mockWindow = {
            innerWidth: 1024,
            matchMedia: mockMatchMedia,
            addEventListener: (type: string, fn: Function) => { (listeners[type] ??= []).push(fn); },
            removeEventListener: (type: string, fn: Function) => { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
            dispatchEvent: () => true,
        };

        global.window = mockWindow as any;

        service = new WindowManagerService();
    });

    afterEach(() => {
        if (originalCrypto) {
            try {
                global.crypto = originalCrypto;
            } catch {
                Object.defineProperty(global, 'crypto', {
                    value: originalCrypto,
                    writable: true,
                    configurable: true
                });
            }
        }
        global.window = originalWindow;
    });

    test('should initialize with default values', () => {
        expect(service).toBeDefined();
        expect(service.windows()).toEqual([]);
        expect(service.isDesktop()).toBe(true);
    });

    test('should open a new window', () => {
        const id = service.openWindow('Test Window', 'Content' as any);
        expect(id).toBe('test-uuid-1');

        const windows = service.windows();
        expect(windows.length).toBe(1);

        const win = windows[0];
        expect(win.id).toBe('test-uuid-1');
        expect(win.title).toBe('Test Window');
        expect(win.zIndex).toBe(1001);
        expect(win.isMinimized).toBe(false);
        expect(win.isMaximized).toBe(false);
        expect(win.position).toEqual({ x: 50, y: 50 });
        expect(win.size).toEqual({ width: 800, height: 600 });
    });

    test('should truncate long titles', () => {
        const longTitle = 'A'.repeat(70);
        service.openWindow(longTitle, 'Content' as any);
        const win = service.windows()[0];
        expect(win.title.length).toBe(63);
        expect(win.title.endsWith('...')).toBe(true);
    });

    test('should close a window', () => {
        const id1 = service.openWindow('Window 1', 'Content' as any);
        const id2 = service.openWindow('Window 2', 'Content' as any);

        expect(service.windows().length).toBe(2);

        service.closeWindow(id1);

        const windows = service.windows();
        expect(windows.length).toBe(1);
        expect(windows[0].id).toBe(id2);
    });

    test('should minimize a window', () => {
        const id = service.openWindow('Window 1', 'Content' as any);

        service.minimizeWindow(id);
        expect(service.windows()[0].isMinimized).toBe(true);

        service.minimizeWindow(id);
        expect(service.windows()[0].isMinimized).toBe(false);
    });

    test('should maximize a window and bring to front', () => {
        const id1 = service.openWindow('Window 1', 'Content' as any);
        const id2 = service.openWindow('Window 2', 'Content' as any);

        expect(service.windows()[1].zIndex).toBe(1002);

        service.maximizeWindow(id1);

        const windows = service.windows();
        const win1 = windows.find(w => w.id === id1);

        expect(win1?.isMaximized).toBe(true);
        expect(win1?.zIndex).toBe(1003);

        service.maximizeWindow(id1);
        expect(service.windows().find(w => w.id === id1)?.isMaximized).toBe(false);
    });

    test('should bring window to front', () => {
        const id1 = service.openWindow('Window 1', 'Content' as any);
        const id2 = service.openWindow('Window 2', 'Content' as any);

        expect(service.windows()[0].zIndex).toBe(1001);
        expect(service.windows()[1].zIndex).toBe(1002);

        service.bringToFront(id1);

        const windows = service.windows();
        const win1 = windows.find(w => w.id === id1);

        expect(win1?.zIndex).toBe(1003);
    });

    test('should update position', () => {
        const id = service.openWindow('Window 1', 'Content' as any);

        service.updatePosition(id, 100, 200);

        const win = service.windows()[0];
        expect(win.position).toEqual({ x: 100, y: 200 });
    });

    test('should update size', () => {
        const id = service.openWindow('Window 1', 'Content' as any);

        service.updateSize(id, 500, 400);

        const win = service.windows()[0];
        expect(win.size).toEqual({ width: 500, height: 400 });
    });
});
