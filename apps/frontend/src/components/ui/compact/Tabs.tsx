'use client';

import type { ReactNode } from 'react';

/**
 * A tab strip and its panels.
 *
 * Written because the app had four hand-rolled tab bars and no primitive —
 * `crm/setup` (the only one with correct roles and touch targets),
 * `sales/customers/[id]`, `profile` and `team`, each with its own markup and
 * its own idea of what "selected" looks like. This follows the crm/setup
 * pattern, which was the one worth keeping.
 *
 * **State is the caller's, not the URL's.** `crm/setup` parks the active tab in
 * a query param so a list can be linked to, and that is right for a page. The
 * first caller here is a modal, where rewriting the address bar as someone
 * clicks between a task's comments and its attachments would be wrong — the
 * modal has its own URL already. Callers that want the URL can still drive
 * `value`/`onChange` from a search param themselves.
 *
 * **Panels are unmounted when not selected**, matching `CollapsibleSection`'s
 * behaviour, so a tab whose body fetches on mount fetches when it is first
 * shown rather than when the card opens. That is what keeps a card that opens
 * on Comments from also pulling the hour log, the remaining-hours history and
 * the attachment list.
 */

export interface TabDef<K extends string> {
    key: K;
    label: string;
    /** Shown as a pill beside the label. Omit where a count means nothing. */
    count?: number | null;
}

export function Tabs<K extends string>({
    tabs,
    value,
    onChange,
    idPrefix,
    label,
}: {
    tabs: readonly TabDef<K>[];
    /**
     * `null` selects nothing, which is a real state rather than a missing one:
     * a strip whose panels fetch on mount should be able to open closed, so
     * the card carrying it does not pay for four records nobody asked to see.
     * Clicking the selected tab again returns to it.
     */
    value: K | null;
    onChange: (next: K | null) => void;
    /** Namespaces the generated ids so two tab strips can share a page. */
    idPrefix: string;
    /** Names the strip for a screen reader. */
    label: string;
}) {
    // Arrow keys move between tabs, which is what the tab role promises; without
    // it a keyboard user tabs into the strip and cannot reach the other tabs
    // without leaving it again.
    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const forward = event.key === 'ArrowRight';
        const back = event.key === 'ArrowLeft';
        if (!forward && !back) return;

        event.preventDefault();
        const index = tabs.findIndex((tab) => tab.key === value);
        // Nothing selected yet: an arrow key opens the strip at either end
        // rather than doing nothing, which is what a keyboard user expects
        // after tabbing onto it.
        const next =
            index < 0
                ? forward
                    ? 0
                    : tabs.length - 1
                : forward
                  ? (index + 1) % tabs.length
                  : (index - 1 + tabs.length) % tabs.length;
        onChange(tabs[next].key);
        document.getElementById(`${idPrefix}-tab-${tabs[next].key}`)?.focus();
    };

    return (
        <div
            role="tablist"
            aria-label={label}
            onKeyDown={onKeyDown}
            className="flex gap-1 overflow-x-auto border-b border-gray-200"
        >
            {tabs.map((tab, index) => {
                const selected = tab.key === value;
                return (
                    <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        id={`${idPrefix}-tab-${tab.key}`}
                        aria-selected={selected}
                        aria-controls={`${idPrefix}-panel-${tab.key}`}
                        // Only the selected tab is in the tab order; the arrow
                        // keys above are how the others are reached. With
                        // nothing selected the first tab holds the stop, or
                        // the strip could not be tabbed onto at all.
                        tabIndex={selected || (value == null && index === 0) ? 0 : -1}
                        // Clicking the open tab closes it. Without this the
                        // strip is a one-way door: a card opens with no record
                        // shown, and the first click commits it to showing one
                        // for as long as it stays open.
                        onClick={() => onChange(selected ? null : tab.key)}
                        className={`min-h-touch whitespace-nowrap border-b-2 px-3 text-sm transition-colors ${
                            selected
                                ? 'border-blue-600 font-semibold text-blue-600'
                                : 'border-transparent font-medium text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        {tab.label}
                        {tab.count != null && (
                            <span className="ms-1.5 rounded-full border border-gray-100 bg-gray-50 px-1.5 text-[11px] text-gray-500">
                                {tab.count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

export function TabPanel<K extends string>({
    tabKey,
    value,
    idPrefix,
    children,
}: {
    tabKey: K;
    /** `null` when the strip is closed, so every panel stays unmounted. */
    value: K | null;
    idPrefix: string;
    children: ReactNode;
}) {
    if (tabKey !== value) return null;
    return (
        <div
            role="tabpanel"
            id={`${idPrefix}-panel-${tabKey}`}
            aria-labelledby={`${idPrefix}-tab-${tabKey}`}
            className="pt-3"
        >
            {children}
        </div>
    );
}

export default Tabs;
