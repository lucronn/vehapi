/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ['class', '[data-theme="dark"]'],
    content: [
        './src/**/*.{html,ts,tsx}',
        './index.html',
    ],
    theme: {
        extend: {
            colors: {
                // Calm palette: warm bone paper + warm ink + sage accent. All
                // values are CSS vars so [data-theme="dark"] flips the whole
                // system without touching component classes.
                paper:        'var(--paper)',
                surface:      'var(--surface)',
                ink:          'var(--ink)',
                muted:        'var(--muted)',
                faint:        'var(--faint)',
                hairline:     'var(--hairline)',
                accent:       'var(--accent)',
                'accent-soft':'var(--accent-soft)',
                danger:       'var(--danger)',
                // Legacy "torque-*" aliases so any un-migrated class keeps
                // compiling during the redesign rollout.
                torque: {
                    bg:                 'var(--paper)',
                    card:               'var(--surface)',
                    dark:               'var(--surface)',
                    cyan:               'var(--accent)',
                    violet:             'var(--accent)',
                    purple:             'var(--accent)',
                    'text-secondary':   'var(--muted)',
                    'text-muted':       'var(--faint)',
                    secondary:          'var(--muted)',
                    muted:              'var(--faint)',
                },
            },
            fontFamily: {
                display: ['"Fraunces"', 'ui-serif', 'Georgia', 'serif'],
                heading: ['"Fraunces"', 'ui-serif', 'Georgia', 'serif'],
                sans:    ['"Geist"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
                mono:    ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
            },
            letterSpacing: {
                tightest: '-0.04em',
                eyebrow:  '0.18em',
            },
            keyframes: {
                'fade-in':    { from: { opacity: '0' }, to: { opacity: '1' } },
                'fade-in-up': { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
                'rise':       { from: { opacity: '0', transform: 'translateY(8px)' },  to: { opacity: '1', transform: 'translateY(0)' } },
            },
            animation: {
                'fade-in':    'fade-in 0.6s ease-out forwards',
                'fade-in-up': 'fade-in-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards',
                'rise':       'rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards',
            },
        },
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
};
