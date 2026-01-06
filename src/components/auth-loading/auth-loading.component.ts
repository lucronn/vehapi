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
      <div class="h-1 w-full bg-cyan-900/30 overflow-hidden">
        <div class="h-full bg-cyan-400 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(34,211,238,0.5)]"
             [style.width.%]="progress()"></div>
      </div>
      @if (progress() > 0 && progress() < 100) {
        <div class="absolute top-2 right-4 bg-black/80 backdrop-blur text-cyan-400 text-xs font-mono border border-cyan-500/30 px-3 py-1 rounded shadow-[0_0_10px_rgba(34,211,238,0.3)]">
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

                if (response.status === 'authenticating') {
                    this.progress.set(response.progress);
                    this.message.set(response.message || 'ACCESSING DATABASE...');
                    nextPollDelay = 500; // Fast poll when active
                } else if (response.status === 'success') {
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

                if (!this.destroyed) {
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
