import {
    PERSON_SECTIONS,
    type DevicePrefs,
    type LegacyBrowserSection,
    type MyPreferencesResponse,
    type PersonSectionKey,
    type PreferenceSectionKey,
    type SectionPartials,
} from '@erp71/shared-types';
import { api } from '@/lib/api';
import { readStoredPaperSize, readStoredSkipPreview } from '@/lib/hooks/useSalePrintPrefs';
import { readStoredPrintDensity } from '@/lib/print/density';
import { readStoredPrintTypeScale } from '@/lib/print/type-scale';
import { displayedSection } from '@/lib/preferences/use-preference-section';

/**
 * Where each sidebar keeps this browser's collapsed answer: the app shell's in
 * `AppShellSidebar.tsx` (`STORAGE.collapsed`), the classic one's in `Sidebar.tsx`.
 * Named here rather than imported so copying a setup does not pull either
 * sidebar into the page that copies it.
 */
const SIDEBAR_COLLAPSED_KEY = { appShell: 'app-shell-collapsed', classic: 'sidebar-collapsed' } as const;

function isPersonSection(key: PreferenceSectionKey): key is PersonSectionKey {
    return (PERSON_SECTIONS as readonly string[]).includes(key);
}

function readStoredSidebarCollapsed(appShell: boolean): boolean | null {
    if (typeof window === 'undefined') return null;
    try {
        const stored = window.localStorage.getItem(appShell ? SIDEBAR_COLLAPSED_KEY.appShell : SIDEBAR_COLLAPSED_KEY.classic);
        if (stored === 'true') return true;
        if (stored === 'false') return false;
    } catch {
        // Storage blocked: this browser has no answer we can read.
    }
    return null;
}

/**
 * This browser's own device answers — only those it has stored. A value this
 * browser merely falls back to (the shop's paper size, the member's profile,
 * the built-in normal) is not something the admin chose here, and copying it
 * would freeze today's fallback into the profile.
 */
function readStoredDevice(appShell: boolean): DevicePrefs {
    const device: DevicePrefs = {};
    const paperSize = readStoredPaperSize();
    if (paperSize) device.paperSize = paperSize;
    const printDensity = readStoredPrintDensity();
    if (printDensity) device.printDensity = printDensity;
    const printTypeScale = readStoredPrintTypeScale();
    if (printTypeScale) device.printTypeScale = printTypeScale;
    const skipPreview = readStoredSkipPreview();
    if (skipPreview !== null) device.skipPreview = skipPreview;
    const sidebarCollapsed = readStoredSidebarCollapsed(appShell);
    if (sidebarCollapsed !== null) device.sidebarCollapsed = sidebarCollapsed;
    return device;
}

/**
 * What the signed-in admin sees now in each chosen section, as profile values —
 * "Copy from my settings" in the profile editor sends this as it is.
 *
 * Person sections are read fresh from `GET /preferences/me` — copying is an
 * explicit admin action, worth one request, and the store's copy can be behind
 * a save made elsewhere (Print settings saves the invoice layout through its
 * own endpoint). They are drawn by the same rule `usePreferenceSection` uses
 * (`displayedSection`), so a section the admin still sees from this browser's
 * old answers is copied with them.
 *
 * `device` is this browser's stored answers only (see `readStoredDevice`), and
 * the sidebar's collapsed answer is read from whichever sidebar is in use —
 * `appShell` says which, from `useAppShell().enabled`.
 */
export async function collectMySettings(
    sections: PreferenceSectionKey[],
    options: { appShell?: boolean } = {},
): Promise<SectionPartials> {
    const out: SectionPartials = {};
    const personKeys = sections.filter(isPersonSection);

    const data: MyPreferencesResponse | null = personKeys.length > 0 ? await api.getMyPreferences() : null;

    for (const key of personKeys) {
        const listedAsLegacy = data?.legacy_browser_sections.includes(key as LegacyBrowserSection) ?? false;
        const shown = displayedSection(key, data?.sections[key], listedAsLegacy);
        (out as Record<string, unknown>)[key] = shown.value;
    }
    if (sections.includes('device')) out.device = readStoredDevice(options.appShell ?? false);
    return out;
}
