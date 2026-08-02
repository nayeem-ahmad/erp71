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
});
