import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const GLOBALS_CSS = join(SRC, 'app', 'globals.css');

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
     * The `<select>` reset lives in `globals.css` rather than on the `Select`
     * primitive, so nothing in the component tree fails when it goes missing —
     * the app just quietly hands every dropdown back to the browser. Safari on
     * macOS then draws its own menulist and discards the control recipe
     * wholesale, which is the regression this guards.
     */
    describe('native select reset', () => {
        const css = readFileSync(GLOBALS_CSS, 'utf8');
        const ltr = /(?<!\])\s(select:not\(\[multiple\]\))\s*\{([^}]*)\}/.exec(css);

        it('takes the browser control out of the box and redraws its arrow', () => {
            expect(ltr).not.toBeNull();
            const body = ltr![2];
            expect(body).toMatch(/(^|[^-])appearance:\s*none/);
            expect(body).toMatch(/background-image:\s*url\("data:image\/svg\+xml,/);
        });

        /**
         * The gutter that keeps the option text off the chevron is the fragile
         * half. It has to beat the `px-*`/`pe-*` utility each of the ~150
         * hand-rolled selects carries, and it only does so because
         * `:not([multiple])` lifts the selector to specificity (0,1,1) — drop
         * the qualifier and the padding silently reverts at every one of them.
         */
        it('reserves the chevron gutter with a selector that outranks utility padding', () => {
            expect(ltr![1]).toContain(':not([multiple])');
            // Logical, so one declaration covers both directions.
            expect(ltr![2]).toMatch(/padding-inline-end:\s*[\d.]+rem/);
        });

        it('moves the chevron to the inline start under RTL', () => {
            expect(css).toMatch(
                /\[dir='rtl'\]\s+select:not\(\[multiple\]\)\s*\{[^}]*background-position:\s*left/,
            );
        });
    });
});
