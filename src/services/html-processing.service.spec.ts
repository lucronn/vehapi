vi.mock('@angular/core', () => ({
  Injectable: () => (target: any) => target,
  inject: (token: any) => {
    return {};
  }
}));

describe('HtmlProcessingService', () => {
  let HtmlProcessingService: any;
  let service: any;
  const baseUrl = 'https://vehapiproxi.vercel.app';

  beforeEach(async () => {
    const module = await import('./html-processing.service');
    HtmlProcessingService = module.HtmlProcessingService;
    if (HtmlProcessingService) {
      service = new HtmlProcessingService();
    }
  });

  describe('processHtmlContent', () => {
    test('should return empty string for empty input', () => {
      expect(service.processHtmlContent('', baseUrl)).toBe('');
      expect(service.processHtmlContent(null as any, baseUrl)).toBe('');
      expect(service.processHtmlContent(undefined as any, baseUrl)).toBe('');
    });

    test('should process mtr-doc-link tags with context', () => {
      const input = '<mtr-doc-link id="123">Click Here</mtr-doc-link>';
      const expected = `<a href="#/vehicle/source1/vehicle1/article/123" class="text-cyan-400 hover:text-cyan-300 underline">Click Here</a>`;
      const result = service.processHtmlContent(input, baseUrl, 'source1', 'vehicle1');
      expect(result).toBe(expected);
    });

    test('should process mtr-doc-link tags without context (fallback to text)', () => {
      const input = '<mtr-doc-link id="123">Click Here</mtr-doc-link>';
      const expected = 'Click Here';
      const result = service.processHtmlContent(input, baseUrl);
      expect(result).toBe(expected);
    });

    test('should process mtr-image tags', () => {
      const input = `<mtr-image id='img123'></mtr-image>`;
      const resultWithContext = service.processHtmlContent(input, baseUrl, 'source1', 'vehicle1');
      expect(resultWithContext).toContain(`<img src="${baseUrl}/api/source/source1/graphic/img123" class="article-image" >`);

      const resultNoContext = service.processHtmlContent(input, baseUrl);
      expect(resultNoContext).toContain(`<img src="${baseUrl}/graphic/img123" class="article-image" >`);
    });

    test('should process src attributes with relative paths', () => {
      const input = '<img src="../images/test.jpg">';
      const expected = `<img src="${baseUrl}/images/test.jpg">`;
      expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });

    test('should process src attributes with root-relative paths', () => {
      const input = '<img src="/images/test.jpg">';
      const expected = `<img src="${baseUrl}/images/test.jpg">`;
      expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });

    test('should process src attributes with API paths', () => {
      const input = '<script src="/api/script.js"></script>';
      const expected = `<script src="${baseUrl}/api/script.js"></script>`;
      expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });

    test('should not change absolute URLs in src', () => {
      const input = '<img src="https://example.com/image.jpg">';
      const expected = '<img src="https://example.com/image.jpg">';
      expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });

    test('should not change URLs already containing baseUrl in src', () => {
      const input = `<img src="${baseUrl}/image.jpg">`;
      const expected = `<img src="${baseUrl}/image.jpg">`;
      expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });

    test('should process data-src attributes', () => {
      const input = '<img data-src="image.jpg">';
      const expected = `<img data-src="${baseUrl}/image.jpg">`;
      expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });

    test('should process href attributes for internal links', () => {
      const input = '<a href="page.html">Link</a>';
      const expected = `<a href="${baseUrl}/page.html">Link</a>`;
      expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });

    test('should not process href attributes for external links', () => {
      const input = '<a href="https://google.com">Google</a>';
      const expected = '<a href="https://google.com">Google</a>';
      expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });

    test('should not process href attributes for anchors', () => {
      const input = '<a href="#section1">Section 1</a>';
      const expected = '<a href="#section1">Section 1</a>';
      expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });

    test('should not process href attributes for javascript', () => {
      const input = '<a href="javascript:void(0)">JS</a>';
      const expected = '<a href="javascript:void(0)">JS</a>';
      expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });

    test('should process background-image styles', () => {
      const input = '<div style="background-image: url(\'bg.jpg\')"></div>';
      const expected = `<div style="background-image: url("${baseUrl}/bg.jpg")"></div>`;
      expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });

    test('should process background-image styles without quotes', () => {
      const input = '<div style="background-image: url(bg.jpg)"></div>';
      const expected = `<div style="background-image: url(${baseUrl}/bg.jpg)"></div>`;
      expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });

    test('should process srcset attributes', () => {
      const input = '<img srcset="img1.jpg 1x, img2.jpg 2x">';
      const expected = `<img srcset="${baseUrl}/img1.jpg 1x, ${baseUrl}/img2.jpg 2x">`;
      expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });

    test('should handle quoted and unquoted attributes', () => {
      const input = '<img src=image.jpg>';
      const result = service.processHtmlContent(input, baseUrl);
      expect(result).toBe(`<img src="${baseUrl}/image.jpg">`);

      const inputSingle = "<img src='image.jpg'>";
      const resultSingle = service.processHtmlContent(inputSingle, baseUrl);
      expect(resultSingle).toBe(`<img src="${baseUrl}/image.jpg">`);
    });

    test('should handle whitespace in attributes', () => {
      const input = '<img src="  image.jpg  ">';
      const expected = `<img src="${baseUrl}/image.jpg">`;
      expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });

    test('should handle relative paths with ./', () => {
        const input = '<img src="./image.jpg">';
        const expected = `<img src="${baseUrl}/image.jpg">`;
        expect(service.processHtmlContent(input, baseUrl)).toBe(expected);
    });
  });
});
