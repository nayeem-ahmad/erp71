interface SalesHeaderProps {
    refNumber: string;
    setRefNumber: (value: string) => void;
    currentUser: any;
    saleDate: string;
    setSaleDate: (value: string) => void;
    /** Assigned sale number — omitted on a new entry, where it reads "Auto". */
    serialNumber?: string;
    readOnly?: boolean;
    /**
     * Freeze only the reference number. An existing sale's reference is unique
     * per tenant and is not part of the update payload, so it stays fixed even
     * while the rest of the form is editable.
     */
    refReadOnly?: boolean;
}

// Renders the sale meta fields (sales #, reference, user, date) as a compact
// inline row that lives in the page's top strip — no card, no heavy padding.
export default function SalesHeader({
    refNumber,
    setRefNumber,
    currentUser,
    saleDate,
    setSaleDate,
    serialNumber,
    readOnly = false,
    refReadOnly = false,
}: SalesHeaderProps) {
    const labelClass = 'font-semibold uppercase tracking-wide text-[10px] text-gray-400';
    const displayDate = saleDate ? new Date(saleDate).toLocaleString() : '—';

    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span className="flex items-center gap-1">
                <span className={labelClass}>Sales #</span>
                {serialNumber ? (
                    <span className="text-gray-900 font-semibold">{serialNumber}</span>
                ) : (
                    <span className="text-gray-400 italic">Auto</span>
                )}
            </span>
            <label className="flex items-center gap-1">
                <span className={labelClass}>Ref #</span>
                {readOnly || refReadOnly ? (
                    <span className="text-gray-700 font-medium">{refNumber || '—'}</span>
                ) : (
                    <input
                        type="text"
                        value={refNumber}
                        onChange={(e) => setRefNumber(e.target.value)}
                        placeholder="Optional"
                        className="w-24 px-1.5 py-0.5 border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                    />
                )}
            </label>
            {currentUser?.name && (
                <span className="flex items-center gap-1">
                    <span className={labelClass}>User</span>
                    <span className="text-gray-700 font-medium">{currentUser.name}</span>
                </span>
            )}
            <label className="flex items-center gap-1">
                <span className={labelClass}>Date</span>
                {readOnly ? (
                    <span className="text-gray-700 font-medium">{displayDate}</span>
                ) : (
                    <input
                        type="datetime-local"
                        value={saleDate}
                        onChange={(e) => setSaleDate(e.target.value)}
                        className="px-1.5 py-0.5 border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                    />
                )}
            </label>
        </div>
    );
}
