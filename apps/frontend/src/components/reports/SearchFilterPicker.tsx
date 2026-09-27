'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { Input } from '@/components/ui';
import { useDismissOnClickOutside } from '@/lib/click-outside';

/** One pickable record — a product, a customer, a supplier. */
export interface FilterOption {
    id: string;
    name: string;
    /** Shown beside the name: a SKU, a phone number. */
    detail?: string | null;
}

export interface SearchFilterPickerCopy {
    /** Caption above the box. */
    label: string;
    placeholder: string;
    /** Accessible name of the search box itself. */
    searchLabel: string;
    /** The button that lets go of the pick. */
    clear: string;
    searching: string;
    noMatches: string;
}

/**
 * Picks one record to narrow a report by, searching the server as the user
 * types rather than filtering a preloaded list: a mid-sized shop has thousands
 * of SKUs and customers, and a dropdown of all of them is unusable on a phone
 * and slow everywhere else.
 *
 * `search` receives the trimmed term — empty when the box is opened without
 * typing, so the list can be browsed straight away. Out-of-order answers are
 * dropped: only the newest term's results are ever shown.
 */
export default function SearchFilterPicker({
    copy,
    selected,
    onSelect,
    search,
    reopenOnClear = false,
}: {
    copy: SearchFilterPickerCopy;
    selected: FilterOption | null;
    onSelect: (option: FilterOption | null) => void;
    search: (term: string) => Promise<FilterOption[]>;
    /**
     * Drop the list open again once the pick is cleared. For a report that
     * cannot run without a pick, where clearing only ever means "a different
     * one"; an optional filter leaves it shut.
     */
    reopenOnClear?: boolean;
}) {
    const [query, setQuery] = useState('');
    const [options, setOptions] = useState<FilterOption[]>([]);
    const [open, setOpen] = useState(false);
    const [searching, setSearching] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    // Held in a ref so a caller passing a fresh closure each render does not
    // re-run the search on every parent render.
    const searchRef = useRef(search);
    searchRef.current = search;
    const inputId = useId();
    const listId = useId();

    const isInside = useCallback((target: Node) => Boolean(containerRef.current?.contains(target)), []);
    useDismissOnClickOutside(open, isInside, () => setOpen(false));

    useEffect(() => {
        if (!open) return;

        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                setSearching(true);
                const found = await searchRef.current(query.trim());
                if (cancelled) return;
                setOptions(found);
                setHighlight(0);
            } catch (err) {
                console.error('Filter search failed', err);
                if (!cancelled) setOptions([]);
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 250);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, open]);

    const pick = (option: FilterOption) => {
        onSelect(option);
        setOpen(false);
        setQuery('');
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape') {
            setOpen(false);
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) setOpen(true);
            else if (options.length) setHighlight((index) => (index + 1) % options.length);
            return;
        }
        if (event.key === 'ArrowUp' && options.length) {
            event.preventDefault();
            setHighlight((index) => (index - 1 + options.length) % options.length);
            return;
        }
        if (event.key === 'Enter' && open && options[highlight]) {
            event.preventDefault();
            pick(options[highlight]);
        }
    };

    return (
        <div ref={containerRef} className="relative">
            <label htmlFor={inputId} className="text-xs font-medium text-gray-600">
                {copy.label}
            </label>
            <div className="mt-1">
                {selected ? (
                    <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 max-md:min-h-touch">
                        <span className="truncate text-sm font-medium text-gray-900">{selected.name}</span>
                        {selected.detail && <span className="shrink-0 text-xs text-gray-400">{selected.detail}</span>}
                        <button
                            type="button"
                            onClick={() => {
                                onSelect(null);
                                setQuery('');
                                if (reopenOnClear) setOpen(true);
                            }}
                            className="ms-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 max-md:min-h-touch"
                        >
                            <X className="h-4 w-4" aria-hidden="true" /> {copy.clear}
                        </button>
                    </div>
                ) : (
                    <div className="relative">
                        <Search
                            className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                            aria-hidden="true"
                        />
                        <Input
                            id={inputId}
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setOpen(true);
                            }}
                            onFocus={() => setOpen(true)}
                            onKeyDown={handleKeyDown}
                            placeholder={copy.placeholder}
                            aria-label={copy.searchLabel}
                            role="combobox"
                            aria-expanded={open}
                            aria-controls={listId}
                            aria-autocomplete="list"
                            autoComplete="off"
                            className="w-full ps-8"
                        />
                    </div>
                )}
            </div>

            {open && !selected && (
                <div
                    id={listId}
                    role="listbox"
                    className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg"
                >
                    {searching && (
                        <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {copy.searching}
                        </div>
                    )}
                    {!searching && options.length === 0 && (
                        <div className="px-3 py-3 text-xs text-gray-500">{copy.noMatches}</div>
                    )}
                    {options.map((option, index) => (
                        <button
                            key={option.id}
                            type="button"
                            role="option"
                            aria-selected={index === highlight}
                            onClick={() => pick(option)}
                            onMouseEnter={() => setHighlight(index)}
                            className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-start max-md:min-h-touch ${
                                index === highlight ? 'bg-blue-50' : 'hover:bg-gray-50'
                            }`}
                        >
                            <span className="text-sm text-gray-800">{option.name}</span>
                            {option.detail && <span className="shrink-0 text-xs text-gray-400">{option.detail}</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
