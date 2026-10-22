'use client';

import { useMemo } from 'react';
import {
    DEFAULT_SECTION_VALUES,
    LEGACY_BROWSER_SECTIONS,
    normalizeSectionPartial,
    resolvePreferences,
    type LegacyBrowserSection,
    type PreferenceSectionKey,
    type PreferenceSource,
    type SectionValues,
} from '@erp71/shared-types';
import { currentViewUserKey } from '@/components/table/view-user-key';
import { readLegacyBrowserSection } from './legacy';
import { usePreferencesStore } from './store';

function isLegacySection(key: PreferenceSectionKey): key is LegacyBrowserSection {
    return (LEGACY_BROWSER_SECTIONS as readonly string[]).includes(key);
}

/**
 * Puts this browser's old answers under the server's value for one section.
 *
 * The server resolves a section without the browser layer, so it can only tell
 * us the result (`value`) and where it came from (`source`). When that source
 * is `profile` or `default` the member has no answer of their own, so the
 * browser's leftovers sit between them and the profile: they are merged over
 * the server value with the resolver's own rules and the source becomes
 * `browser`. When the source is `member` the member has answered and the
 * browser is ignored. A browser blob that says nothing readable leaves the
 * server value as it was.
 */
export function applyLegacyLayer<K extends LegacyBrowserSection>(
    key: K,
    server: { value: SectionValues[K]; source: PreferenceSource },
    legacy: unknown,
): { value: SectionValues[K]; source: PreferenceSource } {
    if (legacy === undefined) return server;
    if (server.source !== 'profile' && server.source !== 'default') return server;

    const answers = normalizeSectionPartial(key, legacy);
    if (Object.keys(answers as object).length === 0) return server;

    // The server's value stands in for the layers below the browser; the resolver
    // merges the browser's answers over it exactly as it would over a profile.
    const merged = resolvePreferences({
        profile: { version: 1, sections: { [key]: server.value } },
        legacy: { [key]: legacy },
    })[key];
    return { value: merged.value as SectionValues[K], source: 'browser' };
}

/**
 * One preference section, already resolved for display. `ready` is false until
 * the first response (or the cached one) has arrived; until then `value` is the
 * built-in default, which a screen must not save back as the member's answer.
 */
export function usePreferenceSection<K extends PreferenceSectionKey>(
    key: K,
): { ready: boolean; value: SectionValues[K]; source: PreferenceSource } {
    const section = usePreferencesStore((state) => state.data?.sections[key]);
    const listedAsLegacy = usePreferencesStore(
        (state) => state.data?.legacy_browser_sections.includes(key as LegacyBrowserSection) ?? false,
    );

    return useMemo(() => {
        if (!section) return { ready: false, value: DEFAULT_SECTION_VALUES[key], source: 'default' as const };
        const server = { value: section.value as SectionValues[K], source: section.source };
        // Only a section the server still lists is read from the browser: a member who has
        // answered, or joined after the move, never inherits a shared till's leftovers.
        if (!listedAsLegacy || !isLegacySection(key)) return { ready: true, ...server };
        const legacy = readLegacyBrowserSection(key, currentViewUserKey());
        return { ready: true, ...applyLegacyLayer(key, server as never, legacy) } as {
            ready: boolean;
            value: SectionValues[K];
            source: PreferenceSource;
        };
    }, [key, section, listedAsLegacy]);
}
