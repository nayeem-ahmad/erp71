'use client';

import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';
import { usePreferencesStore } from '@/lib/preferences/store';
import { usePreferenceSection } from '@/lib/preferences/use-preference-section';
import { currentViewUserKey } from './view-user-key';
import { DEFAULT_TABLE_VIEW, sanitizeTableView, type TableViewSettings } from './view-settings';

/**
 * The person's list view settings — one set for every list, plus whole-set
 * overrides for the lists they have set apart ("This list only").
 *
 * Kept per person rather than per browser: a shop's counter PC is shared, and
 * one cashier's large text should not follow the next one in. Once the
 * person's preferences have loaded from the server they are the source of
 * truth and follow the person across devices; this store (this browser, under
 * a key named for the signed-in user) is what draws the lists before that and
 * in the modes that never load preferences (platform admin, referee, employee).
 */

const STORAGE_PREFIX = 'erp71:table-view:';

interface StoredView {
    global: Partial<TableViewSettings>;
    tables: Record<string, Partial<TableViewSettings>>;
}

interface TableViewState {
    /** Whose settings are loaded; `null` before the first read. */
    userKey: string | null;
    global: TableViewSettings;
    tables: Record<string, TableViewSettings>;
    load: (userKey: string) => void;
    update: (tableId: string, patch: Partial<TableViewSettings>) => void;
    setOverride: (tableId: string, on: boolean) => void;
    reset: (tableId: string) => void;
}

export { currentViewUserKey };

function read(userKey: string): { global: TableViewSettings; tables: Record<string, TableViewSettings> } {
    const empty = { global: DEFAULT_TABLE_VIEW, tables: {} };
    if (typeof window === 'undefined') return empty;
    try {
        const raw = window.localStorage.getItem(STORAGE_PREFIX + userKey);
        if (!raw) return empty;
        const parsed = JSON.parse(raw) as StoredView;
        const global = { ...DEFAULT_TABLE_VIEW, ...sanitizeTableView(parsed?.global) };
        const tables: Record<string, TableViewSettings> = {};
        for (const [id, value] of Object.entries(parsed?.tables ?? {})) {
            tables[id] = { ...global, ...sanitizeTableView(value) };
        }
        return { global, tables };
    } catch {
        return empty;
    }
}

function write(userKey: string | null, global: TableViewSettings, tables: Record<string, TableViewSettings>): void {
    if (!userKey || typeof window === 'undefined') return;
    try {
        const stored: StoredView = { global, tables };
        window.localStorage.setItem(STORAGE_PREFIX + userKey, JSON.stringify(stored));
    } catch {
        // Storage full or blocked — the setting holds for this visit only.
    }
}

export const useTableViewStore = create<TableViewState>((set, get) => {
    const initialKey = currentViewUserKey();
    const initial = read(initialKey);
    return {
        userKey: typeof window === 'undefined' ? null : initialKey,
        global: initial.global,
        tables: initial.tables,

        load: (userKey) => {
            const next = read(userKey);
            set({ userKey, global: next.global, tables: next.tables });
        },

        update: (tableId, patch) => {
            const { userKey, global, tables } = get();
            if (tables[tableId]) {
                const nextTables = { ...tables, [tableId]: { ...tables[tableId], ...patch } };
                set({ tables: nextTables });
                write(userKey, global, nextTables);
            } else {
                const nextGlobal = { ...global, ...patch };
                set({ global: nextGlobal });
                write(userKey, nextGlobal, tables);
            }
        },

        setOverride: (tableId, on) => {
            const { userKey, global, tables } = get();
            const nextTables = { ...tables };
            if (on) nextTables[tableId] = { ...global };
            else delete nextTables[tableId];
            set({ tables: nextTables });
            write(userKey, global, nextTables);
        },

        reset: (tableId) => {
            const { userKey, global, tables } = get();
            if (tables[tableId]) {
                const nextTables = { ...tables, [tableId]: { ...DEFAULT_TABLE_VIEW } };
                set({ tables: nextTables });
                write(userKey, global, nextTables);
            } else {
                set({ global: { ...DEFAULT_TABLE_VIEW } });
                write(userKey, DEFAULT_TABLE_VIEW, tables);
            }
        },
    };
});

/**
 * The view settings one list draws with, and the setters its View options menu
 * calls. A change made while the list has its own override stays on that list;
 * otherwise it changes every list.
 *
 * With the person's preferences loaded, those are read and every change is
 * saved to them (nothing is written to this browser). Otherwise the settings
 * live in this browser, as before.
 */
export function useTableViewSettings(tableId: string) {
    const prefs = usePreferenceSection('tableView');
    const localSettings = useTableViewStore((s) => s.tables[tableId] ?? s.global);
    const localOverridden = useTableViewStore((s) => Boolean(s.tables[tableId]));
    const loadedKey = useTableViewStore((s) => s.userKey);

    // Someone else signed in on this tab since the store was read.
    useEffect(() => {
        const key = currentViewUserKey();
        if (key !== loadedKey) useTableViewStore.getState().load(key);
    }, [loadedKey]);

    // What the next change builds on. A second change in the same tick lands before
    // this component re-renders, so each save moves it on to what it just saved.
    const latest = useRef(prefs);
    latest.current = prefs;

    const save = useCallback(
        (body: Parameters<ReturnType<typeof usePreferencesStore.getState>['save']>[1], next: typeof prefs.value) => {
            latest.current = { ...latest.current, value: next };
            usePreferencesStore.getState().save('tableView', body, next);
        },
        [],
    );

    const update = useCallback(
        (patch: Partial<TableViewSettings>) => {
            if (!latest.current.ready) return useTableViewStore.getState().update(tableId, patch);
            const { global, tables } = latest.current.value;
            if (tables[tableId]) {
                const entry = { ...tables[tableId], ...patch };
                save({ tables: { [tableId]: entry } }, { global, tables: { ...tables, [tableId]: entry } });
            } else {
                save({ global: patch }, { global: { ...global, ...patch }, tables });
            }
        },
        [tableId, save],
    );
    const setOverride = useCallback(
        (on: boolean) => {
            if (!latest.current.ready) return useTableViewStore.getState().setOverride(tableId, on);
            const { global, tables } = latest.current.value;
            if (on) {
                save({ tables: { [tableId]: global } }, { global, tables: { ...tables, [tableId]: { ...global } } });
            } else {
                const { [tableId]: _removed, ...rest } = tables;
                save({ tables: { [tableId]: null } }, { global, tables: rest });
            }
        },
        [tableId, save],
    );
    const reset = useCallback(() => {
        if (!latest.current.ready) return useTableViewStore.getState().reset(tableId);
        const { global, tables } = latest.current.value;
        if (tables[tableId]) {
            save(
                { tables: { [tableId]: DEFAULT_TABLE_VIEW } },
                { global, tables: { ...tables, [tableId]: { ...DEFAULT_TABLE_VIEW } } },
            );
        } else {
            save({ global: DEFAULT_TABLE_VIEW }, { global: { ...DEFAULT_TABLE_VIEW }, tables });
        }
    }, [tableId, save]);

    const settings = prefs.ready ? (prefs.value.tables[tableId] ?? prefs.value.global) : localSettings;
    const isOverridden = prefs.ready ? Boolean(prefs.value.tables[tableId]) : localOverridden;

    return { settings, isOverridden, update, setOverride, reset };
}
