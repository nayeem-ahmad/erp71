import type { ColumnDef, ColumnHelper } from '@tanstack/react-table';
import { formatDate } from '@/lib/format';

type CreatedAtRow = { created_at: string };

export function createdAtColumn<T extends CreatedAtRow>(
    _helper: ColumnHelper<T>,
    opts: { header: string; locale?: string; hideOnMobile?: boolean; size?: number },
): ColumnDef<T, string> {
    return {
        id: 'created_at',
        accessorKey: 'created_at',
        header: opts.header,
        cell: (info) => {
            const value = info.getValue();
            const d = new Date(value);
            const time = Number.isNaN(d.getTime())
                ? ''
                : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            return (
                <div>
                    <span className="text-sm text-gray-600">{formatDate(value, opts.locale)}</span>
                    {time ? <span className="text-xs text-gray-400 block">{time}</span> : null}
                </div>
            );
        },
        sortingFn: 'datetime',
        size: opts.size ?? 150,
        meta: { hideOnMobile: opts.hideOnMobile ?? true },
    };
}
