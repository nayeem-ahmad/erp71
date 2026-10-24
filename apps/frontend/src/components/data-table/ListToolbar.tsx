'use client';

import { Download, Search, X } from 'lucide-react';
import { useCompactUi } from '@/contexts/CompactUiContext';
import { useIsMdUp } from '@/hooks/useMediaQuery';
import { useI18n } from '@/lib/i18n';
import { dataTableDensity } from '@/lib/ui/compact-density';
import { TableViewOptions, type TableViewLayout } from '@/components/table';
import FilterBar, { type ResolvedListFilter } from './FilterBar';

/**
 * `DataTable`'s toolbar, for a list drawn in a layout that is not a table — a
 * day ledger, an agenda. Search, filters and View options sit where they sit
 * on the table, so switching layout does not move the controls.
 */
export default function ListToolbar({
    tableId,
    filters,
    search,
    layout,
    onExport,
}: {
    /** The list's View options, shared with its table layout. */
    tableId: string;
    filters: ResolvedListFilter[];
    search?: { value: string; onChange: (next: string) => void; placeholder: string };
    layout?: TableViewLayout;
    onExport?: () => void;
}) {
    const { t } = useI18n();
    const isMdUp = useIsMdUp();
    const density = useCompactUi().density;
    const d = dataTableDensity[density];
    const isCompact = density === 'compact';
    const buttonClass = `${d.toolbarBtn} ${d.toolbarBtnIdle}`;

    return (
        <div className={`bg-white ${d.wrapper} shadow-sm border border-gray-100`}>
            <div className={isCompact ? 'p-2' : 'p-4'}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    {search && (
                        <div className="relative flex-1 min-w-[200px] max-w-md">
                            <Search className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 ${isCompact ? 'start-2.5' : 'start-3'}`} />
                            <input
                                type="text"
                                placeholder={search.placeholder}
                                aria-label={search.placeholder}
                                className={d.searchInput}
                                value={search.value}
                                onChange={(e) => search.onChange(e.target.value)}
                            />
                            {search.value && (
                                <button
                                    type="button"
                                    onClick={() => search.onChange('')}
                                    aria-label={t.common.createdRange.clear}
                                    className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    )}

                    {filters.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                            <FilterBar filters={filters} compact={!isMdUp} />
                        </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap ms-auto">
                        <TableViewOptions
                            tableId={tableId}
                            buttonClassName={buttonClass}
                            iconOnly={isCompact}
                            layout={layout}
                            showTableSettings={false}
                        />
                        {onExport && (
                            <button type="button" onClick={onExport} className={buttonClass} title={t.common.dataTable.export}>
                                <Download className="w-3.5 h-3.5" />
                                <span className={isCompact ? 'sr-only' : undefined}>{t.common.dataTable.export}</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
