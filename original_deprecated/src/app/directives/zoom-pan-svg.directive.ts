import { Directive, ElementRef, OnInit } from '@angular/core';

@Directive({
  selector: '[mtrZoomPanSVG]',
})
export class ZoomPanSVGDirective implements OnInit {
  constructor(private eleRef: ElementRef<HTMLElement>) {}

  pannableSvg?: SVGSVGElement | null;
  scrollableParent?: HTMLElement | null;

  isPointerDown = false;
  isPointerMoveQueued = false;

  lastPointerX = 0;
  lastPointerY = 0;

  firstPointerX = 0;
  firstPointerY = 0;
  wasMoved = false;

  ngOnInit(): void {
    this.scrollableParent = this.eleRef.nativeElement;
    while (this.scrollableParent && window.getComputedStyle(this.scrollableParent).overflow !== 'auto') {
      this.scrollableParent = this.scrollableParent.parentElement;
    }
    this.scrollableParent = this.scrollableParent ?? this.eleRef.nativeElement.ownerDocument.body;

    const svgs = Array.from(this.eleRef.nativeElement.querySelectorAll('svg'));
    for (const svg of svgs) {
      // Fix IE randomly creating excess whitespace below and to the right of SVGs
      svg.style.overflow = 'hidden';

      this.convertPercentageWidth(svg);
      this.zoomOnMouseWheel(svg);
    }

    if (svgs.length === 1) {
      this.pannableSvg = svgs[0];
      // Only enable panning if the initial SVG size is large enough to produce a horizontal scrollbar.
      if ((this.pannableSvg.parentNode as HTMLElement).clientWidth < this.pannableSvg.clientWidth) {
        // Match our image viewer cursor styles - grab in supported browsers, move in IE
        // @ts-ignore Using nonstandard documentMode to detect IE
        this.pannableSvg.style.cursor = document.documentMode ? 'move' : 'grab';

        this.pannableSvg.addEventListener('pointerdown', this.pointerDown);

        this.pannableSvg.addEventListener('pointermove', (event) => {
          // Prevent text highlighting while panning
          event.preventDefault();

          this.throttledPointerMove(event);
        });

        this.pannableSvg.addEventListener('pointerup', this.moveEnd);
        this.pannableSvg.addEventListener('pointercancel', this.moveEnd);
      }
    }
  }

  pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }

    // Since we're using requestAnimationFrame to throttle move events we also need to use it for pointerDown and pointerUp to avoid events being handled in the wrong order.
    requestAnimationFrame(() => {
      this.isPointerDown = true;
      this.lastPointerX = this.firstPointerX = event.clientX;
      this.lastPointerY = this.firstPointerY = event.clientY;
    });
  };

  /** Will call pointerMove only once per frame, regardless of how many times it is called. This optimization is so common that it's performed automatically by modern browsers, so this is really just because IE. */
  throttledPointerMove = (event: PointerEvent) => {
    if (!this.isPointerMoveQueued) {
      this.isPointerMoveQueued = true;
      requestAnimationFrame(() => {
        this.isPointerMoveQueued = false;
        this.pointerMove(event);
      });
    }
  };

  pointerMove = (event: PointerEvent) => {
    if (!this.isPointerDown || !this.scrollableParent) {
      return;
    }

    const xDistance = event.clientX - this.lastPointerX;
    const yDistance = event.clientY - this.lastPointerY;

    this.scrollableParent.scrollLeft = this.scrollableParent.scrollLeft - xDistance;
    this.scrollableParent.scrollTop = this.scrollableParent.scrollTop - yDistance;

    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;

    // After there's been enough movement to determine the SVG is being panned set the SVG element as the target for all future events with the same pointerId (eg while the mouse is still being held down). This ensures panning continues even if the pointer exits the SVG's bounding rectangle and prevents links and images from opening if the drag started from on top of them.
    if (!this.wasMoved && (Math.abs(this.lastPointerX - this.firstPointerX) > 10 || Math.abs(this.lastPointerY - this.firstPointerY) > 10)) {
      this.wasMoved = true;
      this.pannableSvg?.setPointerCapture(event.pointerId);
    }
  };

  moveEnd = (event: PointerEvent) => {
    requestAnimationFrame(() => {
      this.wasMoved = false;
      this.isPointerDown = false;
    });
  };

  zoomOnMouseWheel(svg: SVGSVGElement) {
    svg.addEventListener(
      'wheel',
      (event) => {
        if (event.ctrlKey) {
          event.preventDefault();

          const scale = event.deltaY > 0 ? 1 / 1.1 : 1.1;
          svg.setAttribute('height', `${svg.clientHeight * scale}px`);
          svg.setAttribute('width', `${svg.clientWidth * scale}px`);

          // Adjust the scroll position so that viewport stays constant relative to the pointer position
          if (this.scrollableParent) {
            const rect = svg.getBoundingClientRect();
            this.scrollableParent.scrollLeft += (event.clientX - rect.left) * (scale - 1);
            this.scrollableParent.scrollTop += (event.clientY - rect.top) * (scale - 1);
          }
        }
      },
      { passive: false }
    );
  }

  convertPercentageWidth(svg: SVGSVGElement) {
    if (svg.width.baseVal.unitType === SVGLength.SVG_LENGTHTYPE_PERCENTAGE) {
      const viewBox = svg.viewBox.baseVal;

      let maxWidth = (svg.parentNode as HTMLElement).clientWidth;
      // Prevent zooming in too far in the modal or on ultra wide screens
      maxWidth = Math.min(maxWidth, 1300);

      const pixelWidth = (maxWidth * svg.width.baseVal.valueInSpecifiedUnits) / 100;
      svg.width.baseVal.newValueSpecifiedUnits(SVGLength.SVG_LENGTHTYPE_PX, pixelWidth);

      const pixelHeight = (pixelWidth / viewBox.width) * viewBox.height;
      svg.height.baseVal.newValueSpecifiedUnits(SVGLength.SVG_LENGTHTYPE_PX, pixelHeight);
    }
  }
}
