import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, Input, Renderer2 } from '@angular/core';
import { Observable } from 'rxjs';

@Component({
  selector: 'mtr-dynamic-article-html',
  templateUrl: './dynamic-article-html.component.html',
  styleUrls: ['./dynamic-article-html.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DynamicArticleHtmlComponent implements AfterViewInit {
  @Input() html$!: Observable<string | undefined>;
  @Input() error$!: Observable<any>;

  constructor(private eleRef: ElementRef, private renderer: Renderer2) {}

  ngAfterViewInit(): void {
    this.configureInternalLinks();
  }

  configureInternalLinks(): void {
    const internalLinks = (this.eleRef.nativeElement as HTMLElement).querySelectorAll('.internal-link');
    for (const internalLink of Array.from(internalLinks)) {
      const link = this.renderer.createElement('a') as HTMLAnchorElement;
      this.renderer.setProperty(link, 'href', '#');
      this.renderer.setAttribute(link, 'data-target-id', internalLink.id);
      this.renderer.setAttribute(link, 'title', internalLink.getAttribute('title') ?? '');
      this.renderer.appendChild(link, this.renderer.createText(internalLink.innerHTML));

      this.renderer.insertBefore(internalLink.parentElement, link, internalLink);
      this.renderer.removeChild(internalLink.parentElement, internalLink);

      this.renderer.listen(link, 'click', (event: Event) => {
        this.scrollTo((event.target as HTMLElement).dataset.targetId!);
      });
    }
  }

  scrollTo(idOrName: string): void {
    const modalDiv = document.getElementById('articleModalBody');
    const element =
      modalDiv === null
        ? document.querySelector(`#${idOrName.replace(".","\\.")}`) || document.getElementsByName(idOrName)[0]
        : modalDiv.querySelector(`#${idOrName.replace(".","\\.")}`) || modalDiv.querySelector(`[name='${idOrName}']`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
