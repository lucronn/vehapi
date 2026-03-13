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
        if (event.reason?.name === 'AbortError' || event.reason?.message?.includes('user aborted')) {
          event.preventDefault();
          // Log it silently if in dev, but don't let it crash/spam
          if (typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'development') {
            console.debug('Suppressed AbortError:', event.reason);
          }
        }
      });
    }
  }
}
