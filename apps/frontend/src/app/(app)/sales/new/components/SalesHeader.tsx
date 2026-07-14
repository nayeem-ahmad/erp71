interface SalesHeaderProps {
    refNumber: string;
    setRefNumber: (value: string) => void;
    currentUser: any;
    saleDate: string;
    setSaleDate: (value: string) => void;
}

// Renders the sale meta fields (sales #, reference, user, date) as a compact
// inline row that lives in the page's top strip — no card, no heavy padding.
export default function SalesHeader({ refNumber, setRefNumber, currentUser, saleDate, setSaleDate }: SalesHeaderProps) {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span className="flex items-center gap-1">
                <span className="font-semibold uppercase tracking-wide text-[10px] text-gray-400">Sales #</span>
                <span className="text-gray-400 italic">Auto</span>
            </span>
            <label className="flex items-center gap-1">
                <span className="font-semibold uppercase tracking-wide text-[10px] text-gray-400">Ref #</span>
                <input
                    type="text"
                    value={refNumber}
                    onChange={(e) => setRefNumber(e.target.value)}
                    placeholder="Optional"
                    className="w-24 px-1.5 py-0.5 border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                />
            </label>
            <span className="flex items-center gap-1">
                <span className="font-semibold uppercase tracking-wide text-[10px] text-gray-400">User</span>
                <span className="text-gray-700 font-medium">{currentUser?.name || '—'}</span>
            </span>
            <label className="flex items-center gap-1">
                <span className="font-semibold uppercase tracking-wide text-[10px] text-gray-400">Date</span>
                <input
                    type="datetime-local"
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                    className="px-1.5 py-0.5 border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                />
            </label>
        </div>
    );
}
