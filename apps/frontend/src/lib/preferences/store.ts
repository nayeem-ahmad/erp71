import { create } from 'zustand';
import {
    LEGACY_BROWSER_SECTIONS,
    normalizeSectionPartial,
    type LegacyBrowserSection,
    type MyPreferencesResponse,
    type PersonSectionKey,
    type PreferenceSource,
    type ResolvedPreferences,
    type SectionValues,
} from '@erp71/shared-types';
import { currentViewUserKey } from '@/components/table/view-user-key';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { readLegacyBrowserSection } from './legacy';
import { isCurrentPreferencesScope } from './scope';

/**
 * The signed-in member's preferences, as the server resolved them.
 *
 * The server never applies the browser layer, so `data.sections` is what the
 * member would see on a clean browser; `usePreferenceSection` adds the legacy
 * browser answers on top for the sections still listed in
 * `legacy_browser_sections`.
 *
 * A change is applied here at once (optimistic) and sent after a short pause,
 * one PATCH per section however many edits land in the window — dragging a
 * column or toggling a few sidebar groups is a burst, not a series of saves.
 * When the server answers, its value replaces ours; when it refuses, the
 * section goes back to what it was and the member is told.
 */

/** How long a section waits for further edits before it is sent. */
export const SAVE_DEBOUNCE_MS = 500;

/** Replaced with the active language by `usePreferencesLoader`; this is the fallback. */
let saveFailedMessage = 'Could not save your setting.';

export function setPreferenceSaveFailedMessage(message: string): void {
    saveFailedMessage = message;
}

type ResolvedSection = { value: unknown; source: PreferenceSource };

interface PendingSave {
    /** Every edit since the last send, folded into one request body. */
    body: unknown;
    /**
     * The first save of a section still shown from this browser's old answers: `body`
     * carries those answers with the edits on top (see `browserAnswersBody`).
     */
    whole: boolean;
    timer: ReturnType<typeof setTimeout>;
    /** The section as it was before the first of those edits. */
    rollback: ResolvedPreferences[PersonSectionKey];
}

interface PreferencesState {
    ready: boolean;
    /** `<tenantId>:<userId>` the data belongs to. */
    scopeKey: string | null;
    data: MyPreferencesResponse | null;
    hydrate(scopeKey: string, data: MyPreferencesResponse): void;
    /** Forgets the data and cancels (never sends) every unsent save — for sign-out and switches. */
    clear(): void;
    /**
     * Applies `optimistic` now and PATCHes `body` after the debounce. Ignored until preferences have
     * loaded, and while the store holds someone else's (`scopeKey` is not the tab's current one).
     */
    save<K extends PersonSectionKey>(key: K, body: unknown, optimistic: SectionValues[K]): void;
    reset(key: PersonSectionKey): Promise<void>;
    /**
     * Takes a section the member just saved through another endpoint (Print settings saves
     * `invoicePrint` through `/sales-settings/my-invoice-print`) as their own answer, so the
     * store does not go on showing the value from before until the next load. No request.
     */
    adoptSaved<K extends PersonSectionKey>(key: K, value: SectionValues[K]): void;
}

const pending = new Map<PersonSectionKey, PendingSave>();
/** The latest queued or running request per section; later requests wait for it. */
const inFlight = new Map<PersonSectionKey, Promise<void>>();
/**
 * What a failed save hands to the request already queued behind it, which is
 * sent next in its place: the failed body when it was a whole first save, and
 * the section as it was before the failed edits.
 */
const handedOn = new Map<PersonSectionKey, { body?: unknown; rollback: ResolvedPreferences[PersonSectionKey] }>();
/** Bumped whenever the data's owner changes, so a late response for the old owner is ignored. */
let generation = 0;
const settledListeners = new Set<(data: MyPreferencesResponse) => void>();

/**
 * Called with the store's data each time a save or reset leaves nothing
 * unsaved — the moment it is worth copying to a cache. Returns the unsubscribe.
 */
export function onPreferencesSettled(listener: (data: MyPreferencesResponse) => void): () => void {
    settledListeners.add(listener);
    return () => settledListeners.delete(listener);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Folds a later edit into an earlier one for the same section, the way the
 * server would have applied them one after the other.
 */
function mergeBodies(key: PersonSectionKey, earlier: unknown, later: unknown): unknown {
    if (!isRecord(earlier) || !isRecord(later)) return later;
    switch (key) {
        case 'tableView': {
            const merged: Record<string, unknown> = {};
            if (earlier.global || later.global) {
                merged.global = {
                    ...(isRecord(earlier.global) ? earlier.global : {}),
                    ...(isRecord(later.global) ? later.global : {}),
                };
            }
            if (earlier.tables || later.tables) {
                // A list's entry is one decision, replaced whole.
                merged.tables = {
                    ...(isRecord(earlier.tables) ? earlier.tables : {}),
                    ...(isRecord(later.tables) ? later.tables : {}),
                };
            }
            return merged;
        }
        case 'alerts': {
            const merged: Record<string, unknown> = { ...earlier, ...later };
            if (earlier.quiet || later.quiet) {
                merged.quiet = {
                    ...(isRecord(earlier.quiet) ? earlier.quiet : {}),
                    ...(isRecord(later.quiet) ? later.quiet : {}),
                };
            }
            return merged;
        }
        case 'sidebar':
            // The open groups are one list; the latest is the whole answer.
            return later;
        default:
            // tableColumns (per list, replaced whole) and invoicePrint (field by field).
            return { ...earlier, ...later };
    }
}

function isLegacySection(key: PersonSectionKey): key is LegacyBrowserSection {
    return (LEGACY_BROWSER_SECTIONS as readonly string[]).includes(key);
}

/**
 * This browser's own old answers for a section, as a save body — or undefined
 * when the member is not being shown any: the section is not listed in
 * `legacy_browser_sections`, the member already has an answer of their own on
 * the server, or this browser holds nothing readable for it.
 *
 * Any save takes the section off that list, and from then on the server never
 * reads this browser for it. Sending just the change would drop every other
 * answer the browser held for the section (another list's columns, say);
 * sending the value on screen would freeze the profile's and the built-in
 * values into the member's own answers, so they would stop following later
 * profile changes. The first save therefore sends exactly the browser's answers
 * with the change on top (Ruling R11). The normalised partial is already in
 * body shape: the per-list map for `tableColumns`, `{ global, tables }` for
 * `tableView`. The sidebar's body is always the whole list, so `mergeBodies`
 * leaves the caller's as it is.
 */
function browserAnswersBody(key: PersonSectionKey, data: MyPreferencesResponse): unknown | undefined {
    if (!isLegacySection(key) || !data.legacy_browser_sections.includes(key)) return undefined;
    if (data.sections[key].source === 'member') return undefined;
    const answers = normalizeSectionPartial(key, readLegacyBrowserSection(key, currentViewUserKey()));
    // The same test the display uses (`applyLegacyLayer`): nothing readable, nothing shown.
    return Object.keys(answers as object).length > 0 ? answers : undefined;
}

function withoutLegacy(data: MyPreferencesResponse, key: PersonSectionKey): MyPreferencesResponse {
    return {
        ...data,
        legacy_browser_sections: data.legacy_browser_sections.filter((section) => section !== key),
    };
}

function withSection(
    data: MyPreferencesResponse,
    key: PersonSectionKey,
    section: ResolvedPreferences[PersonSectionKey],
): MyPreferencesResponse {
    return { ...data, sections: { ...data.sections, [key]: section } };
}

function hasUnsavedChanges(): boolean {
    return pending.size > 0 || inFlight.size > 0;
}

function cancelAll(): void {
    for (const entry of pending.values()) clearTimeout(entry.timer);
    pending.clear();
    inFlight.clear();
    handedOn.clear();
    generation += 1;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => {
    /** Runs `task` after any earlier request for the section, and forgets the section when it was the last. */
    function enqueue(key: PersonSectionKey, task: (settle: () => void) => Promise<void>): Promise<void> {
        const previous = inFlight.get(key) ?? Promise.resolve();
        const settle = () => {
            if (inFlight.get(key) === tail) inFlight.delete(key);
        };
        const tail: Promise<void> = previous.then(() => task(settle));
        inFlight.set(key, tail);
        return tail;
    }

    function announceSettled(): void {
        const { data } = get();
        if (!data || hasUnsavedChanges()) return;
        settledListeners.forEach((listener) => listener(data));
    }

    function apply(key: PersonSectionKey, result: ResolvedSection): void {
        const { data } = get();
        if (!data) return;
        set({
            data: withoutLegacy(
                withSection(data, key, result as ResolvedPreferences[PersonSectionKey]),
                key,
            ),
        });
    }

    function restore(key: PersonSectionKey, section: ResolvedPreferences[PersonSectionKey]): void {
        const { data } = get();
        if (data) set({ data: withSection(data, key, section) });
    }

    function flush(key: PersonSectionKey): void {
        const entry = pending.get(key);
        if (!entry) return;
        pending.delete(key);
        const sentIn = generation;

        void enqueue(key, async (settle) => {
            if (sentIn !== generation) return;
            // The tab changed hands since the edit (another tab signed in as someone else): it is
            // not theirs to receive. Settled without a word; the loader replaces the data next.
            if (!isCurrentPreferencesScope(get().scopeKey)) {
                settle();
                return;
            }
            // The save in line before this one failed: this one is sent in its place.
            const earlier = handedOn.get(key);
            if (earlier) {
                handedOn.delete(key);
                entry.rollback = earlier.rollback;
                if (earlier.body !== undefined) {
                    entry.whole = true;
                    entry.body = mergeBodies(key, earlier.body, entry.body);
                }
            }
            let result: ResolvedSection | null = null;
            try {
                result = await api.saveMyPreferenceSection(key, entry.body);
            } catch {
                result = null;
            }
            if (sentIn !== generation) return;
            settle();

            const newer = pending.get(key);
            if (result) {
                // A newer edit is already on screen; its own save will bring the server's answer.
                if (!newer) apply(key, result);
                else set({ data: withoutLegacy(get().data as MyPreferencesResponse, key) });
            } else {
                toast.error(saveFailedMessage);
                // A later edit builds on this one, so a failure of it goes back to where this started.
                // And when this was the section's whole first save, the next request to reach the
                // server must carry the whole section instead: sent as a partial it would succeed,
                // the server would stop reading this browser for the section, and the browser's other
                // answers would be lost for good.
                if (inFlight.has(key)) {
                    // Already sent off and waiting behind this one, so it goes first.
                    handedOn.set(key, { body: entry.whole ? entry.body : undefined, rollback: entry.rollback });
                } else if (newer) {
                    newer.rollback = entry.rollback;
                    if (entry.whole) {
                        newer.whole = true;
                        newer.body = mergeBodies(key, entry.body, newer.body);
                    }
                } else {
                    restore(key, entry.rollback);
                }
            }
            announceSettled();
        });
    }

    return {
        ready: false,
        scopeKey: null,
        data: null,

        hydrate: (scopeKey, data) => {
            const current = get();
            if (current.scopeKey !== scopeKey) {
                // Someone else's data, or another workspace's: nothing of it carries over.
                cancelAll();
                set({ ready: true, scopeKey, data });
                return;
            }
            if (current.data === data) return;
            if (!hasUnsavedChanges() || !current.data) {
                set({ ready: true, data });
                return;
            }
            // A refetch landed while the member was mid-edit: their sections are newer than it.
            let next = data;
            for (const key of new Set([...pending.keys(), ...inFlight.keys()])) {
                next = withoutLegacy(withSection(next, key, current.data.sections[key]), key);
            }
            set({ ready: true, data: next });
        },

        clear: () => {
            cancelAll();
            set({ ready: false, scopeKey: null, data: null });
        },

        save: (key, body, optimistic) => {
            const { data, scopeKey } = get();
            if (!data || !isCurrentPreferencesScope(scopeKey)) return;

            const earlier = pending.get(key);
            if (earlier) clearTimeout(earlier.timer);
            // Still shown from this browser's old answers? Then this save carries them, and any more
            // edits in the same window build on it; see browserAnswersBody.
            const browserAnswers = earlier ? undefined : browserAnswersBody(key, data);
            const base = earlier ? earlier.body : browserAnswers;
            pending.set(key, {
                body: base === undefined ? body : mergeBodies(key, base, body),
                whole: earlier ? earlier.whole : browserAnswers !== undefined,
                timer: setTimeout(() => flush(key), SAVE_DEBOUNCE_MS),
                rollback: earlier ? earlier.rollback : data.sections[key],
            });
            set({ data: withSection(data, key, { value: optimistic, source: 'member' } as ResolvedPreferences[typeof key]) });
        },

        adoptSaved: (key, value) => {
            const { data, scopeKey } = get();
            if (!data || !isCurrentPreferencesScope(scopeKey)) return;
            apply(key, { value, source: 'member' });
            announceSettled();
        },

        reset: (key) => {
            const { data } = get();
            if (!data) return Promise.resolve();

            // Starting over discards an edit that has not been sent.
            const unsent = pending.get(key);
            if (unsent) {
                clearTimeout(unsent.timer);
                pending.delete(key);
            }
            const sentIn = generation;

            return enqueue(key, async (settle) => {
                if (sentIn !== generation) return;
                if (!isCurrentPreferencesScope(get().scopeKey)) {
                    settle();
                    return;
                }
                // A save that failed just before is moot once the section is reset; only where
                // it started from still matters, should the reset fail as well.
                const failedBefore = handedOn.get(key);
                handedOn.delete(key);
                let result: ResolvedSection | null = null;
                try {
                    result = await api.resetMyPreferenceSection(key);
                } catch {
                    result = null;
                }
                if (sentIn !== generation) return;
                settle();

                if (result) {
                    apply(key, result);
                } else {
                    toast.error(saveFailedMessage);
                    const back = failedBefore?.rollback ?? unsent?.rollback;
                    if (back) restore(key, back);
                }
                announceSettled();
            });
        },
    };
});
