import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthLoadingComponent } from './components/auth-loading/auth-loading.component';
import { ThemeService } from './services/theme.service';
import { WindowContainerComponent } from './components/window-container/window-container.component';

@Component({
  selector: 'app-root',
  template: `
    <app-auth-loading></app-auth-loading>
    <div class="mesh-gradient"></div>
    <div class="scanline-overlay"></div>
    <main class="min-h-screen relative z-10" style="color:var(--text-primary)">
      <router-outlet></router-outlet>
    </main>
    <app-window-container></app-window-container>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, AuthLoadingComponent, WindowContainerComponent],
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
