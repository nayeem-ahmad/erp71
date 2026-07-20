'use client';

import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

interface DocumentEntryLayoutProps {
    title: string;
    /** Where the back chevron leads. */
    backHref: string;
    backLabel?: string;
    /** Full-width notice above the form (draft warning, edit-mode banner…). */
    banner?: ReactNode;
    /** Meta row rendered beside the title — normally a SalesHeader. */
    metaBar: ReactNode;
    /** Customer picker, top-left of the work area. Omitted where there is none. */
    customerPicker?: ReactNode;
    /** Product search, source-document lookup, or whatever feeds the lines. */
    picker?: ReactNode;
    /** The line items table — the only scrolling region on desktop. */
    table: ReactNode;
    /** Optional note/reason field under the table. */
    note?: ReactNode;
    /** Right panel contents: totals, and payment where the document takes one. */
    panel: ReactNode;
    /** Buttons pinned to the bottom of the right panel. */
    actions: ReactNode;
    onSubmit?: (e: React.FormEvent) => void;
}

/**
 * The bare sales-document entry frame: a slim meta strip over a two-column
 * body whose left side scrolls only the item list and whose right panel pins
 * its actions to the bottom.
 *
 * This is the primitive. `SaleEntryLayout` composes it into the full sale
 * screen (customer + product search + totals + payment); quotation, order and
 * return entry fill the same slots with what those documents actually need.
 * Keeping one frame is the point — the four screens cannot drift apart.
 */
export default function DocumentEntryLayout({
    title,
    backHref,
    backLabel = 'Back to sales',
    banner,
    metaBar,
    customerPicker,
    picker,
    table,
    note,
    panel,
    actions,
    onSubmit,
}: DocumentEntryLayoutProps) {
    const handleSubmit = (e: React.FormEvent) => {
        if (onSubmit) onSubmit(e);
        else e.preventDefault();
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col h-full overflow-y-auto lg:overflow-hidden bg-gray-50 text-sm">
            {/* Top strip: title + document meta fields, one slim row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-b bg-white flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Link href={backHref} className="text-gray-400 hover:text-gray-700" aria-label={backLabel}>
                        <ChevronLeft className="w-5 h-5" />
                    </Link>
                    <h1 className="text-base font-bold text-gray-900 whitespace-nowrap">{title}</h1>
                </div>
                <div className="h-5 w-px bg-gray-200 hidden sm:block" />
                {metaBar}
            </div>

            {banner && <div className="px-4 pt-2 flex-shrink-0">{banner}</div>}

            {/* Body: left work area + right summary/payment panel. On mobile this
                flows at natural height so the page scrolls; at lg+ it fills the
                viewport and only the item list scrolls. */}
            <div className="flex flex-col lg:flex-1 lg:flex-row lg:overflow-hidden">
                {/* Left work area */}
                <div className="flex flex-col lg:flex-1 lg:overflow-hidden p-3 gap-2 min-w-0">
                    {(customerPicker || picker) && (
                        <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
                            {customerPicker && (
                                <div className="sm:w-72 flex-shrink-0">{customerPicker}</div>
                            )}
                            {picker && <div className="flex-1 min-w-0">{picker}</div>}
                        </div>
                    )}

                    {/* Item list — the only scrolling region on desktop */}
                    <div className="min-h-[240px] lg:flex-1 lg:min-h-0 lg:overflow-hidden">
                        {table}
                    </div>

                    {note}
                </div>

                {/* Right panel: totals, payment, actions */}
                <div className="w-full lg:w-80 flex-shrink-0 border-t lg:border-t-0 lg:border-l bg-white flex flex-col lg:overflow-hidden">
                    <div className="lg:flex-1 lg:overflow-y-auto p-3 space-y-3">
                        {panel}
                    </div>

                    {/* Actions pinned to panel bottom. Extra bottom padding on desktop
                        keeps the primary button clear of the floating feedback widget. */}
                    <div className="flex flex-wrap items-center gap-2 p-3 pb-20 lg:pb-16 border-t flex-shrink-0">
                        {actions}
                    </div>
                </div>
            </div>
        </form>
    );
}
