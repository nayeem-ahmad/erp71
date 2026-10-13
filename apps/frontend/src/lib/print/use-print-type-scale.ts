'use client';

import { useSyncExternalStore } from 'react';
import { readPrintTypeScale, setPrintTypeScale, subscribePrintTypeScale, type PrintTypeScale } from './type-scale';

/** The server has no storage to read; the client catches up after hydration. */
function serverScale(): PrintTypeScale {
    return 'normal';
}

/**
 * The remembered text size, for a control that shows or sets it.
 *
 * Read through an external store rather than copied into component state, so
 * the print settings and a print window's own control can never show two
 * different answers — changing either re-renders the other.
 */
export function usePrintTypeScale(): [PrintTypeScale, (scale: PrintTypeScale) => void] {
    const scale = useSyncExternalStore(subscribePrintTypeScale, readPrintTypeScale, serverScale);
    return [scale, setPrintTypeScale];
}
