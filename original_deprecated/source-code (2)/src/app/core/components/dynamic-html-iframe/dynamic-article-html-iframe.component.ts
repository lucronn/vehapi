import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ComponentFactoryResolver,
  ComponentRef,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
  ViewContainerRef,
} from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { DynamicArticleHtmlComponent } from '../dynamic-html/dynamic-article-html.component';

@Component({
  selector: 'mtr-dynamic-article-html-iframe',
  templateUrl: './dynamic-article-html-iframe.component.html',
  styleUrls: ['./dynamic-article-html-iframe.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DynamicArticleHtmlIframeComponent implements AfterViewInit, OnDestroy {
  @Input() html$!: Observable<string | undefined>;
  @ViewChild('iframe') iframe?: ElementRef<HTMLIFrameElement>;

  constructor(private vcRef: ViewContainerRef, private resolver: ComponentFactoryResolver) {}

  private iframeHeadSubscription?: Subscription;
  private componentRef?: ComponentRef<DynamicArticleHtmlComponent>;
  private iframeLoaded = false;
  private baseHref = document.head.querySelector('base')?.href;
  private baseHrefHtml = this.baseHref ? `<base href="${this.baseHref}"/>` : '';

  ngAfterViewInit() {
    this.buildIframe();
  }

  onLoad() {
    this.iframeLoaded = true;
    this.buildIframe();
  }

  buildIframe() {
    // On some web browsers such as Chrome, the iframe is loaded before ngAfterViewInit so the iframeElement is not yet available when onLoad is called
    // On other web browsers such as Firefox, the iframe is loaded after ngAfterViewInit so the contents would be cleared if we didn't wait for onLOad
    if (!this.iframeLoaded) {
      return;
    }

    const iframeElement = this.iframe?.nativeElement as HTMLIFrameElement;
    const iframeDoc = iframeElement?.contentDocument ?? iframeElement?.contentWindow?.document;
    if (!iframeDoc) {
      return;
    }

    // We have to recreate the subscription to set the head if the user reloads the frame
    if (this.iframeHeadSubscription) {
      this.iframeHeadSubscription.unsubscribe();
    }

    const htmlDocument = this.html$.pipe(map((html) => (html ? new DOMParser().parseFromString(html, 'text/html') : undefined)));
    this.iframeHeadSubscription = htmlDocument.subscribe((doc) => {
      // tslint:disable: no-inner-html
      // The base href must be set, otherwise IE will use the current URL of the parent window as the base. We also must provide a valid base href prior to setting any head content with links, since setting a new base href at the same time as adding head links will not apply that base href.
      // The base that is set must be an absolute URL otherwise Firefox will not make requests.
      iframeDoc.head.innerHTML = this.baseHrefHtml;
      // var(--primary) of the outer document isn't available within the iframe, so we set it directly.
      const linkColor = getComputedStyle(document.documentElement).getPropertyValue('--link');
      iframeDoc.head.innerHTML = `${this.baseHrefHtml}${doc?.head.innerHTML ?? ''}<style>a { color: ${linkColor} !important; }</style>`;
      // tslint:enable: no-inner-html
    });

    // We don't want to recreate the DynamicArticleHtmlComponent if the user reloads the frame
    if (!this.componentRef) {
      const componentFactory = this.resolver.resolveComponentFactory(DynamicArticleHtmlComponent);
      this.componentRef = this.vcRef.createComponent(componentFactory);
      this.componentRef.instance.html$ = htmlDocument.pipe(
        // Change the body to a div while maintaining styling, etc.
        map((doc) => (doc ? `<div${doc.body.outerHTML.substring(5, doc.body.outerHTML.length - 7)}</div>` : undefined))
      );
    }

    iframeDoc.body.appendChild(this.componentRef.location.nativeElement);
    this.componentRef?.changeDetectorRef.detectChanges(); // On Chrome, the component is created after change detection when switching between articles
  }

  ngOnDestroy() {
    this.iframeHeadSubscription?.unsubscribe();
    this.componentRef?.destroy();
  }
}
