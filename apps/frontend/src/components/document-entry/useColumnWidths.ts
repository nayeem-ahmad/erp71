'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTablePreferences } from '@/components/data-table/useTablePreferences';

/**
 * Column widths for the document line-items table, dragged by the operator and
 * remembered.
 *
 * **One shared setting across every entry screen.** Sales, purchases, quotes,
 * orders and returns all render the same table with the same columns in the
 * same order, so a Price column widened while invoicing is the same decision
 * the operator would make on a purchase. Keying per document type would make
 * them drag it five times to get one outcome.
 *
 * Storage is `useTablePreferences`, the store every other table in the app
 * already uses — which means widths live in `localStorage` and are per browser,
 * not per user account. They do not follow anyone to another device.
 */
export const DOCUMENT_LINES_TABLE_ID = 'document-entry-lines';

/**
 * Below these a column clips the control inside it rather than merely looking
 * cramped, so the drag stops here regardless of where the pointer goes. The
 * numbers are the input's own width plus the cell padding around it.
 */
export const MIN_COLUMN_WIDTH: Record<string, number> = {
    index: 32,
    name: 120,
    warehouse: 96,
    available: 56,
    price: 80,
    discount: 64,
    quantity: 72,
    total: 80,
    actions: 32,
};

/** A column dragged past this stops being a column and starts being a page. */
const MAX_COLUMN_WIDTH = 600;
const FALLBACK_MIN_WIDTH = 48;

export function clampColumnWidth(columnId: string, width: number): number {
    const min = MIN_COLUMN_WIDTH[columnId] ?? FALLBACK_MIN_WIDTH;
    return Math.max(min, Math.min(MAX_COLUMN_WIDTH, Math.round(width)));
}

/** Exposed for tests, which would otherwise leak dragged widths between cases. */
export function resetDocumentLineColumnWidths() {
    useTablePreferences.setState((state) => ({
        tables: { ...state.tables, [DOCUMENT_LINES_TABLE_ID]: undefined as never },
    }));
}

/** A copy without one key — the column whose width was handed back. */
function omit(source: Record<string, number>, key: string): Record<string, number> {
    const next = { ...source };
    delete next[key];
    return next;
}

interface DragState {
    columnId: string;
    startX: number;
    startWidth: number;
}

export function useColumnWidths() {
    const widths = useTablePreferences(
        (state) => state.tables[DOCUMENT_LINES_TABLE_ID]?.columnWidths,
    );
    const setColumnWidth = useTablePreferences((state) => state.setColumnWidth);

    // Live drag is component state, not store state: writing every mousemove to
    // localStorage would serialise the whole preferences blob per frame. The
    // store is written once, on release.
    const [dragging, setDragging] = useState<DragState | null>(null);
    const [preview, setPreview] = useState<Record<string, number>>({});
    const draggingRef = useRef<DragState | null>(null);
    draggingRef.current = dragging;

    useEffect(() => {
        if (!dragging) return;

        const onMove = (event: MouseEvent) => {
            const drag = draggingRef.current;
            if (!drag) return;
            const next = clampColumnWidth(drag.columnId, drag.startWidth + (event.clientX - drag.startX));
            setPreview((current) => ({ ...current, [drag.columnId]: next }));
        };

        const onUp = () => {
            const drag = draggingRef.current;
            if (drag) {
                setPreview((current) => {
                    const settled = current[drag.columnId];
                    if (settled != null) setColumnWidth(DOCUMENT_LINES_TABLE_ID, drag.columnId, settled);
                    return current;
                });
            }
            setDragging(null);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
    }, [dragging, setColumnWidth]);

    const startResize = useCallback((columnId: string, event: React.MouseEvent) => {
        // The heading is the drag's frame of reference, so a column with no
        // stored width still resizes from wherever the browser laid it out.
        const header = (event.currentTarget as HTMLElement).closest('th');
        const startWidth = header?.getBoundingClientRect().width
            ?? MIN_COLUMN_WIDTH[columnId]
            ?? FALLBACK_MIN_WIDTH;
        event.preventDefault();
        setDragging({ columnId, startX: event.clientX, startWidth });
    }, []);

    const resetColumn = useCallback((columnId: string) => {
        setPreview((current) => omit(current, columnId));
        useTablePreferences.setState((state) => {
            const table = state.tables[DOCUMENT_LINES_TABLE_ID];
            if (!table?.columnWidths) return state;
            return {
                tables: {
                    ...state.tables,
                    [DOCUMENT_LINES_TABLE_ID]: { ...table, columnWidths: omit(table.columnWidths, columnId) },
                },
            };
        });
    }, []);

    const resetAll = useCallback(() => {
        setPreview({});
        resetDocumentLineColumnWidths();
    }, []);

    /**
     * Stored widths are withheld until after mount. `useTablePreferences`
     * seeds itself from `localStorage` at module load, which the server cannot
     * see — so applying a width on the first render makes the server emit a
     * bare `<th>` where the client emits `style="width:296px"`, and React
     * throws a hydration mismatch. One frame of default widths is invisible;
     * the mismatch regenerates the whole table.
     */
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const merged = mounted ? { ...(widths ?? {}), ...preview } : {};
    const widthOf = (columnId: string): number | undefined => merged[columnId];

    return {
        widthOf,
        startResize,
        resetColumn,
        resetAll,
        isCustomised: Object.keys(merged).length > 0,
        resizingColumn: dragging?.columnId ?? null,
    };
}
