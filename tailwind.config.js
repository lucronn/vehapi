/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
        "./src/**/*.{html,ts,tsx}",
        "./index.html"
    ],
    theme: {
        extend: {
            colors: {
                torque: {
                    bg: 'hsl(230, 35%, 7%)',
                    card: 'hsl(230, 35%, 12%)',
                    dark: 'hsl(230, 35%, 9%)',
                    cyan: 'hsl(191, 97%, 50%)',
                    violet: 'hsl(263, 83%, 58%)',
                    purple: 'hsl(263, 83%, 58%)',
                    'text-secondary': 'hsl(215, 20%, 65%)',
                    'text-muted': 'hsl(215, 16%, 47%)',
                }
            },
            fontFamily: {
                heading: ['Outfit', 'sans-serif'],
                sans: ['Inter', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            keyframes: {
                'fade-in': {
                    from: { opacity: '0' },
                    to: { opacity: '1' },
                },
                'fade-in-up': {
                    from: { opacity: '0', transform: 'translateY(20px)' },
                    to: { opacity: '1', transform: 'translateY(0)' },
                },
                'slide-in': {
                    from: { transform: 'translateY(10px)', opacity: '0' },
                    to: { transform: 'translateY(0)', opacity: '1' },
                },
                'scan': {
                    '0%': { transform: 'translateY(-100%)' },
                    '100%': { transform: 'translateY(100vh)' },
                },
                'mesh-drift': {
                    '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
                    '25%': { transform: 'translate(5%, -3%) scale(1.05)' },
                    '50%': { transform: 'translate(-3%, 5%) scale(0.95)' },
                    '75%': { transform: 'translate(3%, 2%) scale(1.02)' },
                },
                'glow-pulse': {
                    '0%, 100%': { opacity: '0.4' },
                    '50%': { opacity: '0.8' },
                },
                'shine-sweep': {
                    '0%': { transform: 'translateX(-100%) skewX(-15deg)' },
                    '100%': { transform: 'translateX(200%) skewX(-15deg)' },
                },
            },
            animation: {
                'fade-in': 'fade-in 0.5s ease-out forwards',
                'fade-in-up': 'fade-in-up 0.6s ease-out forwards',
                'slide-in': 'slide-in 0.3s ease-out',
                'scan': 'scan 8s linear infinite',
                'mesh-drift': 'mesh-drift 60s ease-in-out infinite',
                'glow-pulse': 'glow-pulse 4s ease-in-out infinite',
                'shine-sweep': 'shine-sweep 0.6s ease-out',
            },
        }
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
}
