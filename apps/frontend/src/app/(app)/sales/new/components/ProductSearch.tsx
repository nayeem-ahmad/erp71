import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { Search, Plus } from 'lucide-react';

interface ProductSearchProps {
    onProductSelect: (product: any) => void;
}

export default function ProductSearch({ onProductSelect }: ProductSearchProps) {
    const [query, setQuery] = useState('');
    const [products, setProducts] = useState<any[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

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
        onProductSelect(product);
        setQuery('');
        setShowDropdown(false);
    };

    return (
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
                            {products.map((product) => (
                            <div
                                key={product.id}
                                onClick={() => handleSelectProduct(product)}
                                className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b last:border-b-0 flex justify-between items-center gap-2"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-gray-900 text-sm truncate">{product.name}</div>
                                    <div className="text-xs text-gray-600">
                                        SKU: {product.sku || 'N/A'} | ৳{Number(product.price).toFixed(2)}
                                        {product.qty_sold > 0 && (
                                            <span className="text-green-600 ml-2">⭐ {product.qty_sold} sold</span>
                                        )}
                                        {product.subgroup && (
                                            <span className="text-gray-400 ml-2">{product.group?.name} → {product.subgroup.name}</span>
                                        )}
                                    </div>
                                </div>
                                <Plus className="w-4 h-4 text-blue-600 flex-shrink-0" />
                            </div>
                            ))}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
