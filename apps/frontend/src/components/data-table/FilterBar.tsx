'use client';

import { useId, useState } from 'react';
import { ListFilter as ListFilterIcon, X } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { formatCreatedRangeLabel, isCreatedRangeEmpty, type CreatedRange, type CreatedRangePreset } from '@/lib/created-range';
import CreatedRangeFilter from './CreatedRangeFilter';

/**
 * A list's filters, declared as data and drawn by `DataTable` in its toolbar —
 * so every list's filters sit in the same place, at the same size, and fold
 * into one "Filters" sheet on a phone.
 *
 * A `select` filter either narrows one of the table's own columns
 * (`columnId`, filtered on the rows already loaded) or is the page's to apply
 * (`value`/`onChange`, e.g. sent to the server).
 */
export type ListFilter =
    | {
          id: string;
          type: 'select';
          label: string;
          options: readonly { value: string; label: string }[];
          /** Binds the filter to a table column; the table holds the value. */
          columnId?: string;
          value?: string | null;
          onChange?: (next: string | null) => void;
          /** A scope can pin the value, so the control stays visible but refuses a choice. */
          disabled?: boolean;
          title?: string;
      }
    | {
          id: string;
          type: 'date-range';
          /** Names the date; defaults to "Created". */
          label?: string;
          value: CreatedRange | null;
          /** A preset choice also names the preset — see `CreatedRangeFilter`. */
          onChange: (next: CreatedRange | null, preset?: CreatedRangePreset) => void;
          withTime?: boolean;
          /** The shortcuts the chip offers; defaults to today, yesterday, last 7 days, this month. */
          presets?: readonly CreatedRangePreset[];
      }
    | {
          id: string;
          type: 'toggle';
          label: string;
          pressed: boolean;
          onChange: (next: boolean) => void;
          /**
           * A checkbox keeps a labelled input. A button is the pressed chip
           * used for a filter that is simply on or off.
           */
          control?: 'button' | 'checkbox';
      };

/** A filter with its value resolved, as `DataTable` hands it to the bar. */
export type ResolvedListFilter =
    | (Extract<ListFilter, { type: 'select' }> & { value: string | null; onChange: (next: string | null) => void })
    | Extract<ListFilter, { type: 'date-range' }>
    | Extract<ListFilter, { type: 'toggle' }>;

export function isFilterActive(filter: ResolvedListFilter): boolean {
    if (filter.type === 'select') return Boolean(filter.value);
    if (filter.type === 'toggle') return filter.pressed;
    return !isCreatedRangeEmpty(filter.value);
}

function clearFilter(filter: ResolvedListFilter): void {
    if (filter.type === 'toggle') filter.onChange(false);
    else filter.onChange(null);
}

/**
 * A select drawn as a toolbar chip: its name, then its value. Blue-tinted
 * while it narrows the list, like any other control that is "on".
 */
function SelectChip({ filter, block = false }: { filter: Extract<ResolvedListFilter, { type: 'select' }>; block?: boolean }) {
    const { t } = useI18n();
    const id = useId();
    const active = Boolean(filter.value);
    return (
        <label
            htmlFor={id}
            className={`inline-flex items-center gap-1 rounded-md border ps-2.5 text-xs font-medium transition-colors max-md:min-h-touch ${
                block ? 'w-full' : ''
            } ${active ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
        >
            <span className={active ? 'text-blue-700' : 'text-gray-500'}>{filter.label}</span>
            <select
                id={id}
                aria-label={filter.label}
                value={filter.value ?? ''}
                disabled={filter.disabled}
                title={filter.title}
                onChange={(e) => filter.onChange(e.target.value || null)}
                className={`border-0 bg-transparent py-1.5 ps-1 text-xs font-semibold focus:outline-none focus:ring-0 disabled:cursor-not-allowed ${
                    filter.disabled ? '' : 'cursor-pointer'
                } ${block ? 'flex-1' : ''}`}
            >
                <option value="">{t.common.dataTable.filterAll}</option>
                {filter.options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </label>
    );
}

function ToggleControl({ filter }: { filter: Extract<ResolvedListFilter, { type: 'toggle' }> }) {
    if (filter.control === 'checkbox') {
        return (
            <label className="inline-flex items-center gap-2 text-xs text-gray-600 max-md:min-h-touch">
                <input
                    type="checkbox"
                    checked={filter.pressed}
                    onChange={(e) => filter.onChange(e.target.checked)}
                    className="h-4 w-4"
                />
                {filter.label}
            </label>
        );
    }
    return (
        <button
            type="button"
            aria-pressed={filter.pressed}
            onClick={() => filter.onChange(!filter.pressed)}
            className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors max-md:min-h-touch ${
                filter.pressed
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
        >
            {filter.label}
        </button>
    );
}

function FilterControl({ filter, block = false }: { filter: ResolvedListFilter; block?: boolean }) {
    if (filter.type === 'select') return <SelectChip filter={filter} block={block} />;
    if (filter.type === 'toggle') return <ToggleControl filter={filter} />;
    const range = (
        <CreatedRangeFilter
            value={filter.value}
            onChange={filter.onChange}
            label={filter.label}
            withTime={filter.withTime}
            presets={filter.presets}
        />
    );
    // In the phone sheet the trigger spans the sheet like the selects above it.
    return block ? <div className="[&>div>button]:w-full">{range}</div> : range;
}

/** "Status: Draft ✕" — what an active filter reads as when its control is out of sight. */
function chipText(filter: ResolvedListFilter, anyTime: string, createdLabel: string): string {
    if (filter.type === 'select') {
        const option = filter.options.find((o) => o.value === filter.value);
        return `${filter.label}: ${option?.label ?? filter.value}`;
    }
    if (filter.type === 'toggle') return filter.label;
    return `${filter.label ?? createdLabel}: ${formatCreatedRangeLabel(filter.value, anyTime)}`;
}

/**
 * Desktop: the filters inline, each showing its own value, and "Clear all"
 * once any of them is on. Phone: one "Filters (n)" button opening a bottom
 * sheet, with the active filters listed as removable chips under the toolbar.
 */
export default function FilterBar({ filters, compact }: { filters: ResolvedListFilter[]; compact: boolean }) {
    const { t } = useI18n();
    const copy = t.common.dataTable;
    const [sheetOpen, setSheetOpen] = useState(false);
    const active = filters.filter(isFilterActive);
    const clearAll = () => active.forEach(clearFilter);

    if (filters.length === 0) return null;

    if (!compact) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                {filters.map((filter) => (
                    <FilterControl key={filter.id} filter={filter} />
                ))}
                {active.length > 0 ? (
                    <button type="button" onClick={clearAll} className="text-xs font-medium text-blue-600 hover:underline">
                        {copy.clearAll}
                    </button>
                ) : null}
            </div>
        );
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className={`inline-flex min-h-touch items-center gap-1.5 rounded-md border px-3 text-xs font-medium ${
                    active.length > 0 ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-700'
                }`}
            >
                <ListFilterIcon className="h-4 w-4" />
                {copy.filters}
                {active.length > 0 ? (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] text-white">
                        {active.length}
                    </span>
                ) : null}
            </button>
            {active.length > 0 ? (
                <div className="flex w-full flex-wrap items-center gap-1.5">
                    {active.map((filter) => (
                        <span key={filter.id} className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 ps-2.5 text-xs text-blue-700">
                            {chipText(filter, t.common.createdRange.anyTime, t.common.createdAt)}
                            <button
                                type="button"
                                onClick={() => clearFilter(filter)}
                                aria-label={`${copy.removeFilter} ${filter.type === 'select' ? filter.label : filter.label ?? t.common.createdAt}`}
                                className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-full hover:text-blue-900"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </span>
                    ))}
                    <button type="button" onClick={clearAll} className="min-h-touch text-xs font-medium text-blue-600">
                        {copy.clearAll}
                    </button>
                </div>
            ) : null}
            {sheetOpen ? (
                <ModalShell onBackdropClick={() => setSheetOpen(false)}>
                    <div className="space-y-3 p-4">
                        <h2 className="text-base font-bold text-gray-950">{copy.filters}</h2>
                        <div className="space-y-2">
                            {filters.map((filter) => (
                                <div key={filter.id}>
                                    <FilterControl filter={filter} block />
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center justify-between gap-2 pt-1">
                            <button type="button" onClick={clearAll} className="min-h-touch text-xs font-medium text-blue-600" disabled={active.length === 0}>
                                {copy.clearAll}
                            </button>
                            <Button onClick={() => setSheetOpen(false)}>{copy.done}</Button>
                        </div>
                    </div>
                </ModalShell>
            ) : null}
        </>
    );
}
