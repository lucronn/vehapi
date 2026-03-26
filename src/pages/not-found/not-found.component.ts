import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-not-found',
  template: `
    <div
      class="min-h-screen flex flex-col items-center justify-center px-4 py-8 text-center max-w-lg mx-auto"
    >
      <p
        class="text-7xl sm:text-8xl font-bold leading-none tracking-tight"
        style="color: var(--accent-purple)"
      >
        404
      </p>
      <h1 class="mt-4 text-xl sm:text-2xl font-semibold" style="color: var(--text-primary)">
        Page Not Found
      </h1>
      <p class="mt-2 text-base leading-relaxed" style="color: var(--text-secondary)">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <a
        routerLink="/"
        class="mt-8 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-6 py-3 text-base font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style="background: var(--accent-purple); outline-color: var(--accent-purple)"
      >
        Go Home
      </a>
    </div>
  `,
  styles: `
    :host {
      display: block;
      --accent-purple: var(--accent);
      --card-bg: var(--bg-surface);
      --border-color: var(--border);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule],
})
export class NotFoundComponent {}
