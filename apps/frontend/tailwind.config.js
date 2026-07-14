import defaultTheme from 'tailwindcss/defaultTheme';

/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './src/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    theme: {
        extend: {
            colors: {
                primary: {
                    DEFAULT: '#2563eb',
                    hover: '#1d4ed8',
                    light: '#eff6ff',
                    border: '#bfdbfe',
                },
                success: {
                    DEFAULT: '#059669',
                    light: '#ecfdf5',
                    text: '#047857',
                },
                warning: {
                    DEFAULT: '#f59e0b',
                    light: '#fffbeb',
                    text: '#b45309',
                },
                danger: {
                    DEFAULT: '#dc2626',
                    light: '#fef2f2',
                    text: '#b91c1c',
                },
                canvas: '#f3f4f6',
                surface: '#ffffff',
            },
            fontFamily: {
                sans: ['var(--font-inter)', 'var(--font-bengali)', ...defaultTheme.fontFamily.sans],
            },
            zIndex: {
                modal: '60',
                toast: '70',
            },
            keyframes: {
                'hero-float': {
                    '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
                    '33%': { transform: 'translate(24px, -18px) scale(1.04)' },
                    '66%': { transform: 'translate(-18px, 14px) scale(0.96)' },
                },
                'hero-float-slow': {
                    '0%, 100%': { transform: 'translate(0, 0)' },
                    '50%': { transform: 'translate(-32px, 24px)' },
                },
                'hero-drift': {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(-12px)' },
                },
            },
            animation: {
                'hero-float': 'hero-float 22s ease-in-out infinite',
                'hero-float-slow': 'hero-float-slow 28s ease-in-out infinite',
                'hero-drift': 'hero-drift 18s ease-in-out infinite',
            },
            spacing: {
                'safe-top': 'env(safe-area-inset-top, 0px)',
                'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
                'safe-left': 'env(safe-area-inset-left, 0px)',
                'safe-right': 'env(safe-area-inset-right, 0px)',
            },
            minHeight: {
                touch: '2.75rem',
            },
            minWidth: {
                touch: '2.75rem',
            },
        },
    },
    plugins: [],
}
