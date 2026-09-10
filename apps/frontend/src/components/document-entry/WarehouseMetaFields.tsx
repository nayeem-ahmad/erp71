'use client';

import { useI18n } from '@/lib/i18n';
import type { WarehouseOption } from '@/lib/hooks/useWarehouses';
import { MetaField, metaFieldInputClass } from './DocumentMetaBar';
import WarehouseSelect from './WarehouseSelect';

interface WarehouseMetaFieldsProps {
    warehouses: WarehouseOption[];
    /** The document's own warehouse — every line follows it unless it overrides. */
    value: string;
    onChange: (warehouseId: string) => void;
    /** Whether the per-line column is showing in the item table. */
    perLine: boolean;
    onPerLineChange: (perLine: boolean) => void;
    readOnly?: boolean;
}

/**
 * The warehouse controls for an entry screen's meta strip: which warehouse the
 * document posts to, and a switch that reveals the per-line column for the
 * documents that are genuinely split across two of them.
 *
 * Renders nothing at all when the branch has fewer than two warehouses. Almost
 * every shop on this platform has one, and a picker with a single option is
 * noise in a strip that is already dense — the server keeps resolving the
 * default for them exactly as it did before this existed.
 *
 * The per-line column is behind a switch rather than always on for the same
 * reason: splitting one document across warehouses is the rare case, and a
 * column nobody uses costs every user horizontal room on every line.
 */
export default function WarehouseMetaFields({
    warehouses,
    value,
    onChange,
    perLine,
    onPerLineChange,
    readOnly = false,
}: WarehouseMetaFieldsProps) {
    const { t } = useI18n();

    if (warehouses.length < 2) {
        return null;
    }

    return (
        <>
            <MetaField label={t.common.warehouse}>
                <WarehouseSelect
                    warehouses={warehouses}
                    value={value}
                    onChange={onChange}
                    readOnly={readOnly}
                    className={metaFieldInputClass}
                />
            </MetaField>
            {!readOnly && (
                <label className="flex items-center gap-1 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={perLine}
                        onChange={(event) => onPerLineChange(event.target.checked)}
                        className="h-3.5 w-3.5 accent-blue-600"
                    />
                    <span className="font-semibold uppercase tracking-wide text-[10px] text-gray-400">
                        {t.common.perLineWarehouse}
                    </span>
                </label>
            )}
        </>
    );
}
