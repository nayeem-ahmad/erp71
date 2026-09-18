'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { PaperSize } from '@/lib/sales-invoice-printer';
import { PRINT_PREVIEW_SKIP_MESSAGE } from '@/lib/print';

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

export interface SalePrintPrefs {
    paperSize: PaperSize;
    /** Persists the choice, so the next print starts from the same size. */
    setPaperSize: (size: PaperSize) => void;
    /** True once the operator has opted out of the preview step. */
    skipPreview: boolean;
    setSkipPreview: (skip: boolean) => void;
}

/**
 * The operator's printing preferences: what paper, and whether to preview.
 *
 * Paper size layers a per-browser choice over the tenant's
 * `default_paper_size`. The tenant setting is the starting point — a shop that
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

    // Read the stored answers on mount rather than in the initialiser: this
    // renders on the server first, where there is no localStorage, and a
    // mismatched first paint is a hydration error.
    useEffect(() => {
        const storedSize = readStored(PAPER_SIZE_KEY);
        if (storedSize && VALID_SIZES.includes(storedSize as PaperSize)) {
            setPaperSizeState(storedSize as PaperSize);
        } else {
            // No local override — fall back to what the tenant configured.
            // Wrapped rather than chained straight off the call: a print
            // preference must never be the thing that takes the sale screen
            // down, and this runs in a passive effect where a synchronous
            // throw is unrecoverable.
            void (async () => {
                try {
                    const settings: any = await api.getSalesSettings?.();
                    const fallback = settings?.default_paper_size ?? settings?.paper_size;
                    if (fallback && VALID_SIZES.includes(fallback as PaperSize)) {
                        setPaperSizeState(fallback as PaperSize);
                    }
                } catch {
                    // Settings unreachable — A4 is the safe default.
                }
            })();
        }

        setSkipPreviewState(readStored(SKIP_PREVIEW_KEY) === 'true');
    }, []);

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

    return { paperSize, setPaperSize, skipPreview, setSkipPreview };
}
