import type { LegacyBrowserSection } from '@erp71/shared-types';

/**
 * What this browser still holds from before preferences moved to the server.
 * Read only: nothing here ever writes or deletes those keys, so a browser that
 * is rolled back, or shared with someone who has not answered yet, loses nothing.
 *
 * The result is the section's *raw* answer shape, not a validated one — the
 * resolver normalises it, so a hand-edited blob cannot do harm.
 */

const TABLE_VIEW_PREFIX = 'erp71:table-view:';
const TABLE_COLUMNS_KEY = 'data-table-preferences';
const SIDEBAR_KEY = 'app-shell-open-groups';

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readJson(key: string): unknown {
    if (typeof window === 'undefined') return undefined;
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : undefined;
    } catch {
        return undefined;
    }
}

function readTableColumns(): unknown {
    const stored = readJson(TABLE_COLUMNS_KEY);
    if (!isRecord(stored)) return undefined;
    const out: Record<string, Record<string, unknown>> = {};
    for (const [tableId, prefs] of Object.entries(stored)) {
        if (!isRecord(prefs)) continue;
        const entry: Record<string, unknown> = {};
        if (isRecord(prefs.columnVisibility) && Object.keys(prefs.columnVisibility).length > 0) {
            entry.hidden = Object.entries(prefs.columnVisibility)
                .filter(([, visible]) => visible === false)
                .map(([columnId]) => columnId);
        }
        if (Array.isArray(prefs.columnOrder) && prefs.columnOrder.length > 0) entry.order = prefs.columnOrder;
        if (typeof prefs.pageSize === 'number') entry.pageSize = prefs.pageSize;
        // Column widths are a drag on one screen, not a preference worth carrying.
        if (Object.keys(entry).length > 0) out[tableId] = entry;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function readSidebar(): unknown {
    const stored = readJson(SIDEBAR_KEY);
    if (!isRecord(stored)) return undefined;
    return {
        appShellOpenGroups: Object.entries(stored)
            .filter(([, open]) => open === true)
            .map(([group]) => group),
    };
}

export function readLegacyBrowserSection(key: LegacyBrowserSection, userKey: string): unknown | undefined {
    switch (key) {
        case 'tableView': {
            const stored = readJson(TABLE_VIEW_PREFIX + userKey);
            return isRecord(stored) ? stored : undefined;
        }
        case 'tableColumns':
            return readTableColumns();
        case 'sidebar':
            return readSidebar();
        default:
            return undefined;
    }
}
