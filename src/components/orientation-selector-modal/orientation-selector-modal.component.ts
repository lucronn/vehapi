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
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style="background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)" (click)="onClose()">
      <div class="card max-w-2xl w-full max-h-[80vh] overflow-hidden animate-scale-in"
        style="background:var(--bg-surface)" (click)="$event.stopPropagation()">
        <!-- Header -->
        <div class="px-6 py-4 flex items-center justify-between" style="border-bottom:1px solid var(--border)">
          <div>
            <p class="text-xs uppercase tracking-wide font-semibold mb-0.5" style="color:var(--primary)">Configuration</p>
            <h2 class="text-lg font-bold" style="color:var(--text-primary)">Select Vehicle Model</h2>
          </div>
          <button (click)="onClose()" class="btn-ghost p-2 rounded-lg">
            <lucide-icon [img]="icons.X" class="w-5 h-5"></lucide-icon>
          </button>
        </div>

        <!-- Description -->
        <div class="px-6 py-3" style="border-bottom:1px solid var(--border);background:var(--bg-muted)">
          <p class="text-sm" style="color:var(--text-secondary)">
            This procedure varies by configuration. Select your vehicle to view specific information.
          </p>
        </div>

        <!-- Options List -->
        <div class="overflow-y-auto max-h-[50vh]">
          @for (option of options; track option.id) {
            <button
              (click)="onSelectOption(option)"
              class="w-full px-6 py-4 flex items-center justify-between transition-all group"
              style="border-bottom:1px solid var(--border-muted)">
              <div class="flex-1 text-left">
                <p class="text-base font-medium transition-colors" style="color:var(--text-primary)">
                  {{ option.displayName }}
                </p>
                @if (option.qualifier) {
                  <p class="text-xs mt-0.5" style="color:var(--text-muted)">{{ option.qualifier }}</p>
                }
              </div>
              <lucide-icon [img]="icons.ChevronRight"
                class="w-5 h-5 group-hover:translate-x-1 transition-all" style="color:var(--text-muted)"></lucide-icon>
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

  onSelectOption(option: OrientationOption): void {
    this.selectOrientation.emit(option);
  }

  onClose(): void {
    this.close.emit();
  }
}
