import { Injectable, signal, Type, TemplateRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';
import { map, distinctUntilChanged } from 'rxjs/operators';

export interface WindowInstance {
    id: string;
    title: string;
    content: Type<any> | TemplateRef<any>;
    data?: any;
    zIndex: number;
    isMinimized: boolean;
    isMaximized: boolean;
    position: { x: number; y: number };
    size: { width: number; height: number };
}

@Injectable({
    providedIn: 'root'
})
export class WindowManagerService {
    windows = signal<WindowInstance[]>([]);
    private zIndexCounter = 1000;
    private openWindowIds: string[] = [];
    private isProgrammaticBack = false;

    // Responsive state
    isDesktop = signal<boolean>(typeof window !== 'undefined' ? window.innerWidth >= 768 : true);

    constructor() {
        if (typeof window !== 'undefined') {
            // Initialize based on current width (md breakpoint 768px)
            this.isDesktop.set(window.innerWidth >= 768);

            // Watch for resize events
            fromEvent(window, 'resize')
                .pipe(
                    map(() => window.innerWidth >= 768),
                    distinctUntilChanged(),
                    takeUntilDestroyed()
                )
                .subscribe(isDesktop => this.isDesktop.set(isDesktop));

            // Listen to browser popstate to intercept Back button / swipe gesture
            fromEvent<PopStateEvent>(window, 'popstate')
                .pipe(takeUntilDestroyed())
                .subscribe(() => {
                    if (this.isProgrammaticBack) {
                        this.isProgrammaticBack = false;
                        return;
                    }
                    if (this.openWindowIds.length > 0) {
                        const topId = this.openWindowIds.pop();
                        if (topId) {
                            this.closeWindow(topId, true);
                        }
                    }
                });
        }
    }

    openWindow(title: string, content: Type<any> | TemplateRef<any>, data?: any) {
        const id = crypto.randomUUID();
        // Truncate title to max 60 chars to prevent overflow
        const displayTitle = title.length > 60 ? title.substring(0, 60) + '...' : title;

        // Ensure windowId is available to the component
        const finalData = (data && typeof data === 'object') ? { ...data, windowId: id } : data;

        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        const desktop = this.isDesktop();

        // On mobile/tablet we treat "windows" as full-screen modals to avoid
        // off-screen drag states and broken sizing due to virtual keyboard/safe areas.
        const w = desktop ? Math.min(900, Math.round(vw * 0.85)) : vw;
        const h = desktop ? Math.min(700, Math.round(vh * 0.85)) : vh;
        const cascade = desktop ? this.windows().length : 0;
        const x = desktop ? (Math.round((vw - w) / 2) + cascade * 20) : 0;
        const y = desktop ? (Math.round((vh - h) / 2) + cascade * 20) : 0;

        const newWindow: WindowInstance = {
            id,
            title: displayTitle,
            content,
            data: finalData,
            zIndex: ++this.zIndexCounter,
            isMinimized: false,
            isMaximized: !desktop,
            position: { x, y },
            size: { width: w, height: h }
        };

        this.windows.update(windows => [...windows, newWindow]);

        if (typeof window !== 'undefined') {
            this.openWindowIds.push(id);
            window.history.pushState({ modalWindowId: id }, '');
        }

        return id;
    }

    updateTitle(id: string, title: string) {
        const displayTitle = title.length > 60 ? title.substring(0, 60) + '...' : title;
        this.windows.update(windows => windows.map(w =>
            w.id === id ? { ...w, title: displayTitle } : w
        ));
    }

    closeWindow(id: string, isFromPopstate = false) {
        this.windows.update(windows => windows.filter(w => w.id !== id));

        if (typeof window !== 'undefined') {
            const index = this.openWindowIds.indexOf(id);
            if (index !== -1) {
                this.openWindowIds.splice(index, 1);
                if (!isFromPopstate) {
                    this.isProgrammaticBack = true;
                    window.history.back();
                }
            }
        }
    }

    minimizeWindow(id: string) {
        this.windows.update(windows => windows.map(w =>
            w.id === id ? { ...w, isMinimized: !w.isMinimized } : w
        ));
    }

    maximizeWindow(id: string) {
        this.windows.update(windows => windows.map(w =>
            w.id === id ? { ...w, isMaximized: !w.isMaximized } : w
        ));
        this.bringToFront(id);
    }

    bringToFront(id: string) {
        this.windows.update(windows => {
            const window = windows.find(w => w.id === id);
            if (!window) return windows;

            if (window.zIndex === this.zIndexCounter) return windows;

            this.zIndexCounter++;
            return windows.map(w => w.id === id ? { ...w, zIndex: this.zIndexCounter } : w);
        });
    }

    updatePosition(id: string, x: number, y: number) {
        const desktop = this.isDesktop();
        if (!desktop) {
            // Mobile: pinned fullscreen; ignore drag updates.
            return;
        }
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        this.windows.update(windows => windows.map(w =>
            w.id === id
                ? {
                    ...w,
                    position: {
                        x: Math.max(0, Math.min(x, Math.max(0, vw - w.size.width))),
                        y: Math.max(0, Math.min(y, Math.max(0, vh - w.size.height)))
                    }
                }
                : w
        ));
    }

    updateSize(id: string, width: number, height: number) {
        const desktop = this.isDesktop();
        if (!desktop) {
            // Mobile: fixed fullscreen sizing; ignore resize updates.
            return;
        }
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        this.windows.update(windows => windows.map(w =>
            w.id === id
                ? {
                    ...w,
                    size: {
                        width: Math.max(300, Math.min(width, vw)),
                        height: Math.max(200, Math.min(height, vh))
                    }
                }
                : w
        ));
    }
}
