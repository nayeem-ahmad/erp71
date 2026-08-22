import { NAV_REGISTRY } from '@erp71/shared-types';
import { messageCatalog } from './localization/messages';

/**
 * Every `labelKey` in NAV_REGISTRY must resolve to a real message.
 *
 * `resolveLabel` in nav-resolver.ts falls back to returning the key itself when
 * it cannot resolve one, so a mistyped or misplaced key does not throw, does not
 * warn, and does not fail any other test — it just renders the literal string
 * `sidebar.items.importShipments` in the sidebar, in every language.
 *
 * That is exactly what happened when the Imports section was added: its three
 * labels were written into the `nav` block instead of `sidebar.items`. The
 * catalog parity test passed because all locales were wrong in the same way,
 * and nothing else looked. This is the test that would have caught it.
 */

function resolve(messages: unknown, key: string): unknown {
    return key.split('.').reduce<unknown>((acc, part) => {
        if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
            return (acc as Record<string, unknown>)[part];
        }
        return undefined;
    }, messages);
}

/** Mirrors resolveLabel: a bare string, or an object with a string `title`. */
function isRenderable(value: unknown): boolean {
    if (typeof value === 'string') return true;
    return Boolean(
        value &&
            typeof value === 'object' &&
            typeof (value as { title?: unknown }).title === 'string',
    );
}

describe('nav registry label keys', () => {
    const entries = Object.values(NAV_REGISTRY);

    it('has a non-trivial registry to check', () => {
        // Guards the test itself: an empty registry would pass vacuously.
        expect(entries.length).toBeGreaterThan(50);
    });

    for (const [locale, messages] of Object.entries(messageCatalog)) {
        it(`resolves every labelKey in ${locale}`, () => {
            const unresolved = entries
                .filter((entry) => !isRenderable(resolve(messages, entry.labelKey)))
                .map((entry) => `${entry.id} -> ${entry.labelKey}`)
                .sort();

            // Named rather than counted, so a failure says which entry to fix.
            expect(unresolved).toEqual([]);
        });
    }
});
