'use client';

import { useSyncExternalStore } from 'react';
import { usePreferencesStore } from '@/lib/preferences/store';
import { readPrintTypeScale, setPrintTypeScale, subscribePrintTypeScale, type PrintTypeScale } from './type-scale';

/** The server has no storage to read; the client catches up after hydration. */
function serverScale(): PrintTypeScale {
    return 'normal';
}

/**
 * Also re-reads when the member's preferences arrive or change, so a profile's
 * text size that lands after the page mounted is shown rather than missed.
 */
function subscribe(listener: () => void): () => void {
    const unsubscribeScale = subscribePrintTypeScale(listener);
    const unsubscribeProfile = usePreferencesStore.subscribe(listener);
    return () => {
        unsubscribeScale();
        unsubscribeProfile();
    };
}

/**
 * The remembered text size, for a control that shows or sets it.
 *
 * Read through an external store rather than copied into component state, so
 * the print settings and a print window's own control can never show two
 * different answers — changing either re-renders the other.
 */
export function usePrintTypeScale(): [PrintTypeScale, (scale: PrintTypeScale) => void] {
    const scale = useSyncExternalStore(subscribe, readPrintTypeScale, serverScale);
    return [scale, setPrintTypeScale];
}
