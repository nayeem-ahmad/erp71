import '@testing-library/jest-dom';
import React from 'react';

// Evaluate min-/max-width queries against jsdom's default 1024px viewport instead
// of hardcoding `matches: false` for everything — the old stub silently hid every
// `hideOnMobile` DataTable column in every test, since jsdom defaults to a desktop
// width and this is a desktop-first admin dashboard.
function evaluateMediaQuery(query: string): boolean {
    const width = window.innerWidth;
    const minWidth = query.match(/min-width:\s*(\d+)px/);
    const maxWidth = query.match(/max-width:\s*(\d+)px/);
    if (minWidth && width < Number(minWidth[1])) return false;
    if (maxWidth && width > Number(maxWidth[1])) return false;
    return true;
}

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
        matches: evaluateMediaQuery(query),
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
    })),
});

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