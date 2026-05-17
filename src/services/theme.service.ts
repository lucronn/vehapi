import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
    private readonly STORAGE_KEY = 'torque-theme';

    readonly theme = signal<Theme>(this.getInitialTheme());

    constructor() {
        this.apply(this.theme());
    }

    toggleTheme(): void {
        const next: Theme = this.theme() === 'light' ? 'dark' : 'light';
        this.theme.set(next);
        this.apply(next);
        localStorage.setItem(this.STORAGE_KEY, next);
    }

    private apply(theme: Theme): void {
        document.documentElement.setAttribute('data-theme', theme);
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
            document.documentElement.classList.remove('light');
        } else {
            document.documentElement.classList.add('light');
            document.documentElement.classList.remove('dark');
        }
    }

    private getInitialTheme(): Theme {
        const stored = localStorage.getItem(this.STORAGE_KEY) as Theme | null;
        if (stored === 'light' || stored === 'dark') return stored;
        // Calm-paper redesign defaults to light. Users can flip to dark
        // (basalt) via the toggle; preference persists in localStorage.
        if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    }
}
