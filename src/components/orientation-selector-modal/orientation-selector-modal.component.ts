import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, X, ChevronRight } from 'lucide-angular';

export interface OrientationOption {
    id: string;
    displayName: string;
    qualifier?: string;
}

@Component({
    selector: 'app-orientation-selector-modal',
    standalone: true,
    imports: [CommonModule, LucideAngularModule],
    template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in" (click)="close.emit()">
      <div class="glass-card neon-border-cyan max-w-2xl w-full max-h-[80vh] overflow-hidden animate-scale-in" (click)="$event.stopPropagation()">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div>
            <p class="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--accent-cyan))] font-bold mb-1">Vehicle Configuration</p>
            <h2 class="text-xl font-bold">Select Vehicle Model</h2>
          </div>
          <button (click)="close.emit()" class="p-2 hover:bg-white/5 rounded-lg transition-colors">
            <lucide-icon [img]="icons.X" class="w-5 h-5"></lucide-icon>
          </button>
        </div>

        <!-- Description -->
        <div class="px-6 py-4 border-b border-white/10 bg-white/[0.01]">
          <p class="text-sm text-[hsl(var(--text-muted))]">
            This procedure varies by vehicle configuration. Select your vehicle model to view the specific information.
          </p>
        </div>

        <!-- Options List -->
        <div class="overflow-y-auto max-h-[50vh] custom-scrollbar">
          @for (option of options; track option.id) {
            <button 
              (click)="selectOrientation.emit(option)"
              class="w-full px-6 py-4 flex items-center justify-between hover:bg-white/5 transition-all border-b border-white/5 group">
              <div class="flex-1 text-left">
                <p class="text-base font-medium text-white group-hover:text-[hsl(var(--accent-cyan))] transition-colors">
                  {{ option.displayName }}
                </p>
                @if (option.qualifier) {
                  <p class="text-xs text-[hsl(var(--text-muted))] mt-1">
                    {{ option.qualifier }}
                  </p>
                }
              </div>
              <lucide-icon [img]="icons.ChevronRight" class="w-5 h-5 text-[hsl(var(--text-muted))] group-hover:text-[hsl(var(--accent-cyan))] group-hover:translate-x-1 transition-all"></lucide-icon>
            </button>
          }
        </div>
      </div>
    </div>
  `,
    styles: [`
    @keyframes scale-in {
      from {
        opacity: 0;
        transform: scale(0.95);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    .animate-scale-in {
      animation: scale-in 0.2s ease-out;
    }

    .animate-fade-in {
      animation: fadeIn 0.2s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `]
})
export class OrientationSelectorModalComponent {
    @Input() options: OrientationOption[] = [];
    @Output() selectOrientation = new EventEmitter<OrientationOption>();
    @Output() close = new EventEmitter<void>();

    readonly icons = { X, ChevronRight };
}
