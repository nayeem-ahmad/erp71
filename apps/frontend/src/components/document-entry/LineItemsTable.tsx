import { useState } from 'react';
import { Trash2, Minus, Plus, History, RotateCcw } from 'lucide-react';
import { LineItem } from '@/lib/hooks/useNewSaleCart';
import RateHistoryModal from './RateHistoryModal';
import { type RateHistoryType } from './RateHistory';
import CompoundUnitInput from '@/components/CompoundUnitInput';
import { isCompoundUnit, type CompoundUnitType } from '@/lib/compound-units';
import WarehouseSelect from './WarehouseSelect';
import type { WarehouseOption } from '@/lib/hooks/useWarehouses';
import { useColumnWidths } from './useColumnWidths';

interface LineItemsTableProps {
    items: LineItem[];
    onUpdateItem: (productId: string, updates: Partial<LineItem>) => void;
    onRemoveItem: (productId: string) => void;
    /** Freeze every field — viewing an existing document rather than editing it. */
    readOnly?: boolean;
    /**
     * Columns are opt-out because not every document persists every field:
     * sales orders and quotations store only productId/quantity/price, so
     * showing a per-line discount there would silently drop it on save.
     */
    showDiscount?: boolean;
    showAvailable?: boolean;
    /** Returns price their source sale line — the amount is not negotiable. */
    readOnlyPrice?: boolean;
    /** Hard cap per line, e.g. the un-returned quantity of a sale item. */
    maxQuantityOf?: (item: LineItem) => number | undefined;
    emptyMessage?: string;
    /** Column heading for the per-unit amount — "Cost" where the document buys. */
    priceLabel?: string;
    /** Column heading for the stock-on-hand column. */
    availableLabel?: string;
    /**
     * Enter the quantity of a compound-unit product in its two parts (3 kg
     * 250 g) instead of the base unit. Opt-in: the sales screens have always
     * counted in the base unit, and switching them is a separate decision.
     */
    showCompoundUnits?: boolean;
    /**
     * Offer a per-line "previous rates" panel. Opt-in for the same reason as on
     * ProductSearch, and ignored while the price is frozen — there is nothing to
     * adopt a historic rate into on a document you are only reading.
     */
    historyType?: RateHistoryType;
    /** The customer/supplier on the document, so their own rates lead the list. */
    historyPartyId?: string;
    historyPartyName?: string;
    /**
     * Turn on the per-line warehouse column. Passing an empty list leaves it
     * off, which is how a single-warehouse shop never sees a column it has no
     * decision to make in.
     */
    warehouses?: WarehouseOption[];
    /** Name of the document's own warehouse, for the "same as entry" option. */
    entryWarehouseName?: string;
    warehouseLabel?: string;
}

/**
 * A heading with a drag handle on its trailing edge. Same interaction and
 * styling as the one in `DataTable`, so a column behaves the same way wherever
 * the operator meets one; this table is hand-written rather than TanStack-
 * driven, so it cannot share that implementation.
 */
function Th({
    columns,
    id,
    className = '',
    children,
}: {
    columns: ReturnType<typeof useColumnWidths>;
    id: string;
    className?: string;
    children: React.ReactNode;
}) {
    const width = columns.widthOf(id);
    const resizing = columns.resizingColumn === id;

    return (
        <th
            className={`relative px-2 py-1.5 font-semibold ${className}`}
            style={width ? { width, minWidth: width, maxWidth: width } : undefined}
        >
            {children}
            <div
                role="separator"
                aria-label={`Resize ${typeof children === 'string' ? children : id} column`}
                aria-orientation="vertical"
                onMouseDown={(event) => columns.startResize(id, event)}
                onDoubleClick={() => columns.resetColumn(id)}
                title="Drag to resize · double-click to reset"
                className={`absolute end-0 top-0 h-full w-1 cursor-col-resize select-none touch-none transition-colors ${
                    resizing ? 'bg-blue-500' : 'bg-transparent hover:bg-blue-400'
                }`}
            />
        </th>
    );
}

export default function LineItemsTable({
    items,
    onUpdateItem,
    onRemoveItem,
    readOnly = false,
    showDiscount = true,
    showAvailable = true,
    readOnlyPrice = false,
    maxQuantityOf,
    emptyMessage,
    priceLabel = 'Price',
    availableLabel = 'Avail',
    showCompoundUnits = false,
    historyType,
    historyPartyId,
    historyPartyName,
    warehouses = [],
    entryWarehouseName,
    warehouseLabel = 'Warehouse',
}: LineItemsTableProps) {
    const priceFrozen = readOnly || readOnlyPrice;
    const showHistory = !!historyType && !priceFrozen;
    const showWarehouse = warehouses.length > 0;
    // #, Name, Price, Qty, Total and the remove button are always rendered;
    // Avail, Disc % and Warehouse are the opt-in ones. The group used to have a
    // column of its own and now rides under the product name.
    const columnCount = 6 + (showDiscount ? 1 : 0) + (showAvailable ? 1 : 0) + (showWarehouse ? 1 : 0);
    const columns = useColumnWidths();
    // The line whose history modal is open, if any.
    const [historyFor, setHistoryFor] = useState<LineItem | null>(null);

    const handleQuantityChange = (productId: string, quantity: number) => {
        if (quantity <= 0) return;
        const item = items.find((entry) => entry.productId === productId);
        const max = item && maxQuantityOf ? maxQuantityOf(item) : undefined;
        onUpdateItem(productId, { quantity: max == null ? quantity : Math.min(quantity, max) });
    };

    const handlePriceChange = (productId: string, price: number) => {
        onUpdateItem(productId, { price: Math.max(0, price) });
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
            <table className={`w-full text-sm ${showWarehouse ? 'min-w-[680px]' : 'min-w-[540px]'}`}>
                <thead className="sticky top-0 z-10 bg-gray-50 border-b">
                    <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                        <Th columns={columns} id="index" className="text-start w-8">#</Th>
                        <Th columns={columns} id="name" className="text-start">Name</Th>
                        {showWarehouse && (
                            <Th columns={columns} id="warehouse" className="text-start">{warehouseLabel}</Th>
                        )}
                        {showAvailable && (
                            <Th columns={columns} id="available" className="text-end hidden md:table-cell">
                                {availableLabel}
                            </Th>
                        )}
                        <Th columns={columns} id="price" className="text-end">{priceLabel}</Th>
                        {showDiscount && <Th columns={columns} id="discount" className="text-end">Disc %</Th>}
                        <Th columns={columns} id="quantity" className="text-center">Qty</Th>
                        <Th columns={columns} id="total" className="text-end">Total</Th>
                        <th className="relative px-2 py-1.5 w-8">
                            {columns.isCustomised && (
                                <button
                                    type="button"
                                    onClick={columns.resetAll}
                                    title="Reset column widths"
                                    aria-label="Reset widths"
                                    className="text-gray-400 hover:text-blue-600"
                                >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {items.length === 0 ? (
                        <tr>
                            <td colSpan={columnCount} className="px-3 py-10 text-center text-gray-400">
                                {emptyMessage
                                    ?? (readOnly ? 'No items on this sale.' : 'No items yet — search and add products above.')}
                            </td>
                        </tr>
                    ) : (
                        items.map((item, index) => (
                                <tr key={item.productId} className="border-b last:border-b-0 hover:bg-gray-50">
                                    <td className="px-2 py-1 text-gray-500">{index + 1}</td>
                                    <td className="px-2 py-1">
                                        <div className="text-gray-900 font-medium">{item.name}</div>
                                        {/* The group used to be a column of its own, hidden below
                                            `md` — so a phone never showed it at all. Under the name
                                            it survives every width and frees a column. */}
                                        {item.group && (
                                            <div className="text-xs text-gray-500">
                                                {item.group}
                                                {item.subgroup && ` → ${item.subgroup}`}
                                            </div>
                                        )}
                                    </td>
                                    {showWarehouse && (
                                        <td className="px-2 py-1">
                                            <WarehouseSelect
                                                warehouses={warehouses}
                                                value={item.warehouseId ?? ''}
                                                onChange={(warehouseId) =>
                                                    onUpdateItem(item.productId, { warehouseId: warehouseId || undefined })}
                                                perLine
                                                entryWarehouseName={entryWarehouseName}
                                                readOnly={readOnly}
                                                aria-label={`${warehouseLabel} — ${item.name}`}
                                                className="w-full min-w-[7rem] px-1.5 py-0.5 border rounded text-sm"
                                            />
                                        </td>
                                    )}
                                    {showAvailable && (
                                        <td className="px-2 py-1 text-end text-xs hidden md:table-cell">
                                            {item.availableQty == null ? (
                                                <span className="text-gray-400">—</span>
                                            ) : (
                                                <span className={item.quantity > item.availableQty ? 'text-amber-600 font-medium' : 'text-gray-500'}>
                                                    {item.availableQty}
                                                </span>
                                            )}
                                        </td>
                                    )}
                                    <td className="px-2 py-1 text-end">
                                        {priceFrozen ? (
                                            <span className="text-gray-700">৳{item.price.toFixed(2)}</span>
                                        ) : (
                                            <div className="flex items-center justify-end gap-1">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={item.price}
                                                    onChange={(e) => handlePriceChange(item.productId, parseFloat(e.target.value) || 0)}
                                                    aria-label={`${priceLabel} — ${item.name}`}
                                                    className="no-spinner w-28 px-1.5 py-0.5 border rounded text-sm text-end"
                                                />
                                                {showHistory && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setHistoryFor(item)}
                                                        aria-label={`Previous rates for ${item.name}`}
                                                        title="Previous rates"
                                                        className="text-gray-400 hover:text-blue-600"
                                                    >
                                                        <History className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                    {showDiscount && (
                                        <td className="px-2 py-1 text-end">
                                            {readOnly ? (
                                                <span className="text-gray-700">{item.discount || 0}</span>
                                            ) : (
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    value={item.discount}
                                                    onChange={(e) => handleDiscountChange(item.productId, parseFloat(e.target.value) || 0)}
                                                    aria-label={`Disc % — ${item.name}`}
                                                    className="no-spinner w-[4.5rem] px-1.5 py-0.5 border rounded text-sm text-end"
                                                />
                                            )}
                                        </td>
                                    )}
                                    <td className="px-2 py-1">
                                        {readOnly ? (
                                            <div className="text-center text-gray-700">{item.quantity}</div>
                                        ) : showCompoundUnits && isCompoundUnit(item.unitType ?? 'none') ? (
                                            <CompoundUnitInput
                                                unitType={item.unitType as CompoundUnitType}
                                                value={item.quantity}
                                                onChange={(value) => handleQuantityChange(item.productId, value)}
                                                inputClassName="px-1.5 py-0.5 border rounded text-sm"
                                            />
                                        ) : (
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
                                                    max={maxQuantityOf?.(item)}
                                                    value={item.quantity}
                                                    onChange={(e) => handleQuantityChange(item.productId, parseInt(e.target.value) || 1)}
                                                    aria-label={`Qty — ${item.name}`}
                                                    className="no-spinner w-16 px-1.5 py-0.5 border rounded text-sm text-center"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => handleQuantityChange(item.productId, item.quantity + 1)}
                                                    className="text-gray-400 hover:text-gray-700"
                                                >
                                                    <Plus className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-2 py-1 text-end text-gray-900 font-semibold whitespace-nowrap">
                                        ৳{calculateLineTotal(item).toFixed(2)}
                                    </td>
                                    <td className="px-2 py-1 text-center">
                                        {!readOnly && (
                                            <button
                                                type="button"
                                                onClick={() => onRemoveItem(item.productId)}
                                                className="text-red-500 hover:text-red-700"
                                                title="Remove item"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                        ))
                    )}
                </tbody>
            </table>
            </div>

            {historyFor && historyType && (
                <RateHistoryModal
                    productId={historyFor.productId}
                    productName={historyFor.name}
                    type={historyType}
                    partyId={historyPartyId}
                    partyName={historyPartyName}
                    onPickRate={(rate) => handlePriceChange(historyFor.productId, rate)}
                    onClose={() => setHistoryFor(null)}
                />
            )}
        </div>
    );
}
