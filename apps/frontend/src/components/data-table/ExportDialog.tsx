'use client';

import { useEffect, useMemo, useState } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button } from '@/components/ui';
import { formatMessage, useI18n } from '@/lib/i18n';
import { EXPORT_ROW_CAP } from './fetch-all-pages';

export type ExportFormat = 'csv' | 'excel' | 'pdf';
export type ExportRowScope = 'page' | 'all';

export interface ExportableColumn {
    id: string;
    label: string;
    visible: boolean;
}

export interface ExportDialogProps {
    open: boolean;
    title: string;
    pageCount: number;
    totalCount: number;
    columns: ExportableColumn[];
    busy?: boolean;
    progress?: { loaded: number; total: number } | null;
    onClose: () => void;
    onConfirm: (opts: {
        format: ExportFormat;
        rowScope: ExportRowScope;
        columnIds: string[];
    }) => void;
}

function formatCount(n: number): string {
    return n.toLocaleString('en-US');
}

export default function ExportDialog({
    open,
    title,
    pageCount,
    totalCount,
    columns,
    busy = false,
    progress = null,
    onClose,
    onConfirm,
}: ExportDialogProps) {
    const { t } = useI18n();
    const copy = t.common.dataTable;

    const visibleIds = useMemo(
        () => columns.filter((c) => c.visible).map((c) => c.id),
        [columns],
    );
    const allIds = useMemo(() => columns.map((c) => c.id), [columns]);

    const [format, setFormat] = useState<ExportFormat>('csv');
    const [rowScope, setRowScope] = useState<ExportRowScope>('all');
    const [selected, setSelected] = useState<Set<string>>(new Set(visibleIds));

    useEffect(() => {
        if (!open) return;
        setFormat('csv');
        setRowScope('all');
        setSelected(new Set(visibleIds));
    }, [open, visibleIds]);

    if (!open) return null;

    const selectedIds = columns.filter((c) => selected.has(c.id)).map((c) => c.id);
    const showCapWarning = rowScope === 'all' && totalCount > EXPORT_ROW_CAP;
    const showLargeHint = rowScope === 'all' && totalCount > 500 && !showCapWarning;

    const toggleColumn = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <ModalShell size="md" onBackdropClick={busy ? undefined : onClose}>
            <ModalHeader
                title={formatMessage(copy.exportDialogTitle, { title })}
                onClose={busy ? undefined : onClose}
            />
            <div className="p-4 space-y-4 overflow-y-auto">
                <fieldset className="space-y-2">
                    <legend className="text-xs font-semibold text-gray-500">{copy.exportFormat}</legend>
                    <div className="flex flex-wrap gap-3">
                        {([
                            ['csv', copy.exportFormatCsv],
                            ['excel', copy.exportFormatExcel],
                            ['pdf', copy.exportFormatPdf],
                        ] as const).map(([value, label]) => (
                            <label key={value} className="inline-flex items-center gap-2 text-sm text-gray-700 min-h-touch">
                                <input
                                    type="radio"
                                    name="export-format"
                                    value={value}
                                    checked={format === value}
                                    onChange={() => setFormat(value)}
                                    className="h-4 w-4 text-blue-600"
                                />
                                {label}
                            </label>
                        ))}
                    </div>
                </fieldset>

                <fieldset className="space-y-2">
                    <legend className="text-xs font-semibold text-gray-500">{copy.exportRows}</legend>
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-2 text-sm text-gray-700 min-h-touch">
                            <input
                                type="radio"
                                name="export-rows"
                                value="page"
                                checked={rowScope === 'page'}
                                onChange={() => setRowScope('page')}
                                className="h-4 w-4 text-blue-600"
                            />
                            {formatMessage(copy.exportCurrentPage, { count: formatCount(pageCount) })}
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700 min-h-touch">
                            <input
                                type="radio"
                                name="export-rows"
                                value="all"
                                checked={rowScope === 'all'}
                                onChange={() => setRowScope('all')}
                                className="h-4 w-4 text-blue-600"
                            />
                            {formatMessage(copy.exportCompleteList, { count: formatCount(totalCount) })}
                        </label>
                    </div>
                    {showCapWarning && (
                        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                            {formatMessage(copy.exportCapWarning, { cap: formatCount(EXPORT_ROW_CAP) })}
                        </p>
                    )}
                    {showLargeHint && (
                        <p className="text-xs text-gray-500">{copy.exportLargeListHint}</p>
                    )}
                </fieldset>

                <fieldset className="space-y-2">
                    <legend className="text-xs font-semibold text-gray-500">{copy.exportColumns}</legend>
                    <div className="flex items-center gap-2">
                        <Button type="button" variant="secondary" size="sm" onClick={() => setSelected(new Set(visibleIds))}>
                            {copy.exportVisibleColumns}
                        </Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setSelected(new Set(allIds))}>
                            {copy.exportAllColumns}
                        </Button>
                    </div>
                    <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-50">
                        {columns.map((column) => (
                            <label
                                key={column.id}
                                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 min-h-touch cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    checked={selected.has(column.id)}
                                    onChange={() => toggleColumn(column.id)}
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                                />
                                {column.label}
                            </label>
                        ))}
                    </div>
                </fieldset>

                {busy && progress && (
                    <p className="text-xs text-gray-500">
                        {formatMessage(copy.exportFetching, {
                            loaded: formatCount(progress.loaded),
                            total: formatCount(progress.total),
                        })}
                    </p>
                )}
            </div>
            <ModalFooter>
                <Button variant="ghost" onClick={onClose} disabled={busy}>
                    {t.common.cancel}
                </Button>
                <Button
                    variant="primary"
                    loading={busy}
                    disabled={busy || selectedIds.length === 0}
                    onClick={() => onConfirm({ format, rowScope, columnIds: selectedIds })}
                >
                    {copy.exportDownload}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
