import { messageCatalog } from './index';

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