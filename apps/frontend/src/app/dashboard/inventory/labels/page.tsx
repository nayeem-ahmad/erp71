'use client';

import { useEffect, useRef, useState } from 'react';
import { Printer, Search, Tag, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import BarcodeLabel from '@/components/BarcodeLabel';

interface Product {
    id: string;
    name: string;
    sku?: string | null;
    price: string | number;
}

const PRINT_AREA_ID = 'labels-print-area';

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #${PRINT_AREA_ID}, #${PRINT_AREA_ID} * { visibility: visible !important; }
  #${PRINT_AREA_ID} {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
  }
  .barcode-label {
    width: 5cm !important;
    height: 3cm !important;
    border: none !important;
    border-radius: 0 !important;
    page-break-inside: avoid !important;
    box-shadow: none !important;
  }
  .print-labels-grid {
    display: grid !important;
    grid-template-columns: repeat(4, 5cm) !important;
    gap: 0 !important;
    padding: 0 !important;
  }
}
`;

export default function PrintLabelsPage() {
    const { businessName } = useBranding();
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [copies, setCopies] = useState(1);
    const styleRef = useRef<HTMLStyleElement | null>(null);

    // Inject print CSS on mount, clean up on unmount
    useEffect(() => {
        const style = document.createElement('style');
        style.textContent = PRINT_CSS;
        document.head.appendChild(style);
        styleRef.current = style;
        return () => {
            if (styleRef.current) {
                document.head.removeChild(styleRef.current);
                styleRef.current = null;
            }
        };
    }, []);

    // Load products on mount
    useEffect(() => {
        setLoading(true);
        api.getProducts({ limit: 100 })
            .then((items: Product[]) => {
                setProducts(Array.isArray(items) ? items : []);
            })
            .catch(() => setProducts([]))
            .finally(() => setLoading(false));
    }, []);

    const filteredProducts = products.filter((p) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
            p.name.toLowerCase().includes(q) ||
            (p.sku ?? '').toLowerCase().includes(q)
        );
    });

    const toggleSelect = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const selectAll = () => {
        setSelected(new Set(filteredProducts.map((p) => p.id)));
    };

    const clearAll = () => {
        setSelected(new Set());
    };

    const selectedProducts = products.filter((p) => selected.has(p.id));

    // Each selected product × copies
    const labelsToRender: Product[] = [];
    for (const p of selectedProducts) {
        for (let i = 0; i < copies; i++) {
            labelsToRender.push(p);
        }
    }

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="flex h-full min-h-screen bg-gray-50">
            {/* ---- Left panel: product selector (hidden on print) ---- */}
            <aside className="print:hidden w-72 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
                {/* Header */}
                <div className="px-4 py-4 border-b border-gray-100">
                    <div className="flex items-center gap-2 mb-3">
                        <Tag className="w-5 h-5 text-blue-600" />
                        <h1 className="text-base font-bold text-gray-900">Print Labels</h1>
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search products…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        {search && (
                            <button
                                onClick={() => setSearch('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Select all / clear */}
                    <div className="flex items-center justify-between mt-2">
                        <button
                            onClick={selectAll}
                            className="text-xs text-blue-600 hover:underline"
                        >
                            Select all
                        </button>
                        <span className="text-xs text-gray-400">
                            {selected.size} selected
                        </span>
                        {selected.size > 0 && (
                            <button
                                onClick={clearAll}
                                className="text-xs text-gray-500 hover:underline"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                </div>

                {/* Product list */}
                <div className="flex-1 overflow-y-auto py-1">
                    {loading ? (
                        <div className="px-4 py-6 text-center text-sm text-gray-400">Loading…</div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="px-4 py-6 text-center text-sm text-gray-400">No products found</div>
                    ) : (
                        filteredProducts.map((product) => (
                            <label
                                key={product.id}
                                className="flex items-start gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    checked={selected.has(product.id)}
                                    onChange={() => toggleSelect(product.id)}
                                    className="mt-0.5 w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                />
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-gray-900 truncate">
                                        {product.name}
                                    </div>
                                    <div className="text-xs text-gray-400 font-mono">
                                        {product.sku ?? 'No SKU'} &middot; ৳{Number(product.price).toFixed(2)}
                                    </div>
                                </div>
                            </label>
                        ))
                    )}
                </div>

                {/* Copies + Print button */}
                <div className="px-4 py-4 border-t border-gray-100 space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700">
                            Copies per label
                        </label>
                        <input
                            type="number"
                            min={1}
                            max={10}
                            value={copies}
                            onChange={(e) =>
                                setCopies(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)))
                            }
                            className="w-16 text-center text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <button
                        onClick={handlePrint}
                        disabled={selected.size === 0}
                        className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Printer className="w-4 h-4" />
                        Print Selected ({selected.size * copies})
                    </button>
                </div>
            </aside>

            {/* ---- Right panel: label preview + print area ---- */}
            <main className="flex-1 p-6 overflow-auto">
                {labelsToRender.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                        <Tag className="w-12 h-12 mb-3 opacity-30" />
                        <p className="text-sm">Select products on the left to preview labels</p>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center justify-between mb-4 print:hidden">
                            <h2 className="text-sm font-semibold text-gray-600">
                                Preview — {labelsToRender.length} label{labelsToRender.length !== 1 ? 's' : ''}
                            </h2>
                            <button
                                onClick={handlePrint}
                                className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                            >
                                <Printer className="w-4 h-4" />
                                Print
                            </button>
                        </div>

                        {/* Print-targeted area */}
                        <div id={PRINT_AREA_ID}>
                            <div
                                className="print-labels-grid"
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(4, auto)',
                                    gap: '12px',
                                }}
                            >
                                {labelsToRender.map((product, idx) => (
                                    <BarcodeLabel
                                        key={`${product.id}-${idx}`}
                                        productName={product.name}
                                        sku={product.sku ?? ''}
                                        price={Number(product.price)}
                                        businessName={businessName ?? undefined}
                                    />
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}
