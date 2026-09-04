import { useState, useEffect, useId, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { Search, Plus, X, History } from 'lucide-react';
import RateHistoryPopover from './RateHistoryPopover';
import { useRateHistory, type RateHistoryType } from './RateHistory';

interface ProductSearchProps {
    onProductSelect: (
        product: any,
        options: { quantity: number; price: number; availableQty: number },
    ) => void;
    /** What the staged amount means for this document — a cost, not a price, on a purchase. */
    priceLabel?: string;
    placeholder?: string;
    /**
     * Seed for the staged amount. Defaults to the product's sale price; a
     * purchase passes the cost it wants to start from instead.
     */
    initialPriceOf?: (product: any) => number;
    /**
     * Show the last few rates the staged product traded at. Opt-in: quotation
     * and order entry share this component and have not asked for the hint, so
     * leaving it unset keeps them byte-for-byte as they were.
     */
    historyType?: RateHistoryType;
    /** The customer/supplier on the document, so their own rates lead the list. */
    historyPartyId?: string;
    historyPartyName?: string;
}

/** Stock on hand across every warehouse the product is stocked in. */
export function availableQtyOf(product: any): number {
    if (!Array.isArray(product?.stocks)) return 0;
    return product.stocks.reduce((sum: number, stock: any) => sum + Number(stock.quantity || 0), 0);
}

export default function ProductSearch({
    onProductSelect,
    priceLabel = 'Unit Price',
    placeholder = 'Add product — search by name, SKU, or code…',
    initialPriceOf,
    historyType,
    historyPartyId,
    historyPartyName,
}: ProductSearchProps) {
    const [query, setQuery] = useState('');
    const [products, setProducts] = useState<any[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loading, setLoading] = useState(false);
    const [highlight, setHighlight] = useState(0);
    // Product picked but not yet added — price/qty are confirmed here first.
    const [staged, setStaged] = useState<any>(null);
    const [stagedPrice, setStagedPrice] = useState('');
    const [stagedQty, setStagedQty] = useState('1');
    const [showHistory, setShowHistory] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const priceRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const historyButtonRef = useRef<HTMLButtonElement>(null);
    const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
    const productInputId = useId();

    // Warm the cache the moment a product is staged, so the history panel
    // paints its rows on the click rather than after a round trip. The hook
    // caches per product+party, so opening the panel re-reads, never re-fetches.
    useRateHistory(historyType && staged ? staged.id : undefined, historyType, historyPartyId);

    // Fetch whenever the dropdown is open (including an empty query → browse all).
    useEffect(() => {
        if (!showDropdown) return;

        const controller = new AbortController();
        const timer = setTimeout(async () => {
            const term = query.trim();
            try {
                setLoading(true);
                // Empty term → backend returns the most-sold products so the list can
                // be browsed without typing. Use a larger limit when browsing.
                const data = await api.searchProductsByQuantity(term, term ? 20 : 50);
                if (controller.signal.aborted) return;
                setProducts(data || []);
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
    }, [query, showDropdown]);

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

    const handleSelectProduct = (product: any) => {
        setStaged(product);
        const seededPrice = initialPriceOf ? initialPriceOf(product) : Number(product.price);
        setStagedPrice(String(Number.isFinite(seededPrice) ? seededPrice : 0));
        setStagedQty('1');
        setQuery('');
        setShowDropdown(false);
        // Let the staging row mount before moving focus into it.
        requestAnimationFrame(() => priceRef.current?.select());
    };

    const clearStaged = () => {
        setStaged(null);
        setStagedPrice('');
        setStagedQty('1');
        setShowHistory(false);
    };

    const handleAddStaged = () => {
        if (!staged) return;
        const quantity = parseFloat(stagedQty);
        const price = parseFloat(stagedPrice);
        if (!(quantity > 0) || !(price >= 0)) return;

        onProductSelect(staged, { quantity, price, availableQty: availableQtyOf(staged) });
        clearStaged();
        inputRef.current?.focus();
    };

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!showDropdown || products.length === 0) {
            if (e.key === 'ArrowDown') {
                setShowDropdown(true);
                e.preventDefault();
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((i) => (i + 1) % products.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((i) => (i - 1 + products.length) % products.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const product = products[highlight];
            if (product) handleSelectProduct(product);
        } else if (e.key === 'Escape') {
            setShowDropdown(false);
        }
    };

    const handleStagedKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddStaged();
        } else if (e.key === 'Escape') {
            clearStaged();
            inputRef.current?.focus();
        }
    };

    const stagedAvailable = staged ? availableQtyOf(staged) : 0;
    const stagedQtyNum = parseFloat(stagedQty) || 0;
    const numberInput = 'px-2 py-1 border rounded text-sm text-end min-h-touch sm:min-h-0';

    return (
        <div className="flex flex-col gap-1">
            {/* One entry bar: product, unit amount, quantity, Add — and the
                history icon at the end. Everything needed to commit a line is
                on a single row, so the eye never leaves it. */}
            <div className="flex flex-wrap sm:flex-nowrap items-end gap-1.5">
                {/* Capped rather than free-growing: stretched across a wide
                    work area it left the amount fields marooned at the far
                    edge, visually detached from the product they price. */}
                <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[180px] sm:max-w-md">
                    <label htmlFor={productInputId} className="block text-[11px] text-gray-500 mb-0.5">
                        Product
                    </label>
                    {/* The overlay icons and both panels hang off the input alone —
                        measured against the label as well they sat a caption's
                        height too high. */}
                    <div className="relative">
                        <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                        <input
                            ref={inputRef}
                            id={productInputId}
                            type="text"
                            // Once a product is staged the box shows what was picked
                            // and stops being a search field; the X hands it back.
                            value={staged ? staged.name : query}
                            readOnly={!!staged}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setShowDropdown(true);
                            }}
                            onFocus={() => { if (!staged) setShowDropdown(true); }}
                            onKeyDown={handleSearchKeyDown}
                            placeholder={placeholder}
                            aria-label="Product"
                            className={`w-full ps-8 ${staged ? 'pe-8' : 'pe-3'} py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-transparent ${staged ? 'bg-blue-50 border-blue-200 font-medium text-gray-900' : ''}`}
                        />
                        {staged && (
                            <button
                                type="button"
                                onClick={() => { clearStaged(); inputRef.current?.focus(); }}
                                className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                                title="Clear product"
                                aria-label="Clear product"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}

                        {/* Results Dropdown */}
                        {showDropdown && !staged && (
                            <div
                                ref={dropdownRef}
                                className="absolute top-full start-0 end-0 mt-1 border rounded bg-white shadow-lg z-50 max-h-80 overflow-y-auto"
                            >
                                {loading ? (
                                    <div className="p-3 text-center text-gray-500 text-sm">Searching...</div>
                                ) : products.length === 0 ? (
                                    <div className="p-3 text-center text-gray-500 text-sm">No products found</div>
                                ) : (
                                    <>
                                        {!query.trim() && (
                                            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 bg-gray-50 border-b sticky top-0">
                                                Popular products
                                            </div>
                                        )}
                                        {products.map((product, index) => {
                                            const stock = availableQtyOf(product);
                                            return (
                                                <div
                                                    key={product.id}
                                                    ref={(el) => { optionRefs.current[index] = el; }}
                                                    onClick={() => handleSelectProduct(product)}
                                                    onMouseEnter={() => setHighlight(index)}
                                                    className={`px-3 py-2 cursor-pointer border-b last:border-b-0 flex justify-between items-center gap-2 ${index === highlight ? 'bg-blue-50' : ''}`}
                                                >
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-medium text-gray-900 text-sm truncate">{product.name}</div>
                                                        <div className="text-xs text-gray-600">
                                                            SKU: {product.sku || 'N/A'} | ৳{Number(product.price).toFixed(2)}
                                                            <span className={`ms-2 ${stock > 0 ? 'text-gray-500' : 'text-red-600'}`}>
                                                                Avail: {stock}
                                                            </span>
                                                            {product.qty_sold > 0 && (
                                                                <span className="text-emerald-600 ms-2">{product.qty_sold} sold</span>
                                                            )}
                                                            {product.subgroup && (
                                                                <span className="text-gray-400 ms-2">{product.group?.name} → {product.subgroup.name}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <Plus className="w-4 h-4 text-blue-600 flex-shrink-0" />
                                                </div>
                                            );
                                        })}
                                    </>
                                )}
                            </div>
                        )}

                        {/* Hung under the product box rather than over the screen: the
                            rate being decided stays visible three fields to the right. */}
                        {historyType && showHistory && staged && (
                            <RateHistoryPopover
                                productId={staged.id}
                                productName={staged.name}
                                type={historyType}
                                partyId={historyPartyId}
                                partyName={historyPartyName}
                                anchorRefs={[historyButtonRef]}
                                onPickRate={(rate) => {
                                    setStagedPrice(String(rate));
                                    requestAnimationFrame(() => priceRef.current?.select());
                                }}
                                onClose={() => setShowHistory(false)}
                            />
                        )}
                    </div>
                </div>

                <label className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-gray-500">{priceLabel}</span>
                    <input
                        ref={priceRef}
                        type="number"
                        min="0"
                        step="0.01"
                        value={stagedPrice}
                        disabled={!staged}
                        onChange={(e) => setStagedPrice(e.target.value)}
                        onKeyDown={handleStagedKeyDown}
                        aria-label={priceLabel}
                        className={`${numberInput} w-24 disabled:bg-gray-50 disabled:text-gray-400`}
                    />
                </label>

                <label className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-gray-500">Qty</span>
                    <input
                        type="number"
                        min="0"
                        step="any"
                        value={stagedQty}
                        disabled={!staged}
                        onChange={(e) => setStagedQty(e.target.value)}
                        onKeyDown={handleStagedKeyDown}
                        aria-label="Qty"
                        className={`${numberInput} w-20 disabled:bg-gray-50 disabled:text-gray-400 ${staged && stagedQtyNum > stagedAvailable ? 'border-amber-400 text-amber-700' : ''}`}
                    />
                </label>

                <button
                    type="button"
                    onClick={handleAddStaged}
                    disabled={!staged}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 min-h-touch sm:min-h-0"
                >
                    Add
                </button>

                {historyType && (
                    <button
                        ref={historyButtonRef}
                        type="button"
                        onClick={() => setShowHistory((open) => !open)}
                        disabled={!staged}
                        title={staged ? 'Previous rates' : 'Pick a product to see its previous rates'}
                        aria-label="Previous rates"
                        className="px-2 py-1.5 rounded border border-gray-300 text-gray-500 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50 disabled:text-gray-300 disabled:border-gray-200 disabled:hover:bg-transparent min-h-touch sm:min-h-0"
                    >
                        <History className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* Stock line for the staged product — kept off the entry row so the
                three inputs stay on one line at every width. */}
            {staged && (
                <div className="text-[11px] text-gray-600">
                    SKU: {staged.sku || 'N/A'}
                    <span className="mx-1.5 text-gray-300">·</span>
                    <span className={stagedAvailable > 0 ? '' : 'text-red-600'}>
                        Available {stagedAvailable}
                    </span>
                    {stagedQtyNum > stagedAvailable && (
                        <span className="ms-1.5 text-amber-600">
                            — entering more than is in stock
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
