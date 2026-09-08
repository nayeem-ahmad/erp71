import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            sourceFiles(full, acc);
        } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
            acc.push(full);
        }
    }
    return acc;
}

describe('UI guardrails', () => {
    /**
     * The app is light-only: `tailwind.config.js` sets no `darkMode`, so Tailwind
     * falls back to the `media` strategy and any `dark:` class activates from the
     * viewer's OS setting alone — no toggle, no opt-in.
     *
     * That makes a stray `dark:` worse than inconsistent. It renders one module
     * dark inside an otherwise light app, and because the paired light class only
     * ever sets the *background* (text colour is inherited), values render dark on
     * dark and vanish. The Project Management module shipped that way: on a
     * dark-mode machine its cards were near-black with the Status, Priority,
     * Manager, Target end and Budget values invisible.
     *
     * It is invisible to anyone reviewing on a light-mode machine, which is why
     * this is a test rather than a convention. If the app ever grows a real dark
     * theme, delete this — but do it by adding `darkMode: 'class'` and a toggle,
     * not by letting the OS decide per-module.
     */
    it('has no dark: variants anywhere in app source', () => {
        const offenders = sourceFiles(SRC)
            .map((file) => ({ file, hits: readFileSync(file, 'utf8').match(/\bdark:[^\s'"`]+/g) }))
            .filter((entry): entry is { file: string; hits: RegExpMatchArray } => entry.hits !== null)
            .map((entry) => `${entry.file.replace(SRC, 'src')}: ${[...new Set(entry.hits)].join(', ')}`);

        expect(offenders).toEqual([]);
    });

    /**
     * Dates render `dd/MM/yyyy` platform-wide, via `formatDate`/`formatDateTime`
     * in `src/lib/format.ts`. Three ways of writing a date bypass that and put
     * American `M/D/YYYY` on the screen, all of them silent:
     *
     * - No locale at all (`toLocaleDateString()`, or `undefined`) resolves to the
     *   *viewer's browser* locale, so the same invoice reads `08/09/2026` in Dhaka
     *   and `9/8/2026` for anyone on a US-English machine.
     * - `'en-BD'` looks like the Bangladesh tag but is not a locale ICU carries.
     *   It falls back to `en` — that is, to `en-US` ordering — so the tag that
     *   reads most deliberately is the one that produced month-first dates on
     *   printed sales invoices and purchase receipts.
     * - The app's own locale codes (`'en'`, `'bn'`) are not date locales either:
     *   `'en'` resolves to `en-US`. `formatDate` maps them through the registry
     *   (`en` → `en-GB`, `bn` → `bn-BD`); passing one straight to `Intl` skips it.
     *
     * Chart ticks, heatmap keys and `en-CA` day keys pass a real locale with
     * explicit options and are untouched by this — the patterns below match only
     * the three broken spellings.
     */
    it('renders no date through a missing, bogus or unmapped locale', () => {
        const BAD_ARG = String.raw`\s*(?:\)|undefined\b|'en-BD'|locale\s*\))`;
        const patterns = [
            // `.toLocaleDateString()` is only ever called on a Date, so any bad
            // first argument to it is a date-rendering bug wherever it appears.
            new RegExp(String.raw`\.toLocaleDateString\(${BAD_ARG}`, 'g'),
            // `.toLocaleString()` also formats numbers, so only flag it where the
            // receiver is visibly a Date.
            new RegExp(
                String.raw`new Date\((?:[^()]|\([^()]*\))*\)\s*\.toLocaleString\(${BAD_ARG}`,
                'g',
            ),
        ];

        const offenders = sourceFiles(SRC)
            .map((file) => {
                const src = readFileSync(file, 'utf8');
                const hits = patterns.flatMap((re) => src.match(re) ?? []);
                return { file, hits };
            })
            .filter((entry) => entry.hits.length > 0)
            .map((entry) => `${entry.file.replace(SRC, 'src')}: ${[...new Set(entry.hits)].join(', ')}`);

        expect(offenders).toEqual([]);
    });
});
