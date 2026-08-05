import '@testing-library/jest-dom';
import React from 'react';

// Route handler tests (e.g. src/app/s/[code]/route.test.ts) opt into the
// `node` Jest environment via an `@jest-environment node` docblock, since
// `next/server`'s NextRequest needs the real Web Fetch API globals that jsdom
// doesn't provide. This file still runs first in that environment, so guard
// every window-only setup step the same way the PointerEvent polyfill below
// already does.
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: jest.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: jest.fn(),
            removeListener: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
        })),
    });
}

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    return {
        useI18n: () => ({
            locale: 'en',
            setLocale: jest.fn(),
            locales: [],
            localeInfo: { code: 'en', label: 'English', nativeLabel: 'English', htmlLang: 'en', dir: 'ltr', numberLocale: 'en-US', dateLocale: 'en-GB', enabled: true },
            t: enMessages,
        }),
        formatMessage: (template: string, values: Record<string, string | number> = {}) =>
            Object.entries(values).reduce(
                (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                template ?? '',
            ),
        I18nProvider: ({ children }: { children: React.ReactNode }) => children,
    };
});

const mockIcon = (name: string) => (props: any) => React.createElement('div', { ...props, 'data-testid': `${name}-icon` });

const icons: any = {
  Mail: mockIcon('mail'),
  Lock: mockIcon('lock'),
  Loader2: mockIcon('loader'),
  ArrowRight: mockIcon('arrow-right'),
};

jest.mock('lucide-react', () => {
    return new Proxy(icons, {
        get: (target, prop) => {
            if (prop in target) return target[prop];
            return mockIcon(String(prop).toLowerCase());
        }
    });
});
/**
 * jsdom implements no PointerEvent, and Testing Library's fallback quietly
 * drops `pointerType`, `pointerId` and `button` — a handler branching on any of
 * them sees `undefined` and takes a path it would never take in a browser. That
 * makes pointer-driven UI (the project board's card dragging) untestable, or
 * worse, testable in a way that passes for the wrong reason.
 *
 * MouseEvent already carries button/clientX/clientY, so the polyfill only has
 * to add the pointer fields.
 */
if (typeof window !== 'undefined' && typeof (window as any).PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
        readonly pointerId: number;
        readonly pointerType: string;
        readonly isPrimary: boolean;

        constructor(type: string, params: PointerEventInit = {}) {
            super(type, params);
            this.pointerId = params.pointerId ?? 0;
            this.pointerType = params.pointerType ?? '';
            this.isPrimary = params.isPrimary ?? true;
        }
    }
    (window as any).PointerEvent = PointerEventPolyfill;
    (globalThis as any).PointerEvent = PointerEventPolyfill;
}
