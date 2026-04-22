import { LoggerService } from '@/src/services/logger.service';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('ImageViewerModalComponent Static Analysis', () => {
    const componentPath = path.join(__dirname, 'image-viewer-modal.component.ts');
    const content = fs.readFileSync(componentPath, 'utf-8');

    const templateMatch = content.match(/template:\s*`([\s\S]*?)`/);
    if (!templateMatch) {
        throw new Error('Could not find template in component file');
    }
    const template = templateMatch[1];

    const buttonRegex = /<button([\s\S]*?)>/g;
    const buttons: string[] = [];
    let match;
    while ((match = buttonRegex.exec(template)) !== null) {
        buttons.push(match[0]);
    }

    test('should have buttons', () => {
        expect(buttons.length).toBeGreaterThan(0);
    });

    test('all buttons should have aria-label', () => {
        buttons.forEach((buttonHtml, index) => {
            const hasAriaLabel = /aria-label=["']/.test(buttonHtml) || /\[attr.aria-label\]=["']/.test(buttonHtml);
            if (!hasAriaLabel) {
                this.logger.error(`Button at index ${index} missing aria-label: ${buttonHtml}`);
            }
            expect(hasAriaLabel).toBe(true);
        });
    });

    test('all buttons should have sufficient padding (at least p-3)', () => {
        buttons.forEach((buttonHtml, index) => {
            const hasLargePadding = /p-[3-9]/.test(buttonHtml) || /p-\[[1-9][0-9]px\]/.test(buttonHtml);

            if (!hasLargePadding) {
                 this.logger.error(`Button at index ${index} has insufficient padding: ${buttonHtml}`);
            }
            expect(hasLargePadding).toBe(true);
        });
    });
});
