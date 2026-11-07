/**
 * The typeface reaches the whole document, or it reaches almost none of it.
 *
 * Tailwind's preflight declares `html { font-family: var(--font-inter),
 * var(--font-bengali), var(--font-arabic), ... }`. A `var()` that resolves to
 * nothing makes the entire declaration invalid at computed-value time, so
 * hanging the `next/font` variable classes off `<body>` silently dropped
 * `<html>` — and therefore `<body>`, which inherits it — to the browser's
 * default font. Only subtrees that spelled out `font-sans` themselves escaped;
 * the storefront, the public quotation view and every `document.body` portal
 * did not. Under `lang="bn"` the browser resolves that default per language,
 * which is why Bangla users saw a system Bengali face on Latin text.
 *
 * Rendering is unnecessary to pin this down (and `<html>` inside a jsdom
 * container is its own fight) — the element tree the layout returns says
 * everything.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { ReactElement } from 'react';

import RootLayout from './layout';

jest.mock('next/headers', () => ({
    cookies: async () => ({ get: () => undefined }),
}));

type LocalFontOpts = {
    src: string | Array<{ path: string }>;
    variable: string;
    preload?: boolean;
};

jest.mock('next/font/local', () =>
    jest.fn((opts: LocalFontOpts) => ({
        variable:
            opts.variable === '--font-inter'
                ? 'var-inter'
                : opts.variable === '--font-bengali'
                  ? 'var-bengali'
                  : 'var-arabic',
    })),
);

async function renderTree() {
    const html = (await RootLayout({ children: null })) as ReactElement<{
        className: string;
        children: ReactElement<{ className: string }>;
    }>;
    return { html, body: html.props.children };
}

describe('RootLayout', () => {
    it('declares every font variable on <html>, where preflight reads them', async () => {
        const { html } = await renderTree();

        expect(html.type).toBe('html');
        expect(html.props.className).toContain('var-inter');
        expect(html.props.className).toContain('var-bengali');
        expect(html.props.className).toContain('var-arabic');
    });

    it('keeps <body> on the sans stack so the app survives losing the preflight rule', async () => {
        const { body } = await renderTree();

        expect(body.type).toBe('body');
        expect(body.props.className).toContain('font-sans');
    });

    /*
     * A preloaded font is fetched by every page before it needs it. Bangla
     * product names show in the English UI too, so Bengali earns that; Arabic
     * script is only for the `ar` and `ur` interfaces, and unpreloaded it still
     * arrives the moment a page actually uses it.
     */
    it('preloads Inter and Bengali for everyone, but not the Arabic face', () => {
        const byVariable = localFontCalls();

        expect(byVariable['--font-arabic'].preload).toBe(false);
        expect(byVariable['--font-inter'].preload).not.toBe(false);
        expect(byVariable['--font-bengali'].preload).not.toBe(false);
    });

    /*
     * next/font/google fetches CSS from fonts.googleapis.com at `next build`.
     * When that response is empty or HTML, the loader throws
     * `Cannot read properties of null (reading '1')` and the whole frontend
     * image fails — including the VPS deploy. Local files remove that fetch.
     */
    it('loads each face from a local woff2, so a Google Fonts outage cannot fail the build', () => {
        const byVariable = localFontCalls();

        for (const key of ['--font-inter', '--font-bengali', '--font-arabic']) {
            const src = byVariable[key].src;
            const paths = typeof src === 'string' ? [src] : src.map((entry) => entry.path);
            expect(paths.length).toBeGreaterThan(0);
            for (const filePath of paths) {
                expect(filePath).toMatch(/\.woff2$/);
                expect(existsSync(resolve(__dirname, filePath))).toBe(true);
            }
        }
    });
});

function localFontCalls(): Record<string, LocalFontOpts> {
    const localFont = jest.requireMock('next/font/local') as jest.Mock;
    return Object.fromEntries(localFont.mock.calls.map(([opts]: [LocalFontOpts]) => [opts.variable, opts]));
}
