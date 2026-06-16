import { Trash2, Minus, Plus } from 'lucide-react';
import { LineItem } from '../../../../../lib/hooks/useNewSaleCart';

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

    const calculateSubtotal = (item: LineItem) => {
        return item.quantity * item.price;
    };

    const calculateLineTotal = (item: LineItem) => {
        const subtotal = calculateSubtotal(item);
        const discountAmount = subtotal * (item.discount / 100);
        return subtotal - discountAmount;
    };

    return (
        <div className="bg-white rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Serial</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Product ID</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Name</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Group/Subgroup</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700">Unit Price</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700">Discount %</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700">Qty</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700">Subtotal</th>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 ? (
                            <tr>
                                <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                                    No items added yet. Search and add products above.
                                </td>
                            </tr>
                        ) : (
                            items.map((item, index) => (
                                <tr key={item.productId} className="border-b hover:bg-gray-50">
                                    <td className="px-4 py-3 text-gray-900 font-medium">{index + 1}</td>
                                    <td className="px-4 py-3 text-gray-600 text-xs">{item.productId.slice(0, 8)}...</td>
                                    <td className="px-4 py-3 text-gray-900 font-medium">{item.name}</td>
                                    <td className="px-4 py-3 text-gray-600 text-xs">
                                        {item.group}
                                        {item.subgroup && ` → ${item.subgroup}`}
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-900">৳{item.price.toFixed(2)}</td>
                                    <td className="px-4 py-3 text-right">
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={item.discount}
                                            onChange={(e) =>
                                                handleDiscountChange(item.productId, parseFloat(e.target.value) || 0)
                                            }
                                            className="w-16 px-2 py-1 border rounded text-sm text-right"
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleQuantityChange(item.productId, item.quantity - 1)
                                                }
                                                className="p-1 text-gray-500 hover:text-gray-700"
                                            >
                                                <Minus className="w-4 h-4" />
                                            </button>
                                            <input
                                                type="number"
                                                min="1"
                                                value={item.quantity}
                                                onChange={(e) =>
                                                    handleQuantityChange(
                                                        item.productId,
                                                        parseInt(e.target.value) || 1
                                                    )
                                                }
                                                className="w-12 px-2 py-1 border rounded text-sm text-center"
                                            />
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleQuantityChange(item.productId, item.quantity + 1)
                                                }
                                                className="p-1 text-gray-500 hover:text-gray-700"
                                            >
                                                <Plus className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-900 font-medium">
                                        ৳{calculateLineTotal(item).toFixed(2)}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button
                                            type="button"
                                            onClick={() => onRemoveItem(item.productId)}
                                            className="p-1 text-red-600 hover:bg-red-50 rounded"
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
