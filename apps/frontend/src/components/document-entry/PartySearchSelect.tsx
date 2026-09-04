import { useState, useEffect, useRef, useCallback, useId, type ReactNode } from 'react';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { X, Search } from 'lucide-react';

export interface PartyOption {
    id: string;
    name: string;
    phone?: string | null;
    address?: string | null;
    [key: string]: any;
}

interface PartySearchSelectProps {
    /** Everything the picker can offer; filtering happens here, client-side. */
    parties: PartyOption[];
    loading?: boolean;
    selected: PartyOption | null;
    onSelect: (party: PartyOption | null) => void;
    placeholder: string;
    /**
     * Field caption above the box. The product picker beside it is labelled,
     * so an unlabelled party box sat a label's height higher than its
     * neighbour and read as a stray control.
     */
    label?: string;
    /** Shown under the input once a party is picked — due balance, credit, points. */
    summary?: (party: PartyOption) => ReactNode;
    /** Second line of a dropdown row. Defaults to phone · address. */
    subtitle?: (party: PartyOption) => ReactNode;
    /** Extra control beside the search box, e.g. "New supplier". */
    action?: ReactNode;
    emptyLabel?: string;
    noMatchLabel?: string;
    clearLabel?: string;
    /** Frozen view — an existing document's counterparty is not re-pickable. */
    readOnly?: boolean;
    readOnlyFallback?: string;
}

const defaultSubtitle = (party: PartyOption): ReactNode => (
    <>
        {party.phone}
        {party.address ? ` · ${party.address}` : ''}
    </>
);

/**
 * The counterparty picker used by every entry screen: type to filter, arrow
 * keys to move, Enter to pick, X to clear. Customers and suppliers differ only
 * in what they load and what they show under the box, so they share this.
 */
export default function PartySearchSelect({
    parties,
    loading = false,
    selected,
    onSelect,
    placeholder,
    label,
    summary,
    subtitle = defaultSubtitle,
    action,
    emptyLabel = 'Start typing to search',
    noMatchLabel = 'No matches found',
    clearLabel = 'Clear selection',
    readOnly = false,
    readOnlyFallback = '—',
}: PartySearchSelectProps) {
    const [query, setQuery] = useState('');
    const [filtered, setFiltered] = useState<PartyOption[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputId = useId();
    const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        const term = query.toLowerCase();
        setFiltered(
            parties.filter(
                (party) =>
                    party.name.toLowerCase().includes(term)
                    || (party.phone?.includes(query) ?? false),
            ),
        );
        setHighlight(0);
    }, [query, parties]);

    // Keep the highlighted row visible while arrowing through a long list.
    useEffect(() => {
        optionRefs.current[highlight]?.scrollIntoView({ block: 'nearest' });
    }, [highlight]);

    const isInside = useCallback(
        (target: Node) =>
            !!(
                dropdownRef.current?.contains(target)
                || inputRef.current?.contains(target)
            ),
        [],
    );
    useDismissOnClickOutside(showDropdown, isInside, () => setShowDropdown(false));

    const handleSelect = (party: PartyOption) => {
        onSelect(party);
        setQuery('');
        setShowDropdown(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!showDropdown || filtered.length === 0) {
            if (e.key === 'ArrowDown') {
                setShowDropdown(true);
                e.preventDefault();
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((i) => (i + 1) % filtered.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((i) => (i - 1 + filtered.length) % filtered.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const party = filtered[highlight];
            if (party) handleSelect(party);
        } else if (e.key === 'Escape') {
            setShowDropdown(false);
        }
    };

    // Same caption markup and spacing as the entry bar's field labels, so the
    // two boxes sit on one line.
    const caption = label ? (
        <label htmlFor={inputId} className="block text-[11px] text-gray-500 mb-0.5">
            {label}
        </label>
    ) : null;

    if (readOnly) {
        return (
            <div>
                {caption}
                <div className="rounded border bg-gray-50 px-2.5 py-1.5">
                    <div className="text-sm font-medium text-gray-900">
                        {selected?.name ?? <span className="text-gray-400">{readOnlyFallback}</span>}
                    </div>
                    {selected && <div className="text-xs text-gray-500">{subtitle(selected)}</div>}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1">
            <div>
                {caption}
                <div className="flex items-center gap-1.5">
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                        <input
                            ref={inputRef}
                            id={inputId}
                            type="text"
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setShowDropdown(true);
                            }}
                            onFocus={() => setShowDropdown(true)}
                            onKeyDown={handleKeyDown}
                            placeholder={selected ? selected.name : placeholder}
                            className="w-full ps-8 pe-8 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                        />
                        {selected && (
                            <button
                                type="button"
                                onClick={() => {
                                    onSelect(null);
                                    setQuery('');
                                }}
                                className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                                title={clearLabel}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}

                        {showDropdown && (
                            <div
                                ref={dropdownRef}
                                className="absolute top-full start-0 end-0 mt-1 border rounded bg-white shadow-lg z-50 max-h-64 overflow-y-auto"
                            >
                                {loading ? (
                                    <div className="p-3 text-center text-gray-500 text-sm">Loading...</div>
                                ) : filtered.length === 0 ? (
                                    <div className="p-3 text-center text-gray-500 text-sm">
                                        {query ? noMatchLabel : emptyLabel}
                                    </div>
                                ) : (
                                    filtered.map((party, index) => (
                                        <div
                                            key={party.id}
                                            ref={(el) => { optionRefs.current[index] = el; }}
                                            onClick={() => handleSelect(party)}
                                            onMouseEnter={() => setHighlight(index)}
                                            className={`px-3 py-2 cursor-pointer border-b last:border-b-0 ${index === highlight ? 'bg-blue-50' : ''}`}
                                        >
                                            <div className="font-medium text-gray-900 text-sm">{party.name}</div>
                                            <div className="text-xs text-gray-500">{subtitle(party)}</div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                    {action}
                </div>
            </div>

            {selected && summary?.(selected)}
        </div>
    );
}

/** One dot-separated detail line under the picker, as used by both modules. */
export function PartySummaryLine({ parts }: { parts: ReactNode[] }) {
    const shown = parts.filter(Boolean);
    return (
        <div className="px-1 text-[11px] text-gray-500 leading-snug">
            {shown.map((part, index) => (
                <span key={index}>
                    {index > 0 && <span className="mx-1.5 text-gray-300">·</span>}
                    {part}
                </span>
            ))}
        </div>
    );
}
