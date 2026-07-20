import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { Search, Plus, X } from 'lucide-react';

interface ProductSearchProps {
    onProductSelect: (
        product: any,
        options: { quantity: number; price: number; availableQty: number },
    ) => void;
}

/** Stock on hand across every warehouse the product is stocked in. */
export function availableQtyOf(product: any): number {
    if (!Array.isArray(product?.stocks)) return 0;
    return product.stocks.reduce((sum: number, stock: any) => sum + Number(stock.quantity || 0), 0);
}

export default function ProductSearch({ onProductSelect }: ProductSearchProps) {
    const [query, setQuery] = useState('');
    const [products, setProducts] = useState<any[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loading, setLoading] = useState(false);
    const [highlight, setHighlight] = useState(0);
    // Product picked but not yet added — price/qty are confirmed here first.
    const [staged, setStaged] = useState<any>(null);
    const [stagedPrice, setStagedPrice] = useState('');
    const [stagedQty, setStagedQty] = useState('1');
    const inputRef = useRef<HTMLInputElement>(null);
    const priceRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

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
        setStagedPrice(String(Number(product.price) || 0));
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
    const numberInput = 'px-2 py-1 border rounded text-sm text-right min-h-touch sm:min-h-0';

    return (
        <div className="flex flex-col gap-1.5">
            <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setShowDropdown(true);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Add product — search by name, SKU, or code…"
                    className="w-full pl-8 pr-3 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                />

                {/* Results Dropdown */}
                {showDropdown && (
                    <div
                        ref={dropdownRef}
                        className="absolute top-full left-0 right-0 mt-1 border rounded bg-white shadow-lg z-50 max-h-80 overflow-y-auto"
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
                                                    <span className={`ml-2 ${stock > 0 ? 'text-gray-500' : 'text-red-600'}`}>
                                                        Avail: {stock}
                                                    </span>
                                                    {product.qty_sold > 0 && (
                                                        <span className="text-emerald-600 ml-2">{product.qty_sold} sold</span>
                                                    )}
                                                    {product.subgroup && (
                                                        <span className="text-gray-400 ml-2">{product.group?.name} → {product.subgroup.name}</span>
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
            </div>

            {/* Staging row — confirm unit price and quantity before adding */}
            {staged && (
                <div className="flex flex-wrap items-end gap-2 rounded border border-blue-200 bg-blue-50 px-2 py-1.5">
                    <div className="flex-1 min-w-[140px]">
                        <div className="text-sm font-medium text-gray-900 truncate">{staged.name}</div>
                        <div className="text-[11px] text-gray-600">
                            SKU: {staged.sku || 'N/A'}
                            <span className="mx-1.5 text-gray-300">·</span>
                            <span className={stagedAvailable > 0 ? '' : 'text-red-600'}>
                                Available {stagedAvailable}
                            </span>
                        </div>
                    </div>
                    <label className="flex flex-col gap-0.5">
                        <span className="text-[11px] text-gray-500">Unit Price</span>
                        <input
                            ref={priceRef}
                            type="number"
                            min="0"
                            step="0.01"
                            value={stagedPrice}
                            onChange={(e) => setStagedPrice(e.target.value)}
                            onKeyDown={handleStagedKeyDown}
                            className={`${numberInput} w-24`}
                        />
                    </label>
                    <label className="flex flex-col gap-0.5">
                        <span className="text-[11px] text-gray-500">Qty</span>
                        <input
                            type="number"
                            min="0"
                            step="any"
                            value={stagedQty}
                            onChange={(e) => setStagedQty(e.target.value)}
                            onKeyDown={handleStagedKeyDown}
                            className={`${numberInput} w-20 ${stagedQtyNum > stagedAvailable ? 'border-amber-400 text-amber-700' : ''}`}
                        />
                    </label>
                    <button
                        type="button"
                        onClick={handleAddStaged}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 min-h-touch sm:min-h-0"
                    >
                        Add
                    </button>
                    <button
                        type="button"
                        onClick={() => { clearStaged(); inputRef.current?.focus(); }}
                        className="p-1.5 text-gray-400 hover:text-gray-700"
                        title="Cancel"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}
        </div>
    );
}
