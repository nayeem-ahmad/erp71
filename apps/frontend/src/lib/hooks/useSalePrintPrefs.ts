'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { profileDevice } from '@/lib/preferences/profile-device';
import { usePreferencesStore } from '@/lib/preferences/store';
import type { PaperSize } from '@/lib/sales-invoice-printer';
import { PRINT_PREVIEW_SKIP_MESSAGE, type PrintDensity } from '@/lib/print';
import { usePrintDensity } from '@/lib/print/use-print-density';
import { usePrintTypeScale } from '@/lib/print/use-print-type-scale';
import type { PrintTypeScale } from '@/lib/print/type-scale';

const PAPER_SIZE_KEY = 'erp71:sales-print:paper-size';
const SKIP_PREVIEW_KEY = 'erp71:sales-print:skip-preview';

const VALID_SIZES: PaperSize[] = ['A4', 'A5', 'Letter', 'Thermal80', 'Thermal58'];

/**
 * Reading storage throws outright in a locked-down browser (Safari private
 * mode, third-party-cookie blocking in an iframe), and a print preference is
 * never worth taking the page down for.
 */
function readStored(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStored(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // Preference simply does not persist; printing still works.
    }
}

function storedPaper(): PaperSize | null {
    const stored = readStored(PAPER_SIZE_KEY);
    return stored && VALID_SIZES.includes(stored as PaperSize) ? (stored as PaperSize) : null;
}

/**
 * The paper this browser has chosen, or null — never the profile's or the
 * shop's. For copying a browser's own setup (Team → Default profiles).
 */
export function readStoredPaperSize(): PaperSize | null {
    if (typeof window === 'undefined') return null;
    return storedPaper();
}

/** This browser's stored skip-preview answer, or null when it has none. */
export function readStoredSkipPreview(): boolean | null {
    if (typeof window === 'undefined') return null;
    const stored = readStored(SKIP_PREVIEW_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return null;
}

/** The paper size the member's profile sets for a browser that has chosen none, if any. */
function profilePaper(): PaperSize | null {
    const paper = profileDevice().paperSize;
    return paper && VALID_SIZES.includes(paper) ? paper : null;
}

/**
 * Whether to skip the preview: this browser's stored answer (`true` or
 * `false`), else the profile's, else false. An absent key is not a stored
 * `false` — only the absent case lets the profile apply.
 */
function readSkipPreview(): boolean {
    return readStoredSkipPreview() ?? profileDevice().skipPreview === true;
}

/** The shop's `default_paper_size`, or null when it has none or cannot be read. */
async function tenantPaper(): Promise<PaperSize | null> {
    try {
        const settings: any = await api.getSalesSettings?.();
        const fallback = settings?.default_paper_size ?? settings?.paper_size;
        return fallback && VALID_SIZES.includes(fallback as PaperSize) ? (fallback as PaperSize) : null;
    } catch {
        return null;
    }
}

/**
 * The same answer as `useSalePrintPrefs().paperSize`, read at the moment of
 * printing — for a print button on a screen that should not spend a request
 * on the shop's settings every time it loads (every list has one). This
 * browser's choice, else the member's profile, else the shop default, else A4.
 */
export async function resolvePrintPaper(): Promise<PaperSize> {
    return storedPaper() ?? profilePaper() ?? (await tenantPaper()) ?? 'A4';
}

export interface SalePrintPrefs {
    paperSize: PaperSize;
    /** Persists the choice, so the next print starts from the same size. */
    setPaperSize: (size: PaperSize) => void;
    /** True once the operator has opted out of the preview step. */
    skipPreview: boolean;
    setSkipPreview: (skip: boolean) => void;
    /**
     * Compact or normal. Not a sales-only answer like the two above: it is
     * the one remembered setting every document's print window follows, and
     * it is surfaced here so the sales screens can show and change it.
     */
    density: PrintDensity;
    setDensity: (density: PrintDensity) => void;
    /**
     * How large the invoice and quotation data prints. Like density, one
     * answer for this browser, surfaced here so the print settings can show it.
     */
    typeScale: PrintTypeScale;
    setTypeScale: (scale: PrintTypeScale) => void;
}

/**
 * The operator's printing preferences: what paper, and whether to preview.
 *
 * Paper size layers a per-browser choice over the member's profile and then the
 * tenant's `default_paper_size`. The profile is read only — a browser that has
 * chosen nothing starts from it, but nothing is stored until the operator
 * changes something here. The tenant setting is the starting point — a shop that
 * has configured 80mm thermal should not have every till default to A4 — but
 * the till that changes it keeps that choice, because one counter printing A5
 * delivery copies should not restate the setting for everyone.
 *
 * Both values live in localStorage rather than on the server: they describe the
 * printer sitting next to this browser, not the tenant, and the same login at
 * the back office wants different answers from the one at the counter.
 */
export function useSalePrintPrefs(): SalePrintPrefs {
    const [paperSize, setPaperSizeState] = useState<PaperSize>('A4');
    const [skipPreview, setSkipPreviewState] = useState(false);
    const [density, setDensity] = usePrintDensity();
    const [typeScale, setTypeScale] = usePrintTypeScale();
    // Primitives, so a profile that arrives after mount re-runs the read below
    // and nothing else about the preferences store re-renders this hook.
    const profileSize = usePreferencesStore((s) => s.data?.sections?.device?.value?.paperSize);
    const profileSkip = usePreferencesStore((s) => s.data?.sections?.device?.value?.skipPreview);
    // Whose preferences those are: the profile counts only once they are this member's
    // (`profileDevice`), so a store that changes hands re-runs the read too.
    const profileScope = usePreferencesStore((s) => s.scopeKey);

    // Read the stored answers on mount rather than in the initialiser: this
    // renders on the server first, where there is no localStorage, and a
    // mismatched first paint is a hydration error.
    useEffect(() => {
        // The shop request below can outlive this run (the profile may arrive
        // while it is in flight and re-run the effect); a late answer from a
        // superseded run must not overwrite the newer one.
        let cancelled = false;
        const storedSize = storedPaper();
        const fromProfile = profilePaper();
        if (storedSize) {
            setPaperSizeState(storedSize);
        } else if (fromProfile) {
            // The member's profile answers; no need to ask the shop.
            setPaperSizeState(fromProfile);
        } else {
            // No local override — fall back to what the tenant configured, or
            // stay on A4 when it cannot be read. `tenantPaper` never throws: a
            // print preference must never be the thing that takes the sale
            // screen down, and this runs in a passive effect where a
            // synchronous throw is unrecoverable.
            void tenantPaper().then((fallback) => {
                if (!cancelled && fallback) setPaperSizeState(fallback);
            });
        }

        setSkipPreviewState(readSkipPreview());
        return () => {
            cancelled = true;
        };
    }, [profileSize, profileSkip, profileScope]);

    const setPaperSize = useCallback((size: PaperSize) => {
        setPaperSizeState(size);
        writeStored(PAPER_SIZE_KEY, size);
    }, []);

    const setSkipPreview = useCallback((skip: boolean) => {
        setSkipPreviewState(skip);
        writeStored(SKIP_PREVIEW_KEY, String(skip));
    }, []);

    // The preview window's "skip next time" checkbox lives in a popup, which
    // cannot be trusted to write this origin's storage. It posts back instead.
    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            // The origin is not checked here: a `document.write` popup reports
            // its origin as "null" in some browsers, so an origin test would
            // drop our own message. The payload carries no authority — it flips
            // a local print preference and nothing else — and the message name
            // is specific enough that a stray postMessage will not match it.
            if (event.data?.type !== PRINT_PREVIEW_SKIP_MESSAGE) return;
            setSkipPreview(Boolean(event.data.skip));
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [setSkipPreview]);

    return { paperSize, setPaperSize, skipPreview, setSkipPreview, density, setDensity, typeScale, setTypeScale };
}
