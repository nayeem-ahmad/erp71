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

/**
 * Only the React-context half of `@/lib/i18n` is stubbed. `formatMessage` is
 * re-exported from the real module rather than reimplemented: the hand-rolled
 * copy that used to live here was a bare `replaceAll`, so once catalogs grew
 * ICU plural blocks it would have rendered `{count, plural, one {# job} …}`
 * verbatim in every component test while the browser showed "1 job" — a mock
 * drifting from the thing it mocks, asserted against by 200+ suites.
 */
jest.mock('@/lib/i18n', () => {
    const actual = jest.requireActual('@/lib/i18n');
    const { enMessages } = require('@/lib/localization/messages/en');
    const localeInfo = { code: 'en', label: 'English', nativeLabel: 'English', htmlLang: 'en', dir: 'ltr', numberLocale: 'en-US', dateLocale: 'en-GB', enabled: true };

    return {
        ...actual,
        useI18n: () => ({
            locale: 'en',
            setLocale: jest.fn(),
            locales: [],
            localeInfo,
            t: enMessages,
            fmt: (template: string, values: Record<string, string | number> = {}) =>
                actual.formatMessage(template ?? '', values, 'en'),
        }),
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

/**
 * jsdom's Blob/File implementation has no `.text()` (or `.arrayBuffer()`), so
 * any code exercising the real browser `File.prototype.text()` API — e.g. the
 * spreadsheet parser reading an uploaded CSV — throws "file.text is not a
 * function" under this jest environment even though the same code works fine
 * in a browser. jsdom does implement FileReader, so polyfill `.text()` on top
 * of that rather than changing the implementation under test.
 */
if (typeof window !== 'undefined' && typeof (window as any).Blob !== 'undefined' && typeof (window as any).Blob.prototype.text !== 'function') {
    (window as any).Blob.prototype.text = function (this: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
            reader.onerror = () => reject(reader.error);
            reader.readAsText(this);
        });
    };
}

/**
 * jsdom implements no object URLs. The rich text editor builds one for every
 * pasted image so the picture is on screen while its bytes go up, so any
 * component holding an editor needs these to exist.
 *
 * Counted rather than constant: a test that pastes two images has to be able
 * to tell their previews apart.
 */
if (typeof URL !== 'undefined' && typeof URL.createObjectURL !== 'function') {
    let objectUrls = 0;
    URL.createObjectURL = () => `blob:jsdom/${(objectUrls += 1)}`;
    URL.revokeObjectURL = () => {
        // Nothing was allocated, so there is nothing to release.
    };
}

/**
 * ProseMirror measures the document to place a caret, and jsdom implements
 * neither `getClientRects` nor `getBoundingClientRect` on a Range. Without
 * them an insert lands at position 0 rather than where the user was typing,
 * and deleting a node throws outright — so the rich text editor's tests would
 * be asserting against a layout engine that is not there.
 *
 * Zeroed rather than faked: nothing under test depends on where an element
 * actually is on screen, only on not crashing while asking.
 */
if (typeof Range !== 'undefined') {
    if (typeof Range.prototype.getClientRects !== 'function') {
        Range.prototype.getClientRects = () => ({
            length: 0,
            item: () => null,
            [Symbol.iterator]: function* () {},
        }) as unknown as DOMRectList;
    }
    if (typeof Range.prototype.getBoundingClientRect !== 'function') {
        Range.prototype.getBoundingClientRect = () =>
            ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
    }
}

/**
 * Web storage does not reset between tests the way component state does, so a
 * test that changes a remembered setting — a list's filters, a view toggle —
 * would otherwise seed every test after it in the same file. Cleared here
 * rather than per suite so nobody has to remember it when adding the next one.
 */
afterEach(() => {
    try {
        window.sessionStorage.clear();
        window.localStorage.clear();
    } catch {
        // Storage unavailable in this environment; nothing to reset.
    }
});
