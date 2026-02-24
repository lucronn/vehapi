import { Component, Input, Output, EventEmitter, signal, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, X, ZoomIn, ZoomOut, RotateCw } from 'lucide-angular';

@Component({
    selector: 'app-image-viewer-modal',
    standalone: true,
    imports: [CommonModule, LucideAngularModule],
    template: `
    <div class="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex flex-col animate-fade-in" 
         (touchstart)="onTouchStart($event)" 
         (touchmove)="onTouchMove($event)" 
         (touchend)="onTouchEnd($event)">
         
      <!-- Toolbar -->
      <div class="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-50 bg-gradient-to-b from-black/80 to-transparent">
        <div class="text-white/70 text-xs uppercase tracking-widest font-bold">Image Viewer</div>
        <button (click)="close.emit()" aria-label="Close image viewer" class="p-3 bg-white/10 rounded-full hover:bg-white/20 transition-colors">
          <lucide-icon [img]="icons.X" class="w-6 h-6 text-white"></lucide-icon>
        </button>
      </div>

      <!-- Image Container -->
      <div class="flex-1 flex items-center justify-center overflow-hidden p-4 relative w-full h-full">
        <img #imageRef
          [src]="imageUrl" 
          [style.transform]="getTransform()"
          class="max-w-full max-h-full object-contain transition-transform duration-100 ease-out origin-center"
          alt="Full screen view"
        />
      </div>

      <!-- Controls (Visible on Desktop mostly) -->
      <div class="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-white/10 backdrop-blur-md px-6 py-3 rounded-full border border-white/5">
        <button (click)="zoomOut()" aria-label="Zoom out" class="p-3 hover:bg-white/10 rounded-lg transition-colors">
            <lucide-icon [img]="icons.ZoomOut" class="w-5 h-5 text-white"></lucide-icon>
        </button>
        <span class="text-white font-mono text-sm w-12 text-center">{{ (scale() * 100).toFixed(0) }}%</span>
        <button (click)="zoomIn()" aria-label="Zoom in" class="p-3 hover:bg-white/10 rounded-lg transition-colors">
            <lucide-icon [img]="icons.ZoomIn" class="w-5 h-5 text-white"></lucide-icon>
        </button>
        <div class="w-px h-6 bg-white/20 mx-2"></div>
         <button (click)="rotate()" aria-label="Rotate image" class="p-3 hover:bg-white/10 rounded-lg transition-colors">
            <lucide-icon [img]="icons.RotateCw" class="w-5 h-5 text-white"></lucide-icon>
        </button>
      </div>
    </div>
  `
})
export class ImageViewerModalComponent {
    @Input() imageUrl: string = '';
    @Output() close = new EventEmitter<void>();

    readonly icons = { X, ZoomIn, ZoomOut, RotateCw };

    scale = signal(1);
    rotation = signal(0);
    translateX = signal(0);
    translateY = signal(0);

    // Touch handling state
    private startDistance = 0;
    private startScale = 1;

    zoomIn() {
        this.scale.update(s => Math.min(s + 0.5, 5));
    }

    zoomOut() {
        this.scale.update(s => Math.max(s - 0.5, 0.5));
    }

    rotate() {
        this.rotation.update(r => r + 90);
    }

    getTransform() {
        return `scale(${this.scale()}) rotate(${this.rotation()}deg) translate(${this.translateX()}px, ${this.translateY()}px)`;
    }

    onTouchStart(event: TouchEvent) {
        if (event.touches.length === 2) {
            this.startDistance = this.getDistance(event.touches[0], event.touches[1]);
            this.startScale = this.scale();
        }
    }

    onTouchMove(event: TouchEvent) {
        if (event.touches.length === 2) {
            event.preventDefault(); // Prevent page scroll
            const currentDistance = this.getDistance(event.touches[0], event.touches[1]);
            const scaleFactor = currentDistance / this.startDistance;
            this.scale.set(Math.max(0.5, Math.min(this.startScale * scaleFactor, 5)));
        }
    }

    onTouchEnd(event: TouchEvent) {
        // Reset logic if needed
    }

    private getDistance(touch1: Touch, touch2: Touch): number {
        return Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
    }
}
