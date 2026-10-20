'use client';

import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import { getAccessToken } from '@/lib/session-store';
import { tokenSubject } from '@/lib/query-client';
import { DEFAULT_TABLE_VIEW, sanitizeTableView, type TableViewSettings } from './view-settings';

/**
 * The person's list view settings — one set for every list, plus whole-set
 * overrides for the lists they have set apart ("This list only").
 *
 * Kept per person rather than per browser: a shop's counter PC is shared, and
 * one cashier's large text should not follow the next one in. Stored in this
 * browser for now, under a key named for the signed-in user; moving it to the
 * server so it follows the person across devices is the next step, and this
 * store is the only thing that has to learn about it.
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

/** The signed-in user's id from their token, or a shared bucket when signed out. */
export function currentViewUserKey(): string {
    if (typeof window === 'undefined') return 'anon';
    try {
        return tokenSubject(getAccessToken()) ?? 'anon';
    } catch {
        return 'anon';
    }
}

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
 */
export function useTableViewSettings(tableId: string) {
    const settings = useTableViewStore((s) => s.tables[tableId] ?? s.global);
    const isOverridden = useTableViewStore((s) => Boolean(s.tables[tableId]));
    const loadedKey = useTableViewStore((s) => s.userKey);

    // Someone else signed in on this tab since the store was read.
    useEffect(() => {
        const key = currentViewUserKey();
        if (key !== loadedKey) useTableViewStore.getState().load(key);
    }, [loadedKey]);

    const update = useCallback(
        (patch: Partial<TableViewSettings>) => useTableViewStore.getState().update(tableId, patch),
        [tableId],
    );
    const setOverride = useCallback(
        (on: boolean) => useTableViewStore.getState().setOverride(tableId, on),
        [tableId],
    );
    const reset = useCallback(() => useTableViewStore.getState().reset(tableId), [tableId]);

    return { settings, isOverridden, update, setOverride, reset };
}
