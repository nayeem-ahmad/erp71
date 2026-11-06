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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import RootLayout from './layout';

jest.mock('next/headers', () => ({
    cookies: async () => ({ get: () => undefined }),
}));

// `next/font/local` is a compiler transform; here it hands back the CSS
// variable name it was asked for, which is all the layout uses.
jest.mock('next/font/local', () => ({
    __esModule: true,
    default: jest.fn((options: { variable: string }) => ({ variable: `var${options.variable.replace('--font', '')}` })),
}));

type LocalFontOptions = {
    src: string | { path: string }[];
    variable: string;
    preload?: boolean;
    declarations?: { prop: string; value: string }[];
};

function fontCall(variable: string): LocalFontOptions {
    const localFont = jest.requireMock('next/font/local').default as jest.Mock;
    const call = localFont.mock.calls.find(([options]) => options.variable === variable);
    if (!call) throw new Error(`no localFont call for ${variable}`);
    return call[0] as LocalFontOptions;
}

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
        expect(fontCall('--font-arabic').preload).toBe(false);
        expect(fontCall('--font-inter').preload).not.toBe(false);
        expect(fontCall('--font-bengali').preload).not.toBe(false);
    });

    /*
     * The faces are self-hosted: `next/font/google` downloaded them at build
     * time and failed the build whenever Google answered with a font URL that
     * had no file extension.
     */
    it('serves every face from files in ./fonts, each limited to its script', () => {
        for (const variable of ['--font-inter', '--font-bengali', '--font-arabic']) {
            const options = fontCall(variable);
            const paths = typeof options.src === 'string' ? [options.src] : options.src.map((entry) => entry.path);
            expect(paths.length).toBeGreaterThan(0);
            for (const path of paths) {
                expect(existsSync(join(__dirname, path))).toBe(true);
            }
            expect(options.declarations).toEqual([
                expect.objectContaining({ prop: 'unicode-range', value: expect.stringMatching(/^U\+/) }),
            ]);
        }
        expect(readFileSync(join(__dirname, 'layout.tsx'), 'utf8')).not.toMatch(/from ['"]next\/font\/google['"]/);
    });
});
