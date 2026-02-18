import { Injectable, signal, Type, TemplateRef } from '@angular/core';

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

    // Responsive state
    isDesktop = signal<boolean>(typeof window !== 'undefined' ? window.innerWidth >= 1024 : true);

    constructor() {
        if (typeof window !== 'undefined') {
            const mediaQuery = window.matchMedia('(min-width: 1024px)');
            // Use modern addEventListener if available
            if (mediaQuery.addEventListener) {
                mediaQuery.addEventListener('change', (e) => this.isDesktop.set(e.matches));
            } else {
                // Fallback for older browsers
                mediaQuery.addListener((e) => this.isDesktop.set(e.matches));
            }
        }
    }

    openWindow(title: string, content: Type<any> | TemplateRef<any>, data?: any) {
        const id = crypto.randomUUID();
        // Truncate title to max 60 chars to prevent overflow
        const displayTitle = title.length > 60 ? title.substring(0, 60) + '...' : title;

        const newWindow: WindowInstance = {
            id,
            title: displayTitle,
            content,
            data,
            zIndex: ++this.zIndexCounter,
            isMinimized: false,
            isMaximized: false,
            position: { x: 50 + (this.windows().length * 20), y: 50 + (this.windows().length * 20) },
            size: { width: 800, height: 600 }
        };

        this.windows.update(windows => [...windows, newWindow]);
        return id;
    }

    closeWindow(id: string) {
        this.windows.update(windows => windows.filter(w => w.id !== id));
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
        this.windows.update(windows => windows.map(w =>
            w.id === id ? { ...w, position: { x, y } } : w
        ));
    }

    updateSize(id: string, width: number, height: number) {
        this.windows.update(windows => windows.map(w =>
            w.id === id ? { ...w, size: { width, height } } : w
        ));
    }
}
