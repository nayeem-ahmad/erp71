/**
 * The operator's remembered answer to "how big is the data?", and the plumbing
 * that lets a print window change it.
 *
 * Kept per browser, like the paper size: it describes how this counter prints
 * invoices and quotations, and the back office may want a different answer
 * from the till. It scales the customer, the lines and the totals. The
 * letterhead keeps the size its template sets.
 *
 * Compact is a different answer — tighter rows, so a long invoice fits more
 * lines. The two combine: compact still tightens the padding, and this size
 * is what the type comes out at.
 */

import { profileDevice } from '@/lib/preferences/profile-device';

export type PrintTypeScale = 'normal' | 'large' | 'larger';

export const PRINT_TYPE_SCALES: PrintTypeScale[] = ['normal', 'large', 'larger'];

export const PRINT_TYPE_SCALE_KEY = 'erp71:print:type-scale';

/** Message a print window posts back when its text-size control is changed. */
export const PRINT_TYPE_SCALE_MESSAGE = 'erp71:print-type-scale';

/** Class on `<html>` for each step. Normal adds nothing, so the document's own sizes stand. */
export const TYPE_SCALE_CLASS: Record<PrintTypeScale, string> = {
    normal: '',
    large: 'p71-fs-lg',
    larger: 'p71-fs-xl',
};

export function isPrintTypeScale(value: unknown): value is PrintTypeScale {
    return value === 'normal' || value === 'large' || value === 'larger';
}

/**
 * What the operator chose on this page, kept for when storage is unavailable so
 * the choice still holds for as long as the page is open. Null until they choose.
 */
let sessionScale: PrintTypeScale | null = null;

const listeners = new Set<() => void>();

/**
 * Only what this browser has stored, or null — no session answer, no profile,
 * no fallback. For copying a browser's own setup somewhere else (Team → Default
 * profiles), where a value it never chose must not pass for one it did.
 */
export function readStoredPrintTypeScale(): PrintTypeScale | null {
    if (typeof window === 'undefined') return null;
    try {
        const stored = window.localStorage.getItem(PRINT_TYPE_SCALE_KEY);
        return isPrintTypeScale(stored) ? stored : null;
    } catch {
        return null;
    }
}

/**
 * Reading storage throws outright in a locked-down browser (Safari private
 * mode, a sandboxed frame), and a print preference is never worth failing a
 * print over.
 */
export function readPrintTypeScale(): PrintTypeScale {
    if (typeof window === 'undefined') return 'normal';
    try {
        const stored = window.localStorage.getItem(PRINT_TYPE_SCALE_KEY);
        if (isPrintTypeScale(stored)) return stored;
    } catch {
        // Fall through to the session's answer.
    }
    if (sessionScale) return sessionScale;
    // This browser has no answer yet: start from the member's profile. Never
    // written back — only the operator's own control stores anything.
    const fromProfile = profileDevice().printTypeScale;
    return isPrintTypeScale(fromProfile) ? fromProfile : 'normal';
}

export function setPrintTypeScale(scale: PrintTypeScale): void {
    sessionScale = scale;
    try {
        window.localStorage.setItem(PRINT_TYPE_SCALE_KEY, scale);
    } catch {
        // Not persisted, but this page still honours it.
    }
    listeners.forEach((listener) => listener());
}

/**
 * Subscribes to changes — from this page, or from another tab of the app, so a
 * menu showing the size never disagrees with what the next print will do.
 */
export function subscribePrintTypeScale(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
        if (event.key === PRINT_TYPE_SCALE_KEY) listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
    };
}

let listening = false;

/**
 * Lets a print window's text-size control change the remembered answer.
 *
 * The window cannot be trusted to write this origin's storage itself — a
 * `document.write` popup reports its origin as "null" in some browsers — so it
 * posts the choice back and the opener stores it. Installed once, by the first
 * print window that carries the control, and left in place.
 *
 * The origin is not checked, for the same reason the preview's skip message is
 * not: the popup may report "null". The payload carries no authority — it
 * sets a local print preference and nothing else.
 */
export function listenForPrintWindowTypeScale(): void {
    if (listening || typeof window === 'undefined') return;
    listening = true;
    window.addEventListener('message', (event: MessageEvent) => {
        if (event.data?.type !== PRINT_TYPE_SCALE_MESSAGE) return;
        if (!isPrintTypeScale(event.data.typeScale)) return;
        setPrintTypeScale(event.data.typeScale);
    });
}

/**
 * Rules that enlarge the given selectors one step, then two.
 *
 * Emitted by the invoice and quotation stylesheets, after their own rules and
 * after their compact rules. The combined selector beats a compact rule of
 * equal weight when both are on, so compact keeps tightening the padding while
 * the chosen size is what the type comes out at. Inert until the class is set.
 */
export function dataTypeScaleCss(selectors: string[], largePx: number, largerPx: number): string {
    const rule = (step: string, px: number) => selectors
        .flatMap((sel) => [`html.${step} ${sel}`, `html.p71-compact.${step} ${sel}`])
        .join(', ') + ` { font-size: ${px}px; }`;
    return `${rule(TYPE_SCALE_CLASS.large, largePx)}\n        ${rule(TYPE_SCALE_CLASS.larger, largerPx)}`;
}
