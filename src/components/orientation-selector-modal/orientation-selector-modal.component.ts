import { Component, EventEmitter, Input, Output, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, X, ChevronRight } from 'lucide-angular';
import { FocusDepthDirective } from '../../directives/focus-depth.directive';

export interface OrientationOption {
  id: string;
  displayName: string;
  qualifier?: string;
}

@Component({
  selector: 'app-orientation-selector-modal',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, FocusDepthDirective],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in orientation-modal-shell modal-backdrop-blur"
      appFocusDepth (click)="onClose()">
      <div class="glass-card max-w-2xl w-full max-h-[80vh] overflow-hidden animate-scale-in modal-panel-shadow" (click)="$event.stopPropagation()">
        <!-- Header -->
        <div class="px-6 py-4 flex items-center justify-between border-b border-hairline">
          <div>
            <p class="text-[10px] font-mono uppercase tracking-wider text-accent mb-0.5">Configuration</p>
            <h2 class="text-lg font-heading font-bold text-ink">Select Vehicle Model</h2>
          </div>
          <button (click)="onClose()" class="btn-glass p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Close">
            <lucide-icon [img]="icons.X" class="w-5 h-5"></lucide-icon>
          </button>
        </div>

        <!-- Description -->
        <div class="px-6 py-3 border-b border-hairline bg-surface-soft">
          <p class="text-sm text-muted">
            This procedure varies by configuration. Select your vehicle to view specific information.
          </p>
        </div>

        <!-- Options List -->
        <div class="overflow-y-auto max-h-[50vh]">
          @for (option of options; track option.id) {
            <button
              (click)="onSelectOption(option)"
              class="w-full px-6 py-4 flex items-center justify-between transition-all group hover:bg-[var(--bg-hover)] min-h-[52px]"
              style="border-bottom:1px solid rgba(255,255,255,0.04)">
              <div class="flex-1 text-left min-w-0">
                <p class="text-base font-medium text-ink group-hover:text-accent transition-colors truncate">
                  {{ option.displayName }}
                </p>
                @if (option.qualifier) {
                  <p class="text-xs mt-0.5 text-faint">{{ option.qualifier }}</p>
                }
              </div>
              <lucide-icon [img]="icons.ChevronRight"
                class="w-5 h-5 group-hover:translate-x-1 transition-all text-faint flex-shrink-0"></lucide-icon>
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

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close.emit();
  }

  onClose(): void {
    this.close.emit();
  }
}
