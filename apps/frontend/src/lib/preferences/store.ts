import { create } from 'zustand';
import type {
    LegacyBrowserSection,
    MyPreferencesResponse,
    PersonSectionKey,
    PreferenceSource,
    ResolvedPreferences,
    SectionValues,
} from '@erp71/shared-types';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
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
    /** The first save of a legacy section: `body` is the whole section as the member sees it. */
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
}

const pending = new Map<PersonSectionKey, PendingSave>();
/** The latest queued or running request per section; later requests wait for it. */
const inFlight = new Map<PersonSectionKey, Promise<void>>();
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

/**
 * The request body that carries a whole section, from the value the member sees.
 *
 * The server stores only the submitted ids and, on any save, stops reading the
 * browser for that section. So while a section is still shown from this
 * browser's old answers, a change to one list would silently drop every other
 * list's answers. The first save therefore sends everything the member sees.
 */
function wholeSectionBody(key: PersonSectionKey, section: unknown): unknown {
    if (key === 'tableView' && isRecord(section)) return { global: section.global, tables: section.tables };
    return section;
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
                // The newer edit builds on this one, so a failure of it goes back to where this started.
                if (newer) newer.rollback = entry.rollback;
                else restore(key, entry.rollback);
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
            // Still shown from the browser (listed, and not yet the member's own answer)? Then this
            // save, and any more in the same window, carry the whole section; see wholeSectionBody.
            const whole =
                earlier?.whole ??
                (data.legacy_browser_sections.includes(key as LegacyBrowserSection) &&
                    data.sections[key].source !== 'member');
            pending.set(key, {
                body: whole
                    ? wholeSectionBody(key, optimistic)
                    : earlier
                      ? mergeBodies(key, earlier.body, body)
                      : body,
                whole,
                timer: setTimeout(() => flush(key), SAVE_DEBOUNCE_MS),
                rollback: earlier ? earlier.rollback : data.sections[key],
            });
            set({ data: withSection(data, key, { value: optimistic, source: 'member' } as ResolvedPreferences[typeof key]) });
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
                    if (unsent) restore(key, unsent.rollback);
                }
                announceSettled();
            });
        },
    };
});
