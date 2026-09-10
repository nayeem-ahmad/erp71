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
import type { ReactElement } from 'react';

import RootLayout from './layout';

jest.mock('next/headers', () => ({
    cookies: async () => ({ get: () => undefined }),
}));

jest.mock('next/font/google', () => ({
    Inter: () => ({ variable: 'var-inter' }),
    Noto_Sans_Bengali: () => ({ variable: 'var-bengali' }),
    Noto_Sans_Arabic: () => ({ variable: 'var-arabic' }),
}));

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
});
