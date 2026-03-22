import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WindowManagerService } from '../../services/window-manager.service';
import { WindowComponent } from '../window/window.component';

@Component({
  selector: 'app-window-container',
  standalone: true,
  imports: [CommonModule, WindowComponent],
  template: `
    <div class="fixed inset-0 pointer-events-none z-[9999]">
      @for (window of windowManager.windows(); track window.id) {
        @if (!window.isMinimized) {
          <app-window
            [window]="window"
            (close)="windowManager.closeWindow(window.id)"
            (minimize)="windowManager.minimizeWindow(window.id)"
            (maximize)="windowManager.maximizeWindow(window.id)"
            (focus)="windowManager.bringToFront(window.id)"
            class="pointer-events-auto">
            
            <ng-container *ngComponentOutlet="window.content; inputs: window.data"></ng-container>
            
          </app-window>
        }
      }
    </div>
  `
})
export class WindowContainerComponent {
  windowManager = inject(WindowManagerService);
}
