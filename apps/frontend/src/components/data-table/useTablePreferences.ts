'use client';

import { create } from 'zustand';
import type { TableColumnsEntry, TableColumnsPrefs } from '@erp71/shared-types';
import { isCurrentPreferencesScope } from '@/lib/preferences/scope';
import { usePreferencesStore } from '@/lib/preferences/store';
import { displayedSection } from '@/lib/preferences/use-preference-section';

/**
 * A list's column choices: which columns are hidden, their order, the rows per
 * page, and the widths dragged on this screen.
 *
 * Once the signed-in member's preferences have loaded, hidden columns, order and
 * page size are theirs — the `tableColumns` section — and follow them to any
 * till; a change is saved there and never to this browser. Widths always stay
 * in this browser: a drag that fits one screen is not worth carrying to another.
 * Before preferences load, and in the modes that never load them (platform
 * admin, referee, employee), every choice lives in this browser under
 * `data-table-preferences`, exactly as it always has.
 *
 * Nothing here writes on its own: each setter is one change the viewer made.
 */

/** Every field is optional: a list may have saved any, all or none of them. */
export interface TablePreferences {
    columnVisibility?: Record<string, boolean>;
    columnOrder?: string[];
    columnWidths?: Record<string, number>;
    pageSize?: number;
}

interface TablePreferencesState {
    /** This browser's `data-table-preferences`. Widths are always read from here. */
    tables: Record<string, TablePreferences>;
    /**
     * The member's columns per list, as `usePreferenceSection('tableColumns')`
     * shows them (this browser's old answers included while the server still
     * lists the section); `null` until their preferences have loaded.
     *
     * Mirrored here from the preferences store, so every component reading this
     * store — whole or through a selector — re-renders when those preferences
     * arrive or change, and `getPreferences` stays a plain read.
     */
    personColumns: TableColumnsPrefs | null;
    getPreferences: (tableId: string) => TablePreferences | undefined;
    setColumnVisibility: (tableId: string, visibility: Record<string, boolean>) => void;
    setColumnOrder: (tableId: string, order: string[]) => void;
    setColumnWidth: (tableId: string, columnId: string, width: number) => void;
    setPageSize: (tableId: string, pageSize: number) => void;
}

const STORAGE_KEY = 'data-table-preferences';

function loadFromStorage(): Record<string, TablePreferences> {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function saveToStorage(tables: Record<string, TablePreferences>) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tables));
    } catch {
        // Storage full or unavailable — silently ignore
    }
}

function hiddenFrom(visibility: Record<string, boolean>): string[] {
    return Object.entries(visibility)
        .filter(([, visible]) => visible === false)
        .map(([columnId]) => columnId);
}

/**
 * Saves one list's entry with `patch` applied. The server replaces a list's
 * entry whole, so the rest of what is saved for it (a profile's page size,
 * say) goes along; the full map is the optimistic value. On a legacy member's
 * first save the preferences store adds this browser's old lists to the body,
 * never the profile's (see `browserAnswersBody`).
 */
function saveEntry(person: TableColumnsPrefs, tableId: string, patch: TableColumnsEntry) {
    const entry = { ...person[tableId], ...patch };
    usePreferencesStore.getState().save('tableColumns', { [tableId]: entry }, { ...person, [tableId]: entry });
}

export const useTablePreferences = create<TablePreferencesState>((set, get) => {
    /** Writes one of the three person-level choices to this browser, as before preferences moved. */
    function setLocal(tableId: string, patch: TablePreferences) {
        set((state) => {
            const updated = { ...state.tables, [tableId]: { ...state.tables[tableId], ...patch } };
            saveToStorage(updated);
            return { tables: updated };
        });
    }

    return {
        tables: loadFromStorage(),
        personColumns: null,

        getPreferences: (tableId) => {
            const { tables, personColumns } = get();
            const local = tables[tableId];
            if (!personColumns) return local;
            const entry = personColumns[tableId];
            if (!entry && !local?.columnWidths) return undefined;
            // Checked rather than trusted: a cached response may come from an older build.
            return {
                columnVisibility: Array.isArray(entry?.hidden)
                    ? Object.fromEntries(entry.hidden.map((columnId) => [columnId, false]))
                    : undefined,
                columnOrder: Array.isArray(entry?.order) ? entry.order : undefined,
                pageSize: typeof entry?.pageSize === 'number' ? entry.pageSize : undefined,
                columnWidths: local?.columnWidths,
            };
        },

        setColumnVisibility: (tableId, visibility) => {
            const person = get().personColumns;
            if (person) saveEntry(person, tableId, { hidden: hiddenFrom(visibility) });
            else setLocal(tableId, { columnVisibility: visibility });
        },

        setColumnOrder: (tableId, order) => {
            const person = get().personColumns;
            if (person) saveEntry(person, tableId, { order });
            else setLocal(tableId, { columnOrder: order });
        },

        setColumnWidth: (tableId, columnId, width) => {
            set((state) => {
                const existing = state.tables[tableId]?.columnWidths ?? {};
                const updated = {
                    ...state.tables,
                    [tableId]: {
                        ...state.tables[tableId],
                        columnWidths: { ...existing, [columnId]: width },
                    },
                };
                saveToStorage(updated);
                return { tables: updated };
            });
        },

        setPageSize: (tableId, pageSize) => {
            const person = get().personColumns;
            if (person) saveEntry(person, tableId, { pageSize });
            else setLocal(tableId, { pageSize });
        },
    };
});

/**
 * Keeps `personColumns` in step with the preferences store. A save updates
 * that store synchronously, so a second change in the same tick already builds
 * on the first.
 */
let mirrored: { section: unknown; listed: boolean } = { section: undefined, listed: false };

function mirrorPersonColumns(state: ReturnType<typeof usePreferencesStore.getState>) {
    // Another person's or workspace's columns, still in memory after a switch, are not this member's.
    const section = state.ready && isCurrentPreferencesScope(state.scopeKey) ? state.data?.sections.tableColumns : undefined;
    const listed = state.data?.legacy_browser_sections.includes('tableColumns') ?? false;
    if (section === mirrored.section && listed === mirrored.listed) return;
    mirrored = { section, listed };
    const shown = displayedSection('tableColumns', section, listed);
    const value = shown.value as unknown;
    const readable = !!value && typeof value === 'object' && !Array.isArray(value);
    useTablePreferences.setState({ personColumns: shown.ready && readable ? shown.value : null });
}

mirrorPersonColumns(usePreferencesStore.getState());
usePreferencesStore.subscribe(mirrorPersonColumns);
