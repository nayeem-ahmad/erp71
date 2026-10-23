/**
 * The operator's remembered answer to "print compact?", and the plumbing that
 * lets a print window change it.
 *
 * Kept per browser, like the paper size: it describes how this counter prints,
 * and the back office printing statements may want a different answer from the
 * till printing invoices. It is one answer for every document rather than one
 * per document type — an operator who switched compact on for a long invoice
 * expects the challan printed next to come out the same way, and a setting that
 * silently differed between the two would read as the switch not working.
 */

import { profileDevice } from '@/lib/preferences/profile-device';
import type { PrintDensity } from './types';

export const PRINT_DENSITY_KEY = 'erp71:print:density';

/** Message a print window posts back when its Compact switch is flipped. */
export const PRINT_DENSITY_MESSAGE = 'erp71:print-density';

/** The class on the print document's `<html>` that switches compact on. */
export const COMPACT_CLASS = 'p71-compact';

/**
 * Prefix for a document's compact rules, e.g.
 * `${COMPACT_SCOPE} .items-table td { padding: 2px 6px; }`.
 *
 * Every compact rule sits under this one class rather than being generated
 * per density, so the toolbar switch can flip a finished document between the
 * two without rebuilding it.
 */
export const COMPACT_SCOPE = `html.${COMPACT_CLASS}`;

export function isPrintDensity(value: unknown): value is PrintDensity {
    return value === 'normal' || value === 'compact';
}

/**
 * What the operator chose on this page, kept for when storage is unavailable so
 * the choice still holds for as long as the page is open. Null until they choose.
 */
let sessionDensity: PrintDensity | null = null;

const listeners = new Set<() => void>();

/**
 * Only what this browser has stored, or null — no session answer, no profile,
 * no fallback. For copying a browser's own setup somewhere else (Team → Default
 * profiles), where a value it never chose must not pass for one it did.
 */
export function readStoredPrintDensity(): PrintDensity | null {
    if (typeof window === 'undefined') return null;
    try {
        const stored = window.localStorage.getItem(PRINT_DENSITY_KEY);
        return isPrintDensity(stored) ? stored : null;
    } catch {
        return null;
    }
}

/**
 * Reading storage throws outright in a locked-down browser (Safari private
 * mode, a sandboxed frame), and a print preference is never worth failing a
 * print over.
 */
export function readPrintDensity(): PrintDensity {
    if (typeof window === 'undefined') return 'normal';
    try {
        const stored = window.localStorage.getItem(PRINT_DENSITY_KEY);
        if (isPrintDensity(stored)) return stored;
    } catch {
        // Fall through to the session's answer.
    }
    if (sessionDensity) return sessionDensity;
    // This browser has no answer yet: start from the member's profile. Never
    // written back — only the operator's own switch stores anything.
    const fromProfile = profileDevice().printDensity;
    return isPrintDensity(fromProfile) ? fromProfile : 'normal';
}

export function setPrintDensity(density: PrintDensity): void {
    sessionDensity = density;
    try {
        window.localStorage.setItem(PRINT_DENSITY_KEY, density);
    } catch {
        // Not persisted, but this page still honours it.
    }
    listeners.forEach((listener) => listener());
}

/**
 * Subscribes to changes — from this page, or from another tab of the app, so a
 * menu showing the switch never disagrees with what the next print will do.
 */
export function subscribePrintDensity(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
        if (event.key === PRINT_DENSITY_KEY) listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
    };
}

let listening = false;

/**
 * Lets a print window's Compact switch change the remembered answer.
 *
 * The window cannot be trusted to write this origin's storage itself — a
 * `document.write` popup reports its origin as "null" in some browsers — so it
 * posts the choice back and the opener stores it. Installed once, by the first
 * print window that carries the switch, and left in place: the next print from
 * this page needs it just the same.
 *
 * The origin is not checked, for the same reason the preview's skip message is
 * not: the popup may report "null". The payload carries no authority — it
 * flips a local print preference and nothing else.
 */
export function listenForPrintWindowDensity(): void {
    if (listening || typeof window === 'undefined') return;
    listening = true;
    window.addEventListener('message', (event: MessageEvent) => {
        if (event.data?.type !== PRINT_DENSITY_MESSAGE) return;
        if (!isPrintDensity(event.data.density)) return;
        setPrintDensity(event.data.density);
    });
}
