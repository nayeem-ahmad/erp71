import { useState, useEffect, useRef } from 'react';
import { api } from '../../../../../lib/api';
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

    const searchProducts = async (searchQuery: string) => {
        if (searchQuery.trim().length < 2) {
            setProducts([]);
            return;
        }

        try {
            setLoading(true);
            const data = await api.searchProductsByQuantity(searchQuery, 20);
            setProducts(data || []);
        } catch (error) {
            console.error('Failed to search products', error);
            setProducts([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            if (query) searchProducts(query);
        }, 300);

        return () => clearTimeout(timer);
    }, [query]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (
                dropdownRef.current &&
                inputRef.current &&
                !dropdownRef.current.contains(event.target as Node) &&
                !inputRef.current.contains(event.target as Node)
            ) {
                setShowDropdown(false);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelectProduct = (product: any) => {
        onProductSelect(product);
        setQuery('');
        setShowDropdown(false);
    };

    return (
        <div className="bg-white rounded-lg border p-6 space-y-4">
            <h3 className="font-semibold text-gray-900">Add Products</h3>

            <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setShowDropdown(true);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder="Search by product name, SKU, or code... (shows popular products first)"
                    className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
            </div>

            {/* Results Dropdown */}
            {showDropdown && (
                <div
                    ref={dropdownRef}
                    className="absolute top-20 left-0 right-0 border rounded-lg bg-white shadow-lg z-50 max-h-80 overflow-y-auto"
                >
                    {loading ? (
                        <div className="p-4 text-center text-gray-500 text-sm">Searching...</div>
                    ) : query.trim().length < 2 ? (
                        <div className="p-4 text-center text-gray-500 text-sm">
                            Type at least 2 characters to search
                        </div>
                    ) : products.length === 0 ? (
                        <div className="p-4 text-center text-gray-500 text-sm">No products found</div>
                    ) : (
                        products.map((product) => (
                            <div
                                key={product.id}
                                className="p-3 hover:bg-blue-50 cursor-pointer border-b last:border-b-0 flex justify-between items-start"
                            >
                                <div
                                    onClick={() => handleSelectProduct(product)}
                                    className="flex-1"
                                >
                                    <div className="font-medium text-gray-900">{product.name}</div>
                                    <div className="text-xs text-gray-600 mt-1">
                                        SKU: {product.sku || 'N/A'} | Price: ৳{product.price?.toFixed(2)}
                                    </div>
                                    {product.qty_sold > 0 && (
                                        <div className="text-xs text-green-600 mt-1">
                                            ⭐ {product.qty_sold} sold recently
                                        </div>
                                    )}
                                    {product.subgroup && (
                                        <div className="text-xs text-gray-500 mt-1">
                                            {product.group?.name} → {product.subgroup.name}
                                        </div>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleSelectProduct(product)}
                                    className="ml-2 p-1 text-blue-600 hover:bg-blue-100 rounded"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
