import { Component, Input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, ChevronRight, ChevronLeft, Wrench, AlertTriangle } from 'lucide-angular';
import { TutorialStep } from '../../models/motor.models';

@Component({
    selector: 'app-tutorial-stepper',
    standalone: true,
    imports: [CommonModule, LucideAngularModule],
    template: `
    <div class="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 shadow-2xl">
      <!-- Header / Progress -->
      <div class="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center">
        <div class="text-sm text-gray-400">
          Step <span class="text-cyan-400 font-bold">{{ currentStepIndex() + 1 }}</span> of {{ steps().length }}
        </div>
        <div class="flex-1 mx-4 h-2 bg-gray-700 rounded-full overflow-hidden">
          <div class="h-full bg-cyan-500 transition-all duration-300" [style.width.%]="progress()"></div>
        </div>
      </div>

      <!-- Step Content -->
      <div class="p-6 min-h-[300px] flex flex-col relative">
        
        <!-- Step Title -->
        <h3 class="text-2xl font-bold text-white mb-4">{{ currentStep()?.title }}</h3>

        <!-- Warning Info -->
        <div *ngIf="currentStep()?.warning" class="bg-red-900/20 border-l-4 border-red-500 p-3 mb-4 rounded-r">
          <div class="flex items-center gap-2 text-red-400 font-bold mb-1">
            <lucide-icon [img]="icons.AlertTriangle" class="w-4 h-4"></lucide-icon>
            WARNING
          </div>
          <p class="text-gray-300 text-sm">{{ currentStep()?.warning }}</p>
        </div>

        <!-- Tool Info -->
        <div *ngIf="currentStep()?.tool" class="bg-blue-900/20 border-l-4 border-blue-500 p-3 mb-4 rounded-r">
          <div class="flex items-center gap-2 text-blue-400 font-bold mb-1">
            <lucide-icon [img]="icons.Wrench" class="w-4 h-4"></lucide-icon>
            TOOL REQUIRED
          </div>
          <p class="text-gray-300 text-sm">{{ currentStep()?.tool }}</p>
        </div>

        <!-- Main Content -->
        <div class="prose prose-invert max-w-none mb-6 text-gray-300" 
             [innerHTML]="currentStep()?.content"></div>

        <!-- Media (if any) -->
        <div *ngIf="currentStep()?.mediaPlaceholder" class="mb-6 rounded-lg overflow-hidden border border-gray-700">
             <div [innerHTML]="currentStep()?.mediaPlaceholder"></div>
        </div>

      </div>

      <!-- Navigation Footer -->
      <div class="bg-gray-800 p-4 border-t border-gray-700 flex justify-between">
        <button 
          (click)="prev()" 
          [disabled]="currentStepIndex() === 0"
          class="flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all"
          [ngClass]="currentStepIndex() === 0 ? 'text-gray-600 cursor-not-allowed' : 'text-white hover:bg-gray-700'">
          <lucide-icon [img]="icons.ChevronLeft" class="w-5 h-5"></lucide-icon>
          Back
        </button>

        <button 
          (click)="next()" 
          [disabled]="currentStepIndex() === steps().length - 1"
          class="flex items-center gap-2 px-6 py-2 rounded-lg font-bold bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
          {{ currentStepIndex() === steps().length - 1 ? 'Finish' : 'Next' }}
          <lucide-icon [img]="icons.ChevronRight" class="w-5 h-5"></lucide-icon>
        </button>
      </div>
    </div>
  `
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
