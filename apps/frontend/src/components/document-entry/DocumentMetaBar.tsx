import type { ReactNode } from 'react';

const LABEL_CLASS = 'font-semibold uppercase tracking-wide text-[10px] text-gray-400';
const FIELD_CLASS = 'px-1.5 py-0.5 border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-transparent';

/** A labelled control in the meta strip, so per-document extras match the row. */
export function MetaField({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="flex items-center gap-1">
            <span className={LABEL_CLASS}>{label}</span>
            {children}
        </label>
    );
}

/** Input styling for controls passed into MetaField. */
export const metaFieldInputClass = FIELD_CLASS;

interface DocumentMetaBarProps {
    /** Label for the auto-assigned serial, e.g. "Sales #", "Purchase #". */
    docLabel?: string;
    refNumber?: string;
    setRefNumber?: (value: string) => void;
    /** Label for the reference field — "Ref #" on a sale, "Bill #" on a purchase. */
    refLabel?: string;
    currentUser: any;
    documentDate?: string;
    setDocumentDate?: (value: string) => void;
    /** Ref # is only offered where the document actually stores one. */
    showRefNumber?: boolean;
    /**
     * Document date. Off where the API assigns it server-side and accepts no
     * override (quotations, sales orders, returns, purchases) — an editable
     * date there would imply a back-dating the save silently ignores.
     */
    showDate?: boolean;
    /** Per-document extras (Valid Until, Delivery Date, source Sale #). */
    children?: ReactNode;
    /** Assigned document number — omitted on a new entry, where it reads "Auto". */
    serialNumber?: string;
    readOnly?: boolean;
    /**
     * Freeze only the reference number. An existing sale's reference is unique
     * per tenant and is not part of the update payload, so it stays fixed even
     * while the rest of the form is editable.
     */
    refReadOnly?: boolean;
}

// Renders the document meta fields (document #, reference, user, date) as a
// compact inline row that lives in the page's top strip — no card, no heavy
// padding. Shared by every entry screen so the strip cannot drift per module.
export default function DocumentMetaBar({
    docLabel = 'Sales #',
    refNumber = '',
    setRefNumber,
    refLabel = 'Ref #',
    currentUser,
    documentDate = '',
    setDocumentDate,
    showRefNumber = true,
    showDate = true,
    children,
    serialNumber,
    readOnly = false,
    refReadOnly = false,
}: DocumentMetaBarProps) {
    const labelClass = LABEL_CLASS;
    const displayDate = documentDate ? new Date(documentDate).toLocaleString() : '—';

    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span className="flex items-center gap-1">
                <span className={labelClass}>{docLabel}</span>
                {serialNumber ? (
                    <span className="text-gray-900 font-semibold">{serialNumber}</span>
                ) : (
                    <span className="text-gray-400 italic">Auto</span>
                )}
            </span>
            {showRefNumber && (
                <label className="flex items-center gap-1">
                    <span className={labelClass}>{refLabel}</span>
                    {readOnly || refReadOnly ? (
                        <span className="text-gray-700 font-medium">{refNumber || '—'}</span>
                    ) : (
                        <input
                            type="text"
                            value={refNumber}
                            onChange={(e) => setRefNumber?.(e.target.value)}
                            placeholder="Optional"
                            className={`w-24 ${FIELD_CLASS}`}
                        />
                    )}
                </label>
            )}
            {currentUser?.name && (
                <span className="flex items-center gap-1">
                    <span className={labelClass}>User</span>
                    <span className="text-gray-700 font-medium">{currentUser.name}</span>
                </span>
            )}
            {showDate && (
                <label className="flex items-center gap-1">
                    <span className={labelClass}>Date</span>
                    {readOnly ? (
                        <span className="text-gray-700 font-medium">{displayDate}</span>
                    ) : (
                        <input
                            type="datetime-local"
                            value={documentDate}
                            onChange={(e) => setDocumentDate?.(e.target.value)}
                            className={FIELD_CLASS}
                        />
                    )}
                </label>
            )}
            {children}
        </div>
    );
}
