'use client';

import { useI18n } from '@/lib/i18n';
import type { WarehouseOption } from '@/lib/hooks/useWarehouses';

interface WarehouseSelectProps {
    warehouses: WarehouseOption[];
    /** Empty string selects `Same as entry`, which only the line variant offers. */
    value: string;
    onChange: (warehouseId: string) => void;
    /**
     * Line variant: adds a leading "Same as entry" option and renders at table
     * density. A line that follows the document stores no warehouse of its own,
     * so the entry's picker keeps steering it.
     */
    perLine?: boolean;
    /** The entry warehouse's name, shown on the "Same as entry" option. */
    entryWarehouseName?: string;
    readOnly?: boolean;
    className?: string;
    'aria-label'?: string;
}

/**
 * One warehouse picker, used both in the meta strip of an entry screen and in
 * the per-line column of `LineItemsTable`, so the two cannot drift apart.
 *
 * A plain `<select>` rather than the searchable typeahead the party pickers
 * use: a tenant has a handful of warehouses, not thousands of them, and a
 * dropdown is one tap on a phone where a typeahead is three.
 */
export default function WarehouseSelect({
    warehouses,
    value,
    onChange,
    perLine = false,
    entryWarehouseName,
    readOnly = false,
    className = '',
    'aria-label': ariaLabel,
}: WarehouseSelectProps) {
    const { t } = useI18n();
    const selected = warehouses.find((warehouse) => warehouse.id === value);

    if (readOnly) {
        return (
            <span className="text-gray-700 font-medium">
                {selected?.name
                    ?? (perLine && entryWarehouseName ? entryWarehouseName : '—')}
            </span>
        );
    }

    return (
        <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label={ariaLabel ?? t.common.warehouse}
            className={className}
        >
            {perLine ? (
                <option value="">
                    {entryWarehouseName
                        ? `${t.common.sameAsEntry} (${entryWarehouseName})`
                        : t.common.sameAsEntry}
                </option>
            ) : (
                // A document posted before warehouses were recorded has none to
                // show. An em dash rather than the first warehouse's name: the
                // control must not claim stock came from somewhere nobody said
                // it did. Picking any real option replaces it.
                !selected && <option value="">—</option>
            )}
            {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                </option>
            ))}
        </select>
    );
}
