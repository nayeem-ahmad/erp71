'use client';

import { useSyncExternalStore } from 'react';
import { readPrintDensity, setPrintDensity, subscribePrintDensity } from './density';
import type { PrintDensity } from './types';

/** The server has no storage to read; the client catches up after hydration. */
function serverDensity(): PrintDensity {
    return 'normal';
}

/**
 * The remembered compact/normal choice, for a control that shows or sets it.
 *
 * Read through an external store rather than copied into component state, so
 * the sales menu, the print settings and a print window's own switch can never
 * show three different answers — flipping any one of them re-renders the rest.
 */
export function usePrintDensity(): [PrintDensity, (density: PrintDensity) => void] {
    const density = useSyncExternalStore(subscribePrintDensity, readPrintDensity, serverDensity);
    return [density, setPrintDensity];
}
