import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            // Existing specs import `bun:test`; map to Vitest without editing spec files (C2).
            'bun:test': 'vitest',
        },
    },
    test: {
        globals: true,
        environment: 'happy-dom',
        include: ['src/**/*.spec.ts'],
        setupFiles: ['./vitest.setup.ts'],
        css: false,
    },
});
