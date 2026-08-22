/**
 * Physical Tailwind utilities do not mirror under `dir="rtl"`, so a single
 * `ml-2` that creeps back into a component is a layout bug that only Arabic and
 * Urdu users ever see — and nothing else in the suite renders in RTL to catch
 * it.
 *
 * This runs the same transform `scripts/rtl-codemod.js` applies and asserts it
 * is a no-op across the whole app.
 */
import path from 'node:path';
import fs from 'node:fs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { transform, walk, shouldSkip, ROOT } = require('../../../../../scripts/rtl-codemod.js');

describe('RTL: no physical Tailwind utilities', () => {
    it('leaves every source file unchanged', () => {
        const offenders: string[] = [];

        for (const file of walk(ROOT)) {
            if (shouldSkip(file)) continue;

            const source = fs.readFileSync(file, 'utf8');
            if (transform(source) !== source) {
                offenders.push(path.relative(ROOT, file));
            }
        }

        // Named rather than counted, so a failure says which file to fix.
        expect(offenders).toEqual([]);
    });
});
