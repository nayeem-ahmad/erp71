'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
    auditDetails,
    describeAuditRow,
    type AuditRowLike,
} from '@/lib/audit-description';
import { formatBDT } from '@/lib/format';

interface AuditDescriptionCellProps {
    row: AuditRowLike;
    detailsLabel: string;
    /** Shown instead of the toggle when the row carries nothing readable. */
    noDetailsLabel: string;
}

/**
 * The plain-English line for an audit row, with its readable details folded
 * behind a toggle.
 *
 * The expansion lives inside the cell rather than in `DataTable` because the
 * shared table renders flat rows and is used by ~40 pages; growing it a
 * sub-row API for one consumer would be a much larger change than this needs.
 */
export default function AuditDescriptionCell({
    row,
    detailsLabel,
    noDetailsLabel,
}: AuditDescriptionCellProps) {
    const [open, setOpen] = useState(false);

    const description = describeAuditRow(row, { formatAmount: formatBDT });
    const details = auditDetails(row, { formatAmount: formatBDT });

    return (
        <div className="space-y-1">
            <span className="text-sm text-gray-800">{description}</span>

            {details.length > 0 ? (
                <>
                    <button
                        type="button"
                        onClick={() => setOpen((value) => !value)}
                        aria-expanded={open}
                        className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline min-h-touch md:min-h-0"
                    >
                        {open ? (
                            <ChevronDown className="w-3 h-3" />
                        ) : (
                            <ChevronRight className="w-3 h-3" />
                        )}
                        {detailsLabel}
                    </button>

                    {open && (
                        <dl className="mt-1 rounded-md border border-gray-200 bg-gray-50 p-2 space-y-1">
                            {details.map((detail) => (
                                <div key={detail.label} className="flex gap-2 text-xs">
                                    <dt className="text-gray-500 shrink-0">{detail.label}</dt>
                                    <dd className="text-gray-800 break-all">{detail.value}</dd>
                                </div>
                            ))}
                        </dl>
                    )}
                </>
            ) : (
                <span className="block text-xs text-gray-400">{noDetailsLabel}</span>
            )}
        </div>
    );
}
