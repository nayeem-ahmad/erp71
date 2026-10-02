'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
    DEFAULT_INVOICE_PRINT_PREFS,
    normalizeInvoicePrintPrefs,
    type InvoicePrintPrefs,
} from '@erp71/shared-types';
import { api } from '@/lib/api';
import { getWorkspaceItem } from '@/lib/session-store';

/**
 * The signed-in member's invoice layout — padding, balance, table style and
 * the invoice extras.
 *
 * Unlike the paper size these live on the server, against the membership: they
 * describe the document the customer takes home rather than the printer next to
 * this browser, so they follow the member to whichever till they sign in at.
 *
 * One request is shared by every component that prints, and a save reaches all
 * of them at once — the settings modal and the print menu beside it must never
 * disagree about what the next invoice looks like.
 */

let current: InvoicePrintPrefs = DEFAULT_INVOICE_PRINT_PREFS;
let loading: Promise<InvoicePrintPrefs> | null = null;
/** Bumped by a save, so a load that started before it cannot land after it. */
let generation = 0;
/** The workspace `current` belongs to — the same person keeps one set per workspace. */
let loadedFor: string | null = null;
const listeners = new Set<() => void>();

function publish(next: InvoicePrintPrefs): void {
    current = next;
    listeners.forEach((listener) => listener());
}

function workspace(): string | null {
    try {
        return getWorkspaceItem('tenant_id');
    } catch {
        return null;
    }
}

function load(): Promise<InvoicePrintPrefs> {
    const tenant = workspace();
    if (tenant !== loadedFor) {
        clearInvoicePrintPrefsCache();
        loadedFor = tenant;
    }
    if (!loading) {
        const started = generation;
        loading = Promise.resolve()
            .then(() => api.getMyInvoicePrint())
            .then((raw: unknown) => {
                if (started !== generation) return current;
                const prefs = normalizeInvoicePrintPrefs(raw);
                publish(prefs);
                return prefs;
            })
            // An invoice must always print. Fall back to the built-in layout,
            // and forget the failure so the next mount tries again.
            .catch(() => {
                if (started === generation) loading = null;
                return current;
            });
    }
    return loading;
}

/** Forgets the loaded layout — for tests, and when the workspace changes. */
export function clearInvoicePrintPrefsCache(): void {
    generation++;
    loading = null;
    current = DEFAULT_INVOICE_PRINT_PREFS;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

const snapshot = () => current;
const serverSnapshot = () => DEFAULT_INVOICE_PRINT_PREFS;

export interface InvoicePrintPrefsState {
    /** The layout as known now — the built-in one until the request lands. */
    prefs: InvoicePrintPrefs;
    /** The layout once loaded; what a print should wait on. */
    resolve: () => Promise<InvoicePrintPrefs>;
    /** Saves a change; rejects so the caller can say the save failed. */
    save: (change: Partial<Omit<InvoicePrintPrefs, 'version'>>) => Promise<InvoicePrintPrefs>;
}

export function useInvoicePrintPrefs(): InvoicePrintPrefsState {
    const prefs = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

    useEffect(() => {
        void load();
    }, []);

    const save = useCallback(async (change: Partial<Omit<InvoicePrintPrefs, 'version'>>) => {
        const saved = normalizeInvoicePrintPrefs(await api.updateMyInvoicePrint(change));
        // Settle any in-flight load on the saved answer, so a print waiting on
        // it never prints the layout from before the save.
        generation++;
        loading = Promise.resolve(saved);
        publish(saved);
        return saved;
    }, []);

    return { prefs, resolve: load, save };
}
