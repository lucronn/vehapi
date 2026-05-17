import { Component, Input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, ChevronRight, ChevronLeft, Wrench, AlertTriangle } from 'lucide-angular';
import { TutorialStep } from '../../models/motor.models';

@Component({
  selector: 'app-tutorial-stepper',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div class="glass-card overflow-hidden shadow-2xl animate-fade-in">
      <!-- High-Tech Progress Header -->
      <div class="bg-surface-soft px-8 py-6 border-b border-hairline flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div class="flex items-center gap-4">
            <div class="w-10 h-10 rounded-xl bg-accent-soft flex items-center justify-center text-[var(--accent)]">
                <lucide-icon [img]="icons.Wrench" class="w-5 h-5"></lucide-icon>
            </div>
            <div>
                <p class="text-[9px] uppercase tracking-[0.3em] font-black text-[hsl(var(--text-muted))]">Vector Step</p>
                <h3 class="text-xs font-black text-ink uppercase tracking-widest">Active Resolution {{ currentStepIndex() + 1 }} / {{ steps().length }}</h3>
            </div>
        </div>
        
        <div class="flex-1 max-w-md h-1.5 bg-surface-soft rounded-full overflow-hidden relative">
            <div class="absolute inset-0 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-deep)] opacity-20"></div>
            <div class="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-deep)] transition-all duration-700 ease-out relative z-10" [style.width.%]="progress()">
                <div class="absolute top-0 right-0 w-4 h-full bg-white/40 blur-sm"></div>
            </div>
        </div>
      </div>

      <!-- Content Core -->
      <div class="p-8 md:p-12 min-h-[400px]">
        
        <!-- Animated Title -->
        <h2 class="text-3xl font-black text-ink tracking-tighter mb-10 leading-none">{{ currentStep()?.title }}</h2>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-12">
            <!-- Left Column: Instructional Data -->
            <div class="lg:col-span-7 space-y-8">
                <!-- Warning System -->
                <div *ngIf="currentStep()?.warning" class="relative group">
                    <div class="absolute -inset-1 bg-red-500/20 rounded-2xl blur opacity-25"></div>
                    <div class="relative bg-red-500/5 border border-red-500/20 p-6 rounded-2xl">
                        <div class="flex items-center gap-3 text-red-500 font-black text-[10px] uppercase tracking-[0.3em] mb-3">
                            <lucide-icon [img]="icons.AlertTriangle" class="w-4 h-4"></lucide-icon>
                            Critical Safety Protocol
                        </div>
                        <p class="text-muted text-sm leading-relaxed font-medium">{{ currentStep()?.warning }}</p>
                    </div>
                </div>

                <!-- Step Execution -->
                <div class="motor-prose text-lg text-muted leading-relaxed font-medium" 
                     [innerHTML]="currentStep()?.content"></div>
                
                <!-- Required Equipment -->
                <div *ngIf="currentStep()?.tool" class="bg-surface-soft border border-hairline p-6 rounded-2xl flex items-start gap-4">
                    <div class="w-10 h-10 rounded-xl bg-accent-soft flex items-center justify-center text-[var(--accent)] flex-shrink-0">
                        <lucide-icon [img]="icons.Wrench" class="w-5 h-5"></lucide-icon>
                    </div>
                    <div>
                        <p class="text-[9px] uppercase tracking-[0.3em] text-[hsl(var(--text-muted))] font-black mb-1">Equipment Required</p>
                        <p class="text-ink font-bold">{{ currentStep()?.tool }}</p>
                    </div>
                </div>
            </div>

            <!-- Right Column: Visual Data Matrix -->
            <div class="lg:col-span-5 space-y-6">
                @if (currentStep()?.mediaPlaceholder) {
                <div class="glass-card p-2 group overflow-hidden">
                    <div class="rounded-xl overflow-hidden border border-hairline bg-black/40" [innerHTML]="currentStep()?.mediaPlaceholder"></div>
                    <div class="mt-4 px-4 py-2 flex items-center justify-between">
                        <span class="text-[9px] uppercase tracking-widest font-black text-[hsl(var(--text-muted))]">Reference Diagram</span>
                        <div class="flex gap-1">
                            <div class="w-1 h-1 rounded-full bg-[var(--accent)]"></div>
                            <div class="w-1 h-1 rounded-full bg-white/20"></div>
                            <div class="w-1 h-1 rounded-full bg-white/20"></div>
                        </div>
                    </div>
                </div>
                } @else {
                    <div class="h-full flex flex-col items-center justify-center p-12 border-2 border-dashed border-hairline rounded-3xl opacity-20 grayscale">
                        <lucide-icon [img]="icons.Wrench" class="w-20 h-20 mb-6"></lucide-icon>
                        <p class="text-center text-xs uppercase tracking-[0.2em] font-black">No visual data for this step</p>
                    </div>
                }
            </div>
        </div>
      </div>

      <!-- Navigation Matrix -->
      <div class="bg-surface-soft px-10 py-8 border-t border-hairline flex items-center justify-between">
        <button 
          (click)="prev()" 
          [disabled]="currentStepIndex() === 0"
          class="flex items-center gap-3 px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] transition-all disabled:opacity-20 disabled:cursor-not-allowed hover:bg-surface-soft">
          <lucide-icon [img]="icons.ChevronLeft" class="w-4 h-4"></lucide-icon>
          Previous State
        </button>

        <button 
          (click)="next()" 
          class="relative group active:scale-95 transition-all">
          <div class="absolute -inset-1 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-deep)] rounded-2xl blur opacity-30 group-hover:opacity-60 transition duration-500"></div>
          <div class="relative flex items-center gap-3 px-10 py-4 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] bg-accent text-accent-ink border border-hairline group-hover:border-accent-deep transition-all">
            {{ currentStepIndex() === steps().length - 1 ? 'End Protocol' : 'Next Operation' }}
            <lucide-icon [img]="icons.ChevronRight" class="w-4 h-4 group-hover:translate-x-1 transition-transform"></lucide-icon>
          </div>
        </button>
      </div>
    </div>
  `,
})
export class TutorialComponent {
  @Input({ required: true }) set data(value: TutorialStep[]) {
    this.steps.set(value);
    this.currentStepIndex.set(0);
  }

  readonly icons = { ChevronRight, ChevronLeft, Wrench, AlertTriangle };

  steps = signal<TutorialStep[]>([]);
  currentStepIndex = signal(0);

  currentStep = computed(() => this.steps()[this.currentStepIndex()]);
  progress = computed(() => ((this.currentStepIndex() + 1) / this.steps().length) * 100);

  next() {
    if (this.currentStepIndex() < this.steps().length - 1) {
      this.currentStepIndex.update(i => i + 1);
    }
  }

  prev() {
    if (this.currentStepIndex() > 0) {
      this.currentStepIndex.update(i => i - 1);
    }
  }
}
