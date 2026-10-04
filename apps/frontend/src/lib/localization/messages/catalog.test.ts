import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { messageCatalog } from '@/test-utils/message-catalog';
import { messageLoaders } from './index';

function collectPaths(value: unknown, prefix = ''): string[] {
    if (typeof value === 'string') {
        return [prefix];
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return [prefix || '<root>'];
    }

    return Object.entries(value as Record<string, unknown>)
        .flatMap(([key, nested]) => collectPaths(nested, prefix ? `${prefix}.${key}` : key))
        .sort();
}

describe('message catalog completeness', () => {
    const baseline = collectPaths(messageCatalog.en);

    for (const [locale, messages] of Object.entries(messageCatalog)) {
        it(`${locale} matches the English catalog structure`, () => {
            expect(collectPaths(messages)).toEqual(baseline);
        });
    }
});

describe('message loaders', () => {
    it('has a loader for every language but English, which is bundled', () => {
        expect(Object.keys(messageLoaders).sort()).toEqual(
            Object.keys(messageCatalog).filter((locale) => locale !== 'en').sort(),
        );
    });

    // A loader pointed at the wrong file type-checks fine — every dictionary
    // has the same shape — and would show Hindi to everyone who picked Bangla.
    for (const [locale, load] of Object.entries(messageLoaders)) {
        it(`loads the ${locale} dictionary itself`, async () => {
            await expect(load()).resolves.toBe(messageCatalog[locale as keyof typeof messageCatalog]);
        });
    }
});

/*
 * One static import of a non-English dictionary from app code puts that
 * language back into the bundle of every page that reaches it, silently — the
 * app still works, it just downloads more. Tests and the test-only full
 * catalogue are exempt: they are never bundled.
 */
describe('non-English dictionaries stay out of the bundle', () => {
    const srcRoot = join(__dirname, '../../..');
    const messagesDir = __dirname;
    const staticDictionaryImport =
        /(?:from\s*|require\(\s*)['"][^'"]*\/messages\/(?:bn|ms|hi|de|fr|es|ur|ar)(?:['"/])/;

    function sourceFiles(dir: string): string[] {
        return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                return path === messagesDir || entry.name === 'test-utils' ? [] : sourceFiles(path);
            }
            return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [path] : [];
        });
    }

    it('no app module imports one statically', () => {
        const offenders = sourceFiles(srcRoot)
            .filter((path) => staticDictionaryImport.test(readFileSync(path, 'utf8')))
            .map((path) => relative(srcRoot, path));

        expect(offenders).toEqual([]);
    });
});
