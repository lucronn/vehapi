import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MotorApiService } from '../../services/motor-api.service';
import { timer, Subscription, switchMap, filter, takeWhile, finalize } from 'rxjs';

@Component({
    selector: 'app-auth-loading',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="fixed top-0 left-0 right-0 z-[100]">
      <div class="h-0.5 w-full overflow-hidden" style="background:var(--border)">
        <div class="h-full transition-all duration-300 ease-out"
             style="background:var(--primary)"
             [style.width.%]="progress()"></div>
      </div>
      @if (progress() > 0 && progress() < 100) {
        <div class="absolute top-2 right-4 text-xs font-medium px-3 py-1 rounded-md"
          style="background:var(--bg-surface);color:var(--primary);border:1px solid var(--border)">
          {{ message() }} {{ progress() }}%
        </div>
      }
    </div>
  `,
    styles: [`:host { display: block; }`]
})
export class AuthLoadingComponent implements OnInit, OnDestroy {
    private motorApi = inject(MotorApiService);
    private destroyed = false;

    progress = signal(0);
    message = signal('ACCESSING DATABASE...');

    ngOnInit() {
        this.poll();
    }

    private poll() {
        if (this.destroyed) return;

        this.motorApi.getAuthStatus().subscribe({
            next: (response) => {
                let nextPollDelay = 4000; // Default idle poll
                let shouldContinue = true;

                if (response.status === 'authenticating') {
                    this.progress.set(response.progress);
                    this.message.set(response.message || 'ACCESSING DATABASE...');
                    nextPollDelay = 500; // Fast poll when active
                } else if (response.status === 'success') {
                    shouldContinue = false; // Stop polling on success
                    // Only show completion if we were previously showing progress
                    if (this.progress() > 0) {
                        this.progress.set(100);
                        this.message.set('COMPLETE');
                        setTimeout(() => {
                            if (!this.destroyed) {
                                this.progress.set(0);
                                this.message.set('ACCESSING DATABASE...');
                            }
                        }, 1000);
                    }
                } else if (response.status === 'error') {
                    this.progress.set(0);
                } else if (response.status === 'idle') {
                    // unexpected idle state, reset if we were showing something (unless we just finished success animation)
                    if (this.progress() > 0 && this.message() !== 'COMPLETE') {
                        this.progress.set(0);
                    }
                }

                if (!this.destroyed && shouldContinue) {
                    setTimeout(() => this.poll(), nextPollDelay);
                }
            },
            error: () => {
                this.progress.set(0);
                if (!this.destroyed) {
                    setTimeout(() => this.poll(), 4000); // Retry later on error
                }
            }
        });
    }

    ngOnDestroy() {
        this.destroyed = true;
    }
}
