import { Trash2, Minus, Plus } from 'lucide-react';
import { LineItem } from '@/lib/hooks/useNewSaleCart';

interface LineItemsTableProps {
    items: LineItem[];
    onUpdateItem: (productId: string, updates: Partial<LineItem>) => void;
    onRemoveItem: (productId: string) => void;
}

export default function LineItemsTable({ items, onUpdateItem, onRemoveItem }: LineItemsTableProps) {
    const handleQuantityChange = (productId: string, quantity: number) => {
        if (quantity > 0) {
            onUpdateItem(productId, { quantity });
        }
    };

    const handleDiscountChange = (productId: string, discount: number) => {
        onUpdateItem(productId, { discount: Math.max(0, discount) });
    };

    const calculateLineTotal = (item: LineItem) => {
        const subtotal = item.quantity * item.price;
        return subtotal - subtotal * (item.discount / 100);
    };

    return (
        <div className="h-full overflow-hidden rounded border bg-white flex flex-col">
            <div className="flex-1 overflow-y-auto overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
                <thead className="sticky top-0 z-10 bg-gray-50 border-b">
                    <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                        <th className="px-2 py-1.5 text-left font-semibold w-8">#</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Name</th>
                        <th className="px-2 py-1.5 text-left font-semibold hidden md:table-cell">Group</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Price</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Disc %</th>
                        <th className="px-2 py-1.5 text-center font-semibold">Qty</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Total</th>
                        <th className="px-2 py-1.5 w-8"></th>
                    </tr>
                </thead>
                <tbody>
                    {items.length === 0 ? (
                        <tr>
                            <td colSpan={8} className="px-3 py-10 text-center text-gray-400">
                                No items yet — search and add products above.
                            </td>
                        </tr>
                    ) : (
                        items.map((item, index) => (
                            <tr key={item.productId} className="border-b last:border-b-0 hover:bg-gray-50">
                                <td className="px-2 py-1 text-gray-500">{index + 1}</td>
                                <td className="px-2 py-1 text-gray-900 font-medium">{item.name}</td>
                                <td className="px-2 py-1 text-gray-500 text-xs hidden md:table-cell">
                                    {item.group}
                                    {item.subgroup && ` → ${item.subgroup}`}
                                </td>
                                <td className="px-2 py-1 text-right text-gray-900 whitespace-nowrap">৳{item.price.toFixed(2)}</td>
                                <td className="px-2 py-1 text-right">
                                    <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={item.discount}
                                        onChange={(e) => handleDiscountChange(item.productId, parseFloat(e.target.value) || 0)}
                                        className="w-14 px-1.5 py-0.5 border rounded text-sm text-right"
                                    />
                                </td>
                                <td className="px-2 py-1">
                                    <div className="flex items-center justify-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => handleQuantityChange(item.productId, item.quantity - 1)}
                                            className="text-gray-400 hover:text-gray-700"
                                        >
                                            <Minus className="w-3.5 h-3.5" />
                                        </button>
                                        <input
                                            type="number"
                                            min="1"
                                            value={item.quantity}
                                            onChange={(e) => handleQuantityChange(item.productId, parseInt(e.target.value) || 1)}
                                            className="w-12 px-1.5 py-0.5 border rounded text-sm text-center"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleQuantityChange(item.productId, item.quantity + 1)}
                                            className="text-gray-400 hover:text-gray-700"
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </td>
                                <td className="px-2 py-1 text-right text-gray-900 font-semibold whitespace-nowrap">
                                    ৳{calculateLineTotal(item).toFixed(2)}
                                </td>
                                <td className="px-2 py-1 text-center">
                                    <button
                                        type="button"
                                        onClick={() => onRemoveItem(item.productId)}
                                        className="text-red-500 hover:text-red-700"
                                        title="Remove item"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
            </div>
        </div>
    );
}
