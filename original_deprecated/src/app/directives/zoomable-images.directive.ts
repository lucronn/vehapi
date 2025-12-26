import { Directive, ElementRef, OnDestroy, OnInit } from '@angular/core';
import { fromEvent } from 'rxjs';
import { take } from 'rxjs/operators';
import Viewer from 'viewerjs';
import { AssetsFacade } from '~/assets/state/assets.facade';

class ViewerExtended extends Viewer {
  containerData?: { width: number, height: number };
  image?: HTMLImageElement;
  constructor(element: HTMLElement, options?: Viewer.Options) {
    super(element, options);
  }
}

@Directive({
  selector: '[mtrZoomableImages]',
})
export class ZoomableImagesDirective implements OnInit, OnDestroy {
  constructor(public assetsFacade: AssetsFacade, private eleRef: ElementRef<Element>) {
    assetsFacade.showLicenseMessageForToyota$.pipe(take(1)).subscribe((result) => {
      this.isToyotaVehicle = result;
    });
  }

  static isInsideIframe(element: Element): boolean {
    return element.ownerDocument !== document;
  }

  static isGuid(strValue: string): boolean {
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(strValue);
  }
  isToyotaVehicle = false;

  /** A reference to the currently visible Viewer instance or undefined if no image is currently being shown. */
  viewer?: ViewerExtended;
  isBackNavigation = false;

  readonly alwaysShowLarge: Viewer.ToolbarButtonOptions = {
    show: 1,
    size: 'large',
  };
  // In addition to the default supported values that have predefined icons and behavior any arbitrary key will also produce an element.
  readonly toolbar: Viewer.ToolbarOptions = {
    zoomIn: this.alwaysShowLarge,
    zoomOut: this.alwaysShowLarge,
    oneToOne: this.alwaysShowLarge,
    reset: this.alwaysShowLarge,
    prev: 0,
    play: 0,
    next: 0,
    rotateLeft: 0,
    rotateRight: 0,
    flipHorizontal: 0,
    flipVertical: 0,
    print: this.alwaysShowLarge,
  };

  readonly viewerOptions: Viewer.Options = {
    navbar: false,
    transition: false,
    toolbar: this.toolbar,
    title: (image: HTMLImageElement) => (ZoomableImagesDirective.isGuid(image.alt) ? '' : image.alt),
    show: () => {
      // Prevent opening/closing the print dialog or resizing the window from resetting zoom levels and image position.
      window.addEventListener('resize', this.disableEventPropagation);
    },
    shown: () => {
      if (this.isToyotaVehicle) {
        const licMsgDiv = document.createElement('div');
        licMsgDiv.classList.add('viewer-title');
        licMsgDiv.classList.add('viewer-copyright');
        licMsgDiv.innerText = this.assetsFacade.toyotaLicenseMessage;
        document.querySelector('.viewer-footer')?.appendChild(licMsgDiv);
      }
      document.querySelector('.viewer-print')?.addEventListener('click', this.print);

      this.isBackNavigation = false;
      // Add a dummy state to the history so that if a user presses back to close the viewer they maintain the correct history
      window.history.pushState('', '');
      // Listen for backwards navigation to close the viewer
      window.addEventListener('popstate', this.popstateListener);
    },
    viewed: () => {
      const { containerData, image } = this.viewer || {};
      if (containerData && image) {
        const { width, height } = containerData;
        const { offsetWidth, offsetHeight } = image;
        const maxOffsetPercentage = 0.8;
        const finalWidth = width * maxOffsetPercentage;
        const finalHeight = (height - 126) * maxOffsetPercentage;
        if (offsetWidth < finalWidth && offsetHeight < finalHeight) {
          const targettedWidthPercentage = finalWidth / offsetWidth;
          const targettedHeightPercentage = finalHeight / offsetHeight;
          if (targettedWidthPercentage < targettedHeightPercentage) {
            this.viewer?.zoomTo(targettedWidthPercentage);
          } else {
            this.viewer?.zoomTo(targettedHeightPercentage);
          }
        }
      }
    },
    hide: () => {
      window.removeEventListener('resize', this.disableEventPropagation);
    },
    hidden: () => {
      document.querySelector('.viewer-print')?.removeEventListener('click', this.print);

      window.removeEventListener('popstate', this.popstateListener);
      if (!this.isBackNavigation) {
        // If the viewer was closed without using the back button pop our dummy state from the history
        history.back();
      }

      // Creating a new viewer adds a new div.viewer-container to the dom. In order to support viewing images within iFrames we create a new viewer every time an image is clicked, so we need to clean up the old one when it is closed.
      this.viewer?.destroy();
      this.viewer = undefined;
    },
  };

  popstateListener = (ev: PopStateEvent) => {
    this.isBackNavigation = true;
    this.viewer?.hide(true);
  };

  disableEventPropagation = (ev: UIEvent) => {
    ev.stopImmediatePropagation();
  };

  print = () => {
    document.body.classList.add('printing-specific-content');
    const printableElement = document.querySelector<HTMLImageElement>('.viewer-container .viewer-canvas img')!.cloneNode() as HTMLImageElement;
    const copyrightTag = document.createElement('p');
    const captionTag = document.createElement('p');

    captionTag.textContent = ZoomableImagesDirective.isGuid(printableElement.alt) ? '' : printableElement.alt;
    copyrightTag.textContent = this.isToyotaVehicle ? this.assetsFacade.toyotaLicenseMessage : '';
    printableElement.classList.add('printable');

    copyrightTag.classList.add('printable');
    copyrightTag.style.marginTop = '20px';

    captionTag.classList.add('printable');
    captionTag.style.marginTop = '10px';

    // By default centered content could extend off the right side of the page due to the margins that are set
    if (parseFloat(printableElement.style.marginTop) > 15) {
      printableElement.style.marginTop = '15px';
    }
    if (parseFloat(printableElement.style.marginLeft) > 60) {
      printableElement.style.marginLeft = '60px';
    }

    document.body.appendChild(printableElement);
    document.body.appendChild(captionTag);
    document.body.appendChild(copyrightTag);
    window.print();
    
    fromEvent(window, 'mousemove')
      .pipe(take(1))
      .subscribe(() => {
        document.body.removeChild(captionTag);
        document.body.removeChild(copyrightTag);
        document.body.removeChild(printableElement);
        document.body.classList.remove('printing-specific-content');
      });    
  };

  ngOnInit(): void {
    for (const image of Array.from(this.eleRef.nativeElement.querySelectorAll<HTMLImageElement>('img[src]'))) {
      if(!image.classList.contains('expand-link')) {
        image.style.cursor = 'pointer';
  
        image.addEventListener('click', () => {
          let imageToOpen = image;
          if (ZoomableImagesDirective.isInsideIframe(imageToOpen)) {
            // Our viewer doesn't support images within iframes so we create a copy of the clicked image and open that one.
            imageToOpen = document.createElement('img');
            imageToOpen.src = image.src;
            imageToOpen.alt = image.alt;
          }
  
          this.viewer = new ViewerExtended(imageToOpen, this.viewerOptions);
          if (image.style.transform === 'rotate(90deg)') {
            this.viewer.show().rotateTo(90);
          }
          this.viewer.show();
        });
      }
    }

    for (const image of Array.from(this.eleRef.nativeElement.querySelectorAll<SVGImageElement>('image'))) {
      // The href value could come from either href or xlink:href attributes
      if (!image.href?.baseVal) {
        continue;
      }

      image.style.cursor = 'pointer';

      image.addEventListener('click', () => {
        const imageToOpen = document.createElement('img');
        imageToOpen.src = image.href.baseVal;

        this.viewer = new ViewerExtended(imageToOpen, this.viewerOptions);
        this.viewer.show();
      });
    }
  }

  ngOnDestroy(): void {
    this.viewer?.destroy();
  }
}
