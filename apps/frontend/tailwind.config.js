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
                // Chart-only categorical hue. `primary` is the single accent, but a
                // two-series chart needs a second neutral hue and the status tokens
                // (success/warning/danger) are reserved for state. Validated against
                // primary on white: CVD ΔE 29.9, contrast 3.6:1.
                series: {
                    2: '#eb6834',
                    '2-light': '#fdece4',
                },
                canvas: '#f3f4f6',
                surface: '#ffffff',
            },
            fontFamily: {
                sans: ['var(--font-inter)', 'var(--font-bengali)', 'var(--font-arabic)', ...defaultTheme.fontFamily.sans],
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
                // Board motion. Deliberately short and one-shot: a card settling
                // into its column is feedback about where it landed, and anything
                // that loops or lasts long enough to notice turns a working
                // surface into a demo. Every use goes out under `motion-safe:`.
                'board-card-in': {
                    from: { opacity: '0', transform: 'translateY(4px) scale(0.98)' },
                    to: { opacity: '1', transform: 'none' },
                },
                'board-column-in': {
                    from: { opacity: '0', transform: 'translateY(6px)' },
                    to: { opacity: '1', transform: 'none' },
                },
                'board-drop-in': {
                    from: { opacity: '0', transform: 'scaleX(0.4)' },
                    to: { opacity: '1', transform: 'none' },
                },
                'board-menu-in': {
                    from: { opacity: '0', transform: 'translateY(-4px) scale(0.98)' },
                    to: { opacity: '1', transform: 'none' },
                },
            },
            animation: {
                'hero-float': 'hero-float 22s ease-in-out infinite',
                'hero-float-slow': 'hero-float-slow 28s ease-in-out infinite',
                'hero-drift': 'hero-drift 18s ease-in-out infinite',
                // `both` so a staggered card is invisible during its delay rather
                // than painting, vanishing and fading back in.
                'board-card-in': 'board-card-in 200ms ease-out both',
                'board-column-in': 'board-column-in 260ms ease-out both',
                'board-drop-in': 'board-drop-in 140ms ease-out',
                'board-menu-in': 'board-menu-in 120ms ease-out',
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
