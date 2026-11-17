'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import AnchoredDropdown from './AnchoredDropdown';

export interface StockProductPickerProps {
    /** The product id already chosen, or `''`. */
    value: string;
    onChange: (product: any | null) => void;
    /** Product ids already used on another line, which this one may not repeat. */
    takenIds?: string[];
    /**
     * Labels are passed in rather than read from the dictionary so this stays a
     * presentational component: entry screens own their own copy.
     */
    placeholder: string;
    searchPlaceholder?: string;
    noMatchLabel?: string;
    emptyLabel?: string;
    clearLabel?: string;
    /** Caption above the box. Sanctioned by the same reason `PartySearchSelect` has one. */
    label?: string;
    /** Second line under a product's name in the list — SKU, stock, price. */
    subtitle?: (product: any) => string;
    ariaLabel?: string;
    id?: string;
    autoFocus?: boolean;
}

/**
 * A product picker backed by the server's search rather than by the whole
 * catalogue.
 *
 * The shrinkage screen used to call `api.getProducts()`, which walks every page
 * of `/products` just to fill a dropdown, and then filtered the result in the
 * browser. On a shop with a few thousand SKUs that is a full catalogue dump on
 * every mount, for a list that shows twenty rows. This asks
 * `searchProductsByQuantity` the same way sale and purchase entry do: debounced,
 * ranked by what actually sells, and browsable on an empty query.
 *
 * It reports the whole product rather than an id because the caller needs the
 * stock it carries — the write-off screen shows what is on the shelf and refuses
 * to let a line exceed it.
 */
export default function StockProductPicker({
    value,
    onChange,
    takenIds = [],
    placeholder,
    searchPlaceholder = '',
    noMatchLabel = 'No products found',
    emptyLabel = 'Start typing to search',
    clearLabel = 'Clear product',
    label,
    subtitle,
    ariaLabel,
    id,
    autoFocus = false,
}: StockProductPickerProps) {
    const [query, setQuery] = useState('');
    const [products, setProducts] = useState<any[]>([]);
    const [selected, setSelected] = useState<any | null>(null);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
    const inputId = useId();
    const resolvedId = id ?? inputId;

    // Keep the chosen product in step with the id the parent holds. The parent
    // clears it to `''` after posting, and a stale name must not survive that.
    useEffect(() => {
        if (!value) {
            setSelected(null);
            return;
        }
        setSelected((current) => (current && current.id === value ? current : null));
    }, [value]);

    useEffect(() => {
        if (!open) return;

        // Mark loading on open rather than when the debounce fires, so the
        // previous results do not sit under the new term flashing "no products".
        setLoading(true);
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            const term = query.trim();
            try {
                const data = await api.searchProductsByQuantity(term, term ? 20 : 50);
                if (controller.signal.aborted) return;
                setProducts(Array.isArray(data) ? data : []);
                setHighlight(0);
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error('Failed to search products', error);
                setProducts([]);
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }, 300);

        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query, open]);

    useEffect(() => {
        optionRefs.current[highlight]?.scrollIntoView({ block: 'nearest' });
    }, [highlight]);

    const isInside = useCallback(
        (target: Node) => !!(dropdownRef.current?.contains(target) || inputRef.current?.contains(target)),
        [],
    );
    useDismissOnClickOutside(open, isInside, () => setOpen(false));

    const pick = (product: any) => {
        setSelected(product);
        setQuery('');
        setOpen(false);
        onChange(product);
    };

    const clear = () => {
        setSelected(null);
        setQuery('');
        onChange(null);
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    // A product already on another line cannot be picked again: the server
    // rejects duplicate lines outright, so offering it here only leads to a
    // failed post after the whole form has been filled in.
    const offered = products.filter((product) => !takenIds.includes(product.id));

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (!open || offered.length === 0) {
            if (event.key === 'ArrowDown') {
                setOpen(true);
                event.preventDefault();
            }
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlight((index) => (index + 1) % offered.length);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlight((index) => (index - 1 + offered.length) % offered.length);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const product = offered[highlight];
            if (product) pick(product);
        } else if (event.key === 'Escape') {
            setOpen(false);
        }
    };

    const caption = label ? (
        <label htmlFor={resolvedId} className="block text-[11px] text-gray-500 mb-0.5">
            {label}
        </label>
    ) : null;

    return (
        <div>
            {caption}
            <div className="relative">
                <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                    ref={inputRef}
                    id={resolvedId}
                    type="text"
                    // Once picked the box shows what was chosen and stops being a
                    // search field; the X hands it back.
                    value={selected ? selected.name : query}
                    readOnly={Boolean(selected)}
                    aria-label={ariaLabel ?? label}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => {
                        if (!selected) setOpen(true);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={selected ? selected.name : placeholder}
                    autoFocus={autoFocus}
                    className={`w-full ps-8 ${selected ? 'pe-8 bg-blue-50 border-blue-200 font-medium text-gray-900' : 'pe-3'} py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-transparent`}
                />
                {selected && (
                    <button
                        type="button"
                        onClick={clear}
                        className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                        title={clearLabel}
                        aria-label={clearLabel}
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}

                {open && !selected && (
                    <AnchoredDropdown anchorRef={inputRef} panelRef={dropdownRef} maxHeight={320}>
                        {offered.length === 0 ? (
                            <div className="p-3 text-center text-gray-500 text-sm">
                                {loading ? '...' : query.trim() ? noMatchLabel : emptyLabel}
                            </div>
                        ) : (
                            <>
                                {!query.trim() && (
                                    <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 bg-gray-50 border-b sticky top-0">
                                        {searchPlaceholder}
                                    </div>
                                )}
                                {offered.map((product, index) => (
                                    <div
                                        key={product.id}
                                        ref={(element) => {
                                            optionRefs.current[index] = element;
                                        }}
                                        onClick={() => pick(product)}
                                        onMouseEnter={() => setHighlight(index)}
                                        className={`cursor-pointer border-b px-3 py-2 last:border-b-0 ${index === highlight ? 'bg-blue-50' : ''}`}
                                    >
                                        <div className="truncate text-sm font-medium text-gray-900">{product.name}</div>
                                        <div className="text-xs text-gray-500">{subtitle?.(product) ?? product.sku ?? ''}</div>
                                    </div>
                                ))}
                            </>
                        )}
                    </AnchoredDropdown>
                )}
            </div>
        </div>
    );
}
