import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthLoadingComponent } from './components/auth-loading/auth-loading.component';
import { ThemeService } from './services/theme.service';
import { WindowContainerComponent } from './components/window-container/window-container.component';
import { AmbientBackgroundComponent } from './components/ambient-background/ambient-background.component';
import { CommandPaletteComponent } from './components/command-palette/command-palette.component';
import { FocusDepthBackdropComponent } from './components/focus-depth-backdrop/focus-depth-backdrop.component';

@Component({
  selector: 'app-root',
  template: `
    <app-auth-loading></app-auth-loading>
    <app-ambient-background></app-ambient-background>
    <main class="min-h-screen relative z-10" style="color:var(--ink)">
      <app-focus-depth-backdrop></app-focus-depth-backdrop>
      <router-outlet></router-outlet>
      <app-command-palette></app-command-palette>
    </main>
    <app-window-container></app-window-container>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, AuthLoadingComponent, WindowContainerComponent, AmbientBackgroundComponent, FocusDepthBackdropComponent, CommandPaletteComponent],
})
export class AppComponent {
  private themeService = inject(ThemeService);

  constructor() {
    // Silence AbortError spam in the console. 
    // This happens when fetch/http requests are aborted (intentional on component unmount)
    // but the underlying promises rejected without a catch.
    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        // Suppress intentional aborts
        if (reason?.name === 'AbortError' || reason?.message?.includes('user aborted')) {
          event.preventDefault();
          return;
        }
        // Suppress Supabase auth session errors (non-fatal)
        if (reason?.message?.includes('Auth session missing') || reason?.message?.includes('JWT expired')) {
          event.preventDefault();
          return;
        }
        // Suppress HTTP errors already handled by components (4xx/5xx)
        if (reason?.status >= 400 && reason?.status < 600) {
          event.preventDefault();
          return;
        }
      });
    }
  }
}
