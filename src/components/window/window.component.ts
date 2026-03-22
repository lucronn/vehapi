import { Component, Input, Output, EventEmitter, inject, ElementRef, HostListener, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, X, Minus, Square, Copy } from 'lucide-angular';
import { WindowInstance, WindowManagerService } from '../../services/window-manager.service';

@Component({
  selector: 'app-window',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div class="window-frame flex flex-col rounded-xl shadow-2xl overflow-hidden"
         style="background:var(--bg-surface);border:1px solid var(--border)"
         [style.z-index]="window.zIndex"
         [style.left.px]="window.position.x"
         [style.top.px]="window.position.y"
         [style.width.px]="window.size.width"
         [style.height.px]="window.size.height"
         (mousedown)="onWindowMouseDown()">

      <!-- Title Bar -->
      <div class="window-title-bar flex items-center justify-between px-3 py-2 cursor-move select-none"
           style="background:var(--bg-secondary);border-bottom:1px solid var(--border)"
           (mousedown)="startDrag($event)">
        <div class="flex items-center gap-2 min-w-0 overflow-hidden flex-1">
           <lucide-icon [img]="icons.Copy" class="w-4 h-4 shrink-0" style="color:var(--text-muted)"></lucide-icon>
           <span class="text-sm font-medium truncate" [title]="window.title" style="color:var(--text-primary)">{{ window.title }}</span>
        </div>
        <div class="flex items-center gap-1">
          <button (click)="minimize.emit()" class="p-1 rounded hover:opacity-80 transition-colors" style="color:var(--text-muted)" aria-label="Minimize">
            <lucide-icon [img]="icons.Minus" class="w-4 h-4"></lucide-icon>
          </button>
          <button (click)="maximize.emit()" class="p-1 rounded hover:opacity-80 transition-colors" style="color:var(--text-muted)" aria-label="Maximize">
            <lucide-icon [img]="icons.Square" class="w-3 h-3"></lucide-icon>
          </button>
          <button (click)="close.emit()" class="p-1 rounded hover:bg-red-500/20 hover:text-red-400 transition-colors" style="color:var(--text-muted)" aria-label="Close">
            <lucide-icon [img]="icons.X" class="w-4 h-4"></lucide-icon>
          </button>
        </div>
      </div>

      <!-- Content Area -->
      <div class="flex-1 overflow-auto relative" style="background:var(--bg)">
        <ng-content></ng-content>
      </div>

      <!-- Resize Handle -->
      <div class="resize-handle absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-center justify-center"
           (mousedown)="startResize($event)">
        <div class="w-2 h-2 border-r-2 border-b-2 rounded-sm" style="border-color:var(--border)"></div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      position: absolute;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
    }
    .window-frame {
      position: absolute;
      display: flex;
      flex-direction: column;
       /* Minimum dimensions */
      min-width: 300px;
      min-height: 200px;
    }
  `]
})
export class WindowComponent {
  @Input({ required: true }) window!: WindowInstance;
  @Output() close = new EventEmitter<void>();
  @Output() minimize = new EventEmitter<void>();
  @Output() maximize = new EventEmitter<void>();
  @Output() focus = new EventEmitter<void>();

  private windowManager = inject(WindowManagerService);
  private isDragging = false;
  private isResizing = false;
  private dragOffset = { x: 0, y: 0 };
  private initialSize = { width: 0, height: 0 };
  private initialPos = { x: 0, y: 0 };

  readonly icons = { X, Minus, Square, Copy };

  onWindowMouseDown() {
    this.focus.emit();
  }

  startDrag(event: MouseEvent) {
    if (this.window.isMaximized) return;
    this.isDragging = true;
    this.dragOffset = {
      x: event.clientX - this.window.position.x,
      y: event.clientY - this.window.position.y
    };
    event.preventDefault();
  }

  startResize(event: MouseEvent) {
    if (this.window.isMaximized) return;
    this.isResizing = true;
    this.initialSize = { ...this.window.size };
    this.initialPos = { x: event.clientX, y: event.clientY };
    event.preventDefault();
    event.stopPropagation();
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (this.isDragging) {
      const x = event.clientX - this.dragOffset.x;
      const y = event.clientY - this.dragOffset.y;
      this.windowManager.updatePosition(this.window.id, x, y);
    } else if (this.isResizing) {
      const dx = event.clientX - this.initialPos.x;
      const dy = event.clientY - this.initialPos.y;
      const newWidth = Math.max(300, this.initialSize.width + dx);
      const newHeight = Math.max(200, this.initialSize.height + dy);
      this.windowManager.updateSize(this.window.id, newWidth, newHeight);
    }
  }

  @HostListener('document:mouseup')
  onMouseUp() {
    this.isDragging = false;
    this.isResizing = false;
  }
}
