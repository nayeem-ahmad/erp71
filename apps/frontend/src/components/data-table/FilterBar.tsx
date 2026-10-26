'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ListFilter as ListFilterIcon, X } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { Button } from '@/components/ui';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { formatCreatedRangeLabel, isCreatedRangeEmpty, type CreatedRange, type CreatedRangePreset } from '@/lib/created-range';
import { formatNumberCondition, type NumberCondition } from '@/lib/number-condition';
import CreatedRangeFilter, { CreatedRangePanel } from './CreatedRangeFilter';
import { MultiSelectPanel, NumberConditionPanel, optionLabel, type ListFilterOption } from './filter-panels';

export type { ListFilterOption } from './filter-panels';

/**
 * A list's filters, declared as data and drawn by `DataTable` in its toolbar —
 * so every list's filters sit in the same place, at the same size, and fold
 * into one "Filters" sheet on a phone.
 *
 * A `select` filter either narrows one of the table's own columns
 * (`columnId`, filtered on the rows already loaded) or is the page's to apply
 * (`value`/`onChange`, e.g. sent to the server).
 *
 * `more` keeps a filter behind the toolbar's More button in the one-row
 * layout (`DataTable`'s `filterLayout="row"`) — the rarely used ones, so the
 * row holds the few people reach for.
 */
export type ListFilter =
    | {
          id: string;
          type: 'select';
          label: string;
          options: readonly ListFilterOption[];
          /** Binds the filter to a table column; the table holds the value. */
          columnId?: string;
          value?: string | null;
          onChange?: (next: string | null) => void;
          /** A scope can pin the value, so the control stays visible but refuses a choice. */
          disabled?: boolean;
          title?: string;
          more?: boolean;
      }
    | {
          id: string;
          type: 'multi-select';
          label: string;
          options: readonly ListFilterOption[];
          value: readonly string[];
          onChange: (next: string[]) => void;
          /** Offers "is none of" beside "is any of"; the page sends it along with the values. */
          exclude?: { value: boolean; onChange: (next: boolean) => void };
          /**
           * Asks for options matching typed text — for a list too long to send
           * whole (customers). `options` are what shows before anything is typed.
           */
          loadOptions?: (query: string) => Promise<readonly ListFilterOption[]>;
          /** A search box over `options`; on by default past eight of them. */
          searchable?: boolean;
          more?: boolean;
      }
    | {
          id: string;
          type: 'number';
          label: string;
          value: NumberCondition | null;
          onChange: (next: NumberCondition | null) => void;
          /** Shown and typed as taka. */
          money?: boolean;
          more?: boolean;
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
          /** Asks for a custom range as is between / on / before / after. */
          operators?: boolean;
          more?: boolean;
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
          more?: boolean;
      };

/** A filter with its value resolved, as `DataTable` hands it to the bar. */
export type ResolvedListFilter =
    | (Extract<ListFilter, { type: 'select' }> & { value: string | null; onChange: (next: string | null) => void })
    | Extract<ListFilter, { type: 'multi-select' }>
    | Extract<ListFilter, { type: 'number' }>
    | Extract<ListFilter, { type: 'date-range' }>
    | Extract<ListFilter, { type: 'toggle' }>;

export function isFilterActive(filter: ResolvedListFilter): boolean {
    switch (filter.type) {
        case 'select':
            return Boolean(filter.value);
        case 'multi-select':
            return filter.value.length > 0;
        case 'number':
            return filter.value !== null;
        case 'toggle':
            return filter.pressed;
        case 'date-range':
            return !isCreatedRangeEmpty(filter.value);
    }
}

function clearFilter(filter: ResolvedListFilter): void {
    switch (filter.type) {
        case 'toggle':
            filter.onChange(false);
            return;
        case 'multi-select':
            filter.onChange([]);
            if (filter.exclude?.value) filter.exclude.onChange(false);
            return;
        default:
            filter.onChange(null);
    }
}

function filterLabel(filter: ResolvedListFilter, createdLabel: string): string {
    return filter.type === 'date-range' ? filter.label ?? createdLabel : filter.label;
}

type Copy = ReturnType<typeof useI18n>['t'];

/** What an active filter is set to, as its chip shows it: "Completed +1", "৳1,000 – ৳5,000". */
function filterValueText(filter: ResolvedListFilter, t: Copy, locale: string): string {
    switch (filter.type) {
        case 'select': {
            const option = filter.options.find((o) => o.value === filter.value);
            return option?.label ?? filter.value ?? '';
        }
        case 'multi-select': {
            const [first, ...rest] = filter.value;
            if (first === undefined) return '';
            const text = optionLabel(filter.id, filter.options, first) + (rest.length ? ` +${rest.length}` : '');
            return filter.exclude?.value ? formatMessage(t.common.dataTable.filterNot, { value: text }) : text;
        }
        case 'number': {
            if (!filter.value) return '';
            const format = filter.money
                ? (n: number) => formatBDT(n, { locale, minimumFractionDigits: 0, maximumFractionDigits: 2 })
                : (n: number) => n.toLocaleString(locale);
            return formatNumberCondition(filter.value, format);
        }
        case 'toggle':
            return filter.label;
        case 'date-range':
            return formatCreatedRangeLabel(filter.value, t.common.createdRange.anyTime);
    }
}

/** "Status: Draft ✕" — what an active filter reads as when its control is out of sight. */
function chipText(filter: ResolvedListFilter, t: Copy, locale: string): string {
    if (filter.type === 'toggle') return filter.label;
    return `${filterLabel(filter, t.common.createdAt)}: ${filterValueText(filter, t, locale)}`;
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
            className={`inline-flex shrink-0 items-center gap-1 rounded-md border ps-2.5 text-xs font-medium transition-colors max-md:min-h-touch ${
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
            <label className="inline-flex shrink-0 items-center gap-2 text-xs text-gray-600 max-md:min-h-touch">
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
            className={`inline-flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors max-md:min-h-touch ${
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
    if (filter.type === 'multi-select' || filter.type === 'number') return <PopoverChip filter={filter} />;
    const range = (
        <CreatedRangeFilter
            value={filter.value}
            onChange={filter.onChange}
            label={filter.label}
            withTime={filter.withTime}
            presets={filter.presets}
            operators={filter.operators}
        />
    );
    // In the phone sheet the trigger spans the sheet like the selects above it.
    return block ? <div className="[&>div>button]:w-full">{range}</div> : range;
}

/** The editor a filter opens: in its chip's popover, the More panel, or the phone sheet. */
function FilterPanel({ filter, onDone }: { filter: ResolvedListFilter; onDone?: () => void }) {
    switch (filter.type) {
        case 'multi-select':
            return (
                <MultiSelectPanel
                    filterId={filter.id}
                    label={filter.label}
                    options={filter.options}
                    value={filter.value}
                    onChange={filter.onChange}
                    exclude={filter.exclude}
                    loadOptions={filter.loadOptions}
                    searchable={filter.searchable}
                />
            );
        case 'number':
            return (
                <NumberConditionPanel
                    label={filter.label}
                    value={filter.value}
                    onChange={filter.onChange}
                    money={filter.money}
                    onDone={onDone}
                />
            );
        case 'date-range':
            return (
                <div className="w-64 max-w-full p-3">
                    <CreatedRangePanel
                        value={filter.value}
                        onChange={filter.onChange}
                        withTime={filter.withTime}
                        presets={filter.presets}
                        operators={filter.operators}
                        onDone={onDone}
                    />
                </div>
            );
        case 'select':
            return (
                <div className="p-2">
                    <SelectChip filter={filter} block />
                </div>
            );
        case 'toggle':
            return (
                <div className="p-2">
                    <ToggleControl filter={filter} />
                </div>
            );
    }
}

const VIEWPORT_MARGIN = 8;

/** SSR has no layout to measure, and useLayoutEffect warns there. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Open state for a chip's popover: shut by a click outside or Escape, and
 * hung off whichever edge of the chip keeps it on screen.
 */
function useChipPopover(onOpenChange?: (open: boolean) => void) {
    const [open, setOpenState] = useState(false);
    const [alignEnd, setAlignEnd] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const setOpen = (next: boolean) => {
        setOpenState(next);
        onOpenChange?.(next);
    };
    const latestSetOpen = useRef(setOpen);
    latestSetOpen.current = setOpen;

    useIsomorphicLayoutEffect(() => {
        if (!open) return;
        const root = rootRef.current;
        const panel = panelRef.current;
        if (!root || !panel) return;
        const rect = root.getBoundingClientRect();
        const width = panel.offsetWidth;
        const rtl = getComputedStyle(root).direction === 'rtl';
        setAlignEnd(rtl ? rect.right - width < VIEWPORT_MARGIN : rect.left + width > window.innerWidth - VIEWPORT_MARGIN);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onPointer = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) latestSetOpen.current(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') latestSetOpen.current(false);
        };
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return { open, setOpen, alignEnd, rootRef, panelRef };
}

const chipClass = (active: boolean) =>
    `inline-flex shrink-0 items-center rounded-md border text-xs font-medium transition-colors ${
        active ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
    }`;

/**
 * A filter drawn as a chip that opens its editor: "Status ▾" while idle,
 * "Status: Completed +1 ✕" once it narrows the list.
 */
function PopoverChip({ filter }: { filter: Extract<ResolvedListFilter, { type: 'multi-select' | 'number' | 'date-range' }> }) {
    const { t, locale } = useI18n();
    const popover = useChipPopover();
    const active = isFilterActive(filter);
    const label = filterLabel(filter, t.common.createdAt);
    return (
        <div ref={popover.rootRef} className="relative shrink-0">
            <div className={chipClass(active)}>
                <button
                    type="button"
                    aria-expanded={popover.open}
                    aria-haspopup="dialog"
                    onClick={() => popover.setOpen(!popover.open)}
                    className={`inline-flex items-center gap-1 py-1.5 ps-2.5 max-md:min-h-touch ${active ? 'pe-1' : 'pe-2'}`}
                >
                    <span className={active ? 'text-blue-700' : 'text-gray-500'}>
                        {label}
                        {active ? ':' : ''}
                    </span>
                    {active ? <span className="max-w-[10rem] truncate font-semibold">{filterValueText(filter, t, locale)}</span> : null}
                    <ChevronDown aria-hidden className="h-3.5 w-3.5 opacity-60" />
                </button>
                {active ? (
                    <button
                        type="button"
                        onClick={() => {
                            clearFilter(filter);
                            popover.setOpen(false);
                        }}
                        aria-label={`${t.common.dataTable.removeFilter} ${label}`}
                        className="me-1 rounded p-0.5 hover:bg-blue-100 max-md:min-h-touch max-md:min-w-touch"
                    >
                        <X className="h-3 w-3" />
                    </button>
                ) : null}
            </div>
            {popover.open ? (
                <div
                    ref={popover.panelRef}
                    role="dialog"
                    aria-label={label}
                    className={`absolute top-full z-50 mt-1 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white shadow-lg ${
                        popover.alignEnd ? 'end-0' : 'start-0'
                    }`}
                >
                    <FilterPanel filter={filter} onDone={() => popover.setOpen(false)} />
                </div>
            ) : null}
        </div>
    );
}

/** One chip of the one-row layout. */
function RowChip({ filter }: { filter: ResolvedListFilter }) {
    if (filter.type === 'select') return <SelectChip filter={filter} />;
    if (filter.type === 'toggle') return <ToggleControl filter={filter} />;
    return <PopoverChip filter={filter} />;
}

/**
 * Filters listed one per row, each opening its editor underneath — the More
 * panel and the phone sheet. A toggle needs no editor and is its own row.
 */
function FilterAccordion({ filters }: { filters: ResolvedListFilter[] }) {
    const { t, locale } = useI18n();
    const [openId, setOpenId] = useState<string | null>(null);
    return (
        <div className="space-y-0.5">
            {filters.map((filter) => {
                if (filter.type === 'toggle') {
                    return (
                        <div key={filter.id} className="px-2 py-1">
                            <ToggleControl filter={filter} />
                        </div>
                    );
                }
                const active = isFilterActive(filter);
                const open = openId === filter.id;
                const label = filterLabel(filter, t.common.createdAt);
                return (
                    <div key={filter.id} className={`rounded-md ${open ? 'bg-gray-50' : ''}`}>
                        <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => setOpenId(open ? null : filter.id)}
                            className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs hover:bg-gray-50 max-md:min-h-touch"
                        >
                            <span className="font-medium text-gray-700">{label}</span>
                            <span className={`flex min-w-0 items-center gap-1 ${active ? 'font-semibold text-blue-700' : 'text-gray-400'}`}>
                                <span className="truncate">{active ? filterValueText(filter, t, locale) : t.common.dataTable.anyValue}</span>
                                {open ? <ChevronUp aria-hidden className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0" />}
                            </span>
                        </button>
                        {open ? (
                            <div className="m-1 overflow-hidden rounded-md border border-gray-200 bg-white [&>div]:w-full">
                                <FilterPanel filter={filter} />
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

/** The More button: the filters kept off the row, and any the row ran out of room for. */
function MoreFilters({ filters, onOpenChange }: { filters: ResolvedListFilter[]; onOpenChange: (open: boolean) => void }) {
    const { t } = useI18n();
    const copy = t.common.dataTable;
    const popover = useChipPopover(onOpenChange);
    const activeCount = filters.filter(isFilterActive).length;
    return (
        <div ref={popover.rootRef} className="relative shrink-0">
            <button
                type="button"
                aria-expanded={popover.open}
                aria-haspopup="dialog"
                onClick={() => popover.setOpen(!popover.open)}
                className={`${chipClass(activeCount > 0)} gap-1 px-2.5 py-1.5 max-md:min-h-touch`}
            >
                <ListFilterIcon aria-hidden className="h-3.5 w-3.5" />
                {copy.more}
                {activeCount > 0 ? (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] text-white">
                        {activeCount}
                    </span>
                ) : null}
                <ChevronDown aria-hidden className="h-3.5 w-3.5 opacity-60" />
            </button>
            {popover.open ? (
                <div
                    ref={popover.panelRef}
                    role="dialog"
                    aria-label={copy.more}
                    className={`absolute top-full z-50 mt-1 w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg ${
                        popover.alignEnd ? 'end-0' : 'start-0'
                    }`}
                >
                    <FilterAccordion filters={filters} />
                </div>
            ) : null}
        </div>
    );
}

/** What a filter is set to, for noticing that a chip changed width. */
function valueKey(filter: ResolvedListFilter): string {
    if (filter.type === 'toggle') return String(filter.pressed);
    if (filter.type === 'multi-select') return `${filter.value.join(',')}|${filter.exclude?.value ?? ''}`;
    return JSON.stringify(filter.value ?? null);
}

/**
 * Desktop, one row: the list's filters as chips, then More. When the row runs
 * out of room — a narrow window, a chip grown by its value — chips move into
 * More from the end, idle ones before any that are narrowing the list. Each
 * change of width or value puts them back and measures again, before paint.
 */
function FilterRow({ filters }: { filters: ResolvedListFilter[] }) {
    const { t } = useI18n();
    const rootRef = useRef<HTMLDivElement>(null);
    const rowRef = useRef<HTMLDivElement>(null);
    const [overflowIds, setOverflowIds] = useState<string[]>([]);
    const [width, setWidth] = useState(0);
    // While More is open its list must not reshuffle under the pointer.
    const [moreOpen, setMoreOpen] = useState(false);

    useEffect(() => {
        const root = rootRef.current;
        if (!root || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
        observer.observe(root);
        return () => observer.disconnect();
    }, []);

    const layoutKey = moreOpen ? 'frozen' : `${width}|${filters.map((f) => `${f.id}=${valueKey(f)}`).join(';')}`;
    const measuredKey = useRef(layoutKey);

    useIsomorphicLayoutEffect(() => {
        if (measuredKey.current !== layoutKey) {
            measuredKey.current = layoutKey;
            if (layoutKey !== 'frozen' && overflowIds.length) {
                setOverflowIds([]);
                return;
            }
        }
        const row = rowRef.current;
        if (!row || row.scrollWidth <= row.clientWidth + 1) return;
        const inRow = filters.filter((f) => !f.more && !overflowIds.includes(f.id));
        if (inRow.length === 0) return;
        const idle = inRow.filter((f) => !isFilterActive(f));
        const out = (idle.length ? idle : inRow)[(idle.length ? idle : inRow).length - 1];
        setOverflowIds((current) => [...current, out.id]);
    });

    const rowFilters = filters.filter((f) => !f.more && !overflowIds.includes(f.id));
    const moreFilters = [
        // The overflow in its declared order, ahead of the filters that always live there.
        ...filters.filter((f) => !f.more && overflowIds.includes(f.id)),
        ...filters.filter((f) => f.more),
    ];
    const active = filters.filter(isFilterActive);

    return (
        <div ref={rootRef} className="flex min-w-0 flex-1 items-center gap-1.5">
            <div ref={rowRef} className="flex min-w-0 shrink flex-nowrap items-center gap-1.5">
                {rowFilters.map((filter) => (
                    <RowChip key={filter.id} filter={filter} />
                ))}
            </div>
            {moreFilters.length > 0 ? <MoreFilters filters={moreFilters} onOpenChange={setMoreOpen} /> : null}
            {active.length > 0 ? (
                <button
                    type="button"
                    onClick={() => active.forEach(clearFilter)}
                    className="shrink-0 whitespace-nowrap text-xs font-medium text-blue-600 hover:underline"
                >
                    {t.common.dataTable.clearAll}
                </button>
            ) : null}
        </div>
    );
}

/**
 * Desktop: the filters inline, each showing its own value, and "Clear all"
 * once any of them is on — wrapping onto more lines, or (`layout="row"`) held
 * to one line with a More button. Phone: one "Filters (n)" button opening a
 * bottom sheet, with the active filters listed as removable chips under the
 * toolbar.
 */
export default function FilterBar({
    filters,
    compact,
    layout = 'wrap',
}: {
    filters: ResolvedListFilter[];
    compact: boolean;
    layout?: 'wrap' | 'row';
}) {
    const { t, locale } = useI18n();
    const copy = t.common.dataTable;
    const [sheetOpen, setSheetOpen] = useState(false);
    const active = filters.filter(isFilterActive);
    const clearAll = () => active.forEach(clearFilter);

    if (filters.length === 0) return null;

    if (!compact && layout === 'row') return <FilterRow filters={filters} />;

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

    // In the sheet the controls that fit a row are drawn as they are; the ones
    // with a panel of their own (several ticks, an amount) open in place.
    const sheetRows: ReactNode[] = [];
    let panelGroup: ResolvedListFilter[] = [];
    const flushPanels = () => {
        if (panelGroup.length) sheetRows.push(<FilterAccordion key={`panels-${panelGroup[0].id}`} filters={panelGroup} />);
        panelGroup = [];
    };
    for (const filter of filters) {
        if (filter.type === 'multi-select' || filter.type === 'number') {
            panelGroup.push(filter);
            continue;
        }
        flushPanels();
        sheetRows.push(
            <div key={filter.id}>
                <FilterControl filter={filter} block />
            </div>,
        );
    }
    flushPanels();

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
                        <span key={filter.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-blue-200 bg-blue-50 ps-2.5 text-xs text-blue-700">
                            <span className="truncate">{chipText(filter, t, locale)}</span>
                            <button
                                type="button"
                                onClick={() => clearFilter(filter)}
                                aria-label={`${copy.removeFilter} ${filterLabel(filter, t.common.createdAt)}`}
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
                        <div className="space-y-2">{sheetRows}</div>
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
