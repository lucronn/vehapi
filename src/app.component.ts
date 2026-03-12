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
}
