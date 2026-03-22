import { expect, test, describe } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

describe('ImageViewerModalComponent Static Analysis', () => {
    // Read the file content
    const componentPath = path.join(import.meta.dir, 'image-viewer-modal.component.ts');
    const content = fs.readFileSync(componentPath, 'utf-8');

    // Extract template (basic extraction assuming single template block)
    const templateMatch = content.match(/template:\s*`([\s\S]*?)`/);
    if (!templateMatch) {
        throw new Error('Could not find template in component file');
    }
    const template = templateMatch[1];

    // Find all button tags
    // This is a simple regex that finds <button ... >
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
                console.error(`Button at index ${index} missing aria-label: ${buttonHtml}`);
            }
            expect(hasAriaLabel).toBe(true);
        });
    });

    test('all buttons should have sufficient padding (at least p-3)', () => {
        buttons.forEach((buttonHtml, index) => {
            // Check for p-3 or p-4 or similar large padding
            // We specifically look for "p-3" or higher, or "p-[12px]" etc.
            // For this test, we just check if it contains p-3, p-4, etc.
            const hasLargePadding = /p-[3-9]/.test(buttonHtml) || /p-\[[1-9][0-9]px\]/.test(buttonHtml);

            if (!hasLargePadding) {
                 console.error(`Button at index ${index} has insufficient padding: ${buttonHtml}`);
            }
            expect(hasLargePadding).toBe(true);
        });
    });
});
