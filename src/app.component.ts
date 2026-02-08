import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthLoadingComponent } from './components/auth-loading/auth-loading.component';

@Component({
  selector: 'app-root',
  template: `
    <app-auth-loading></app-auth-loading>
    <main class="min-h-screen bg-[hsl(var(--bg-deep))] Selection:bg-cyan-500/30">
      <router-outlet></router-outlet>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, AuthLoadingComponent],
})
export class AppComponent { }
