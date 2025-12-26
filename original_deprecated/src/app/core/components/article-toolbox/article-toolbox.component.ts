import { ChangeDetectionStrategy, Component, HostListener, Input } from '@angular/core';
import { BehaviorSubject, combineLatest, fromEvent, Observable } from 'rxjs';
import { distinctUntilChanged, finalize, map, take } from 'rxjs/operators';
import { AssetsFacade } from '~/assets/state/assets.facade';
import { UserSettingsService } from '~/core/user-settings/user-settings.service';
import { ContentSource } from '~/generated/api/models';
import { BookmarkApi } from '~/generated/api/services';
import { MaintenanceSchedulesFacade } from '~/maintenance-schedules/state/maintenance-schedules.facade';
import { MaintenanceSchedulesByIndicatorQuery, MaintenanceSchedulesByIntervalQuery } from '~/maintenance-schedules/state/maintenance-schedules.query';
import { isIE } from '~/utilities';
import { VehicleSelectionFacade } from '~/vehicle-selection/state/state/vehicle-selection.facade';
import { ArticleToolboxService } from './article-toolbox.service';

@Component({
  selector: 'mtr-article-toolbox',
  templateUrl: './article-toolbox.component.html',
  styleUrls: ['./article-toolbox.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleToolboxComponent {
  constructor(
    public assetsFacade: AssetsFacade,
    private vehicleSelectionFacade: VehicleSelectionFacade,
    private bookmarkApi: BookmarkApi,
    public userSettings: UserSettingsService,
    private pmsstByIntervalQuery: MaintenanceSchedulesByIntervalQuery,
    private pmsstByIndicatorQuery: MaintenanceSchedulesByIndicatorQuery,
    private pmsstFacade: MaintenanceSchedulesFacade,
    private articleToolboxService: ArticleToolboxService
  ) {}

  @Input() iframeSelector?: string;

  isSavingBookmark$ = new BehaviorSubject(false);

  isDefaultPrinting$: Observable<boolean> = combineLatest([this.assetsFacade.isMaintenanceScheduleTab$, this.assetsFacade.labor$]).pipe(
    map(([ispmsst, islabor]) => {
      return !ispmsst && islabor === undefined;
    })
  );

  pmsstPrintEnable$: Observable<boolean> = combineLatest([
    this.assetsFacade.isMaintenanceScheduleTab$,
    this.pmsstByIndicatorQuery.selectCount(),
    this.pmsstByIntervalQuery.selectCount(),
    this.pmsstFacade.maintenanceSchedulesByFrequency$,
  ]).pipe(
    distinctUntilChanged(),
    map(([ispmsstTab, pmsstByIndicatorCount, pmsstByIntervalCount, pmsstByFrequency]) => {
      return ispmsstTab && (pmsstByIndicatorCount > 0 || pmsstByIntervalCount > 0 || pmsstByFrequency !== undefined);
    })
  );

  print(hideImages: boolean) {
    const iframeContentWindow = this.iframeSelector && document.querySelector<HTMLIFrameElement>(this.iframeSelector)?.contentWindow;
    
    if (iframeContentWindow) {
      this.printIframeWindow(iframeContentWindow, hideImages);
    } else {
      if (this.isSVG()) {
        this.printSVG(hideImages);
      } else {
        let asset = this.assetsFacade.getActiveHtml() ?? '';
        this.assetsFacade.showLicenseMessageForToyota$.pipe(take(1)).subscribe(x => {

          if(x) {
            const copyrightElm = document.createElement('div');
            copyrightElm.classList.add('copyright-article-modal');
            copyrightElm.innerText = this.assetsFacade.toyotaLicenseMessage;
            asset = copyrightElm.outerHTML.toString() + asset;
          }

          this.printHtml(asset, hideImages);
        });
        
      }
    }
  }
  isSVG() {
    const asset = this.assetsFacade.getActiveHtml() ?? '';
    return (asset.startsWith('\n<svg') || asset.startsWith('<svg')) && !isIE();
  }

  printIframeWindow(contentWindow: Window, hideImages: boolean) {
    let hideImagesStyleElement: HTMLStyleElement | undefined;

    if (hideImages) {
      hideImagesStyleElement = contentWindow.document.createElement('style');

      let contentSource: ContentSource | undefined;
      this.vehicleSelectionFacade.contentSource$.pipe(take(1)).subscribe((v) => (contentSource = v));

      hideImagesStyleElement.textContent =
        contentSource === ContentSource.Honda
          ? '@media print { img { display: none !important; } div.fig { display:none !important } }'
          : '@media print { img { display: none !important; } }';

      contentWindow.document.head.appendChild(hideImagesStyleElement);
    }

    // execCommand provides IE compatibility
    if (!contentWindow.document.execCommand?.('print', false)) {
      contentWindow.print();
    }

    if (hideImagesStyleElement) {
      contentWindow.document.head.removeChild(hideImagesStyleElement);
    }
  }

  printHtml(html: string, hideImages: boolean) {
    if (hideImages) {
      document.body.classList.add('hide-images');
    }

    let contentSource: ContentSource | undefined;
    this.vehicleSelectionFacade.contentSource$.pipe(take(1)).subscribe((v) => (contentSource = v));

    let activeArticleId: string | undefined;
    this.assetsFacade.activeArticleId$.pipe(take(1)).subscribe((v) => (activeArticleId = v));

    document.body.classList.add('printing-specific-content');
    const printableElement = document.createElement('div');
    printableElement.classList.add('printable');
    printableElement.classList.add(`article-${contentSource}`);
    if(hideImages) {
      printableElement.classList.add('printable--hide-images');
    }
   
    if(contentSource === ContentSource.Nissan){
      const printableHtml = html.replace(/figure_rotate|img_rotate/g, '');
       // tslint:disable-next-line: no-inner-html
      printableElement.innerHTML = printableHtml;
    }else{
       // tslint:disable-next-line: no-inner-html
      printableElement.innerHTML = html;
    }

    const imgElm = printableElement.querySelector('img');
    if(!hideImages && imgElm && (contentSource === ContentSource.Nissan || contentSource === ContentSource.Stellantis) && activeArticleId?.startsWith("W:")) {
      this.articleToolboxService.getContentFromUrl(imgElm.src).subscribe(response => {
        if(response.indexOf('<svg') > -1) {
          const responseImg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          // tslint:disable-next-line: no-inner-html
          responseImg.innerHTML = response;
          this.printSVGPromise(responseImg).then((promiseResponse) => {
            if(promiseResponse) {
              if(promiseResponse === true) {
                document.body.appendChild(printableElement);
                this.printPrintableElement(hideImages);
              } else {
                const divElement:HTMLDivElement = promiseResponse as HTMLDivElement;
                const divElm = document.createElement('div');
                divElm.style.pageBreakBefore = 'always';
                divElement.appendChild(divElm);
                imgElm.replaceWith(divElement);
                document.body.appendChild(printableElement);
                setTimeout(() => {
                  this.printPrintableElement(hideImages);
                });
              }
            }
          });
        } else {
          document.body.appendChild(printableElement);
          this.printPrintableElement(hideImages);
        }
      });
    } else if(imgElm && activeArticleId?.startsWith("L:")) {
      if(hideImages) {
        document.body.classList.remove('hide-images');
        const imgElms = printableElement.querySelectorAll('img');
        imgElms.forEach(img => {
          if(!img.closest('#print-header-banner')) {
            img.parentElement?.classList.add('hide-images');
          }
        });
      }
      document.body.appendChild(printableElement);
      if(imgElm.complete) {
        this.printPrintableElement(hideImages);
      } else {
        imgElm.onload = () => {
          this.printPrintableElement(hideImages);
        }
      } 
    } else {
      document.body.appendChild(printableElement);
      this.printPrintableElement(hideImages);
    }
  }

  printPrintableElement(hideImages: boolean) {
    window.print();

    // We need to undo our changes exactly once after the print dialog is closed. However different browsers (especially mobile) have inconsistent behavior - some pause synchronous javascript execution until the print dialog is closed, some don't. Some browsers fire the afterprint event after calling print, some after the print dialog is closed, and some fire it in both places. Since our modifications make no change to the on screen display we have no need to undo our changes exactly when the print dialog is closed, we can just trigger it once after a common event that will only fire once printing is complete.
    fromEvent(window, 'mousemove')
      .pipe(take(1))
      .subscribe(() => {
        if (hideImages) {
          document.body.classList.remove('hide-images');
        }

        const printableElm = document.getElementsByClassName('printable')[0];
        if (printableElm) {
          document.body.removeChild(printableElm);
        }
        document.body.classList.remove('printing-specific-content');
      });    
  }

  printSVGPromise(image: SVGSVGElement) {
    return new Promise((resolve, reject) => {
      const widthOfOnePiece = 1000;
      const heightOfOnePiece = 1400;
      const svgElm = image.querySelector('svg');
      if(svgElm) {
        const dimensions: Array<number> | Array<string> = svgElm.getAttribute('viewBox')?.split(' ') || [0,0,0,0];
        let imageWidth: number = +dimensions[2];
        let imageHeight: number = +dimensions[3];
        if(imageWidth && imageHeight) {
          if(imageWidth < widthOfOnePiece && imageHeight < heightOfOnePiece) {
            const imgProportion = widthOfOnePiece/imageWidth;
            imageWidth *= imgProportion;
            imageHeight *= imgProportion;
          }
          const columns = Math.ceil(imageWidth / widthOfOnePiece);
          const rows = Math.ceil(imageHeight / heightOfOnePiece);
          const imagePieces: Array<string> = [];
          const printableElement: HTMLDivElement = document.createElement('div');
          svgElm.setAttribute('width', `${Math.round(imageWidth)}px`);
          svgElm.setAttribute('height', `${Math.round(imageHeight)}px`);
          this.svgToPng(svgElm, (imgData: string) => {
            const pngImage = document.createElement('img');
            pngImage.src = imgData;
            pngImage.onload = () => {
              if(rows === 1 && columns === 1) {
                resolve(true);
              } else {
                for (let i = 0; i < rows; i++) {
                  for (let j = 0; j < columns; j++) {
                    const canvas = document.createElement('canvas');
                    canvas.width = widthOfOnePiece;
                    canvas.height = heightOfOnePiece;
                    const context = canvas.getContext('2d')!;
                    context.drawImage(
                      pngImage,
                      j * widthOfOnePiece,
                      i * heightOfOnePiece,
                      widthOfOnePiece,
                      heightOfOnePiece,
                      0,
                      0,
                      widthOfOnePiece,
                      heightOfOnePiece
                    );
                    const text = `(${i + 1}, ${j + 1})`;
                    context.globalCompositeOperation = 'xor';
                    context.font = '25px Comic Sans';
                    context.globalAlpha = 0.7;
                    context.textAlign = 'left';
                    context.fillText(text, context.measureText(text).width, canvas.height);
                    imagePieces.push(canvas.toDataURL('image/png'));
                  }
                }
                imagePieces.forEach((item: string) => {
                  const newImage = document.createElement('img');
                  newImage.src = item;
                  printableElement.appendChild(newImage);
                  URL.revokeObjectURL(item);
                });
                resolve(printableElement);
              }
            };
          }, {width: imageWidth, height: imageHeight});
        }
      }
    });
  }

  printSVG(hideImages: boolean) {
    if (hideImages) {
      document.body.classList.add('hide-images');
    }
    document.body.classList.add('printing-specific-content');
    const printableElement = document.createElement('div');
    printableElement.classList.add('printable');

    const svgImage = document.querySelector('svg')!;
    const widthOfOnePiece = 1000;
    const heightOfOnePiece = 1400;
    const columns = Math.ceil(svgImage?.clientWidth / widthOfOnePiece);
    const rows = Math.ceil(svgImage?.clientHeight / heightOfOnePiece);

    const imagePieces: Array<string> = [];
    this.svgToPng(svgImage, (imgData: string) => {
      const pngImage = document.createElement('img');
      pngImage.src = imgData;
      pngImage.onload = () => {
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < columns; j++) {
            const canvas = document.createElement('canvas');
            canvas.width = widthOfOnePiece;
            canvas.height = heightOfOnePiece;
            const context = canvas.getContext('2d')!;
            context.drawImage(
              pngImage,
              j * widthOfOnePiece,
              i * heightOfOnePiece,
              widthOfOnePiece,
              heightOfOnePiece,
              0,
              0,
              widthOfOnePiece,
              heightOfOnePiece
            );
            const text = `(${i + 1}, ${j + 1})`;
            context.globalCompositeOperation = 'xor';
            context.font = '25px Comic Sans';
            context.globalAlpha = 0.7;
            context.textAlign = 'left';
            context.fillText(text, context.measureText(text).width, canvas.height - 10);
            imagePieces.push(canvas.toDataURL());
          }
        }

        imagePieces.forEach((item: string) => {
          const newImage = document.createElement('img');
          printableElement.appendChild(newImage);
          newImage.src = item;
          URL.revokeObjectURL(item);
        });
        document.body.appendChild(printableElement);
        setTimeout(() => {
          this.printPrintableElement(hideImages);
        }, 250);
      };
    });
  }

  svgToPng(svg: SVGSVGElement, callback: (imgData: string) => void, svgDimension?: {width: number, height: number}) {
    const url = this.getSvgUrl(svg);
    this.svgUrlToPng(url, (imgData: string) => {
      callback(imgData);
      URL.revokeObjectURL(url);
    }, svgDimension);
  }

  getSvgUrl(svg: SVGSVGElement) {
    const data = new XMLSerializer().serializeToString(svg);
    return URL.createObjectURL(new Blob([data], { type: 'image/svg+xml' }));
  }
  
  svgUrlToPng(svgUrl: string, callback: (imgData: string) => void, svgDimension?: {width: number, height: number}) {
    const svgImage = document.createElement('img');
    svgImage.style.display = 'none';
    document.body.appendChild(svgImage);
    svgImage.onload = () => {
      const svgImgWidth = svgDimension?.width || svgImage.width;
      const svgImgHeight = svgDimension?.height || svgImage.height;
      const canvas = document.createElement('canvas');
      canvas.width = svgImgWidth;
      canvas.height = svgImgHeight;
      const canvasCtx = canvas.getContext('2d');
      canvasCtx?.drawImage(svgImage, 0, 0);
      const imgData = canvas.toDataURL('image/png');
      callback(imgData);
      document.body.removeChild(svgImage);
    };
    svgImage.src = svgUrl;
  }

  bookmark() {
    combineLatest([this.vehicleSelectionFacade.contentSource$, this.vehicleSelectionFacade.activeVehicleId$, this.assetsFacade.activeArticleId$])
      .pipe(take(1))
      .subscribe(([contentSource, vehicleId, articleId]) => {
        if (!contentSource || !vehicleId || !articleId) {
          throw new Error(
            `Unable to request bookmark creation as necessary information is missing. contentSource: ${contentSource}, vehicleId: ${vehicleId}, articleId: ${articleId}`
          );
        }

        this.isSavingBookmark$.next(true);
        this.bookmarkApi
          .saveBookmark({ contentSource, vehicleId, articleId })
          .pipe(
            finalize(() => {
              this.isSavingBookmark$.next(false);
            })
          )
          .subscribe((bookmarkResponse) => {
            const bookmarkId = bookmarkResponse.body?.id;

            // DO NOT check if window.external.execute is undefined before calling it. In CCC's system reading the function causes it to be called with no parameters and therefore throw an error.
            try {
              // @ts-ignore
              // tslint:disable-next-line
              window.external.execute(
                `<request xmlns='http://cccis.com/ONE/BrowserAPI' xmlns:xs='http://cccis.com/ONE/BrowserAPI'><xs:add_bookmark><xs:bookmark>${bookmarkId}</xs:bookmark></xs:add_bookmark></request>`
              );
            } catch (e) {
              if (!(e instanceof Error && e.message.indexOf('window.external.execute is not a function') !== -1)) {
                throw e;
              }
            }
          });
      });
  }

  printMaintenanceSchedules() {
    this.printHtml(document.querySelector('div#pmsstContent')?.outerHTML ?? '', true);
  }

  printLaborDetails() {
    this.printHtml(document.querySelector('div#articleContainer')?.outerHTML ?? '', true);
  }
}
