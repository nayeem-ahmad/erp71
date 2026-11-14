'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Button, Field, Input, Select } from '@/components/ui';
import { formatMessage, useI18n } from '@/lib/i18n';
import { addCalendarDays, tenantDateOnly } from '@/lib/created-range';
import { NUMBER_CONDITION_OPS, type NumberCondition, type NumberConditionOp } from '@/lib/number-condition';

export interface ListFilterOption {
    value: string;
    label: string;
    /** How many rows currently match, drawn beside the label when the list is cheap to count. */
    count?: number;
}

/**
 * Labels of options a filter fetched as the person typed (a customer picked
 * from a search), by filter id. Kept outside any one component: the chip that
 * names the choice and the panel that made it mount and unmount on their own,
 * and a chip reading "Customer: 3f2a…" would be no use.
 */
const fetchedLabels = new Map<string, Map<string, string>>();

export function rememberOptions(filterId: string, options: readonly ListFilterOption[]): void {
    let known = fetchedLabels.get(filterId);
    if (!known) {
        known = new Map();
        fetchedLabels.set(filterId, known);
    }
    for (const option of options) known.set(option.value, option.label);
}

export function optionLabel(filterId: string, options: readonly ListFilterOption[], value: string): string {
    return options.find((option) => option.value === value)?.label ?? fetchedLabels.get(filterId)?.get(value) ?? value;
}

/** Past this many options a list gets a search box. */
const SEARCH_THRESHOLD = 8;
/** Waits for typing to pause before asking the server. */
const SEARCH_DEBOUNCE_MS = 250;

export interface MultiSelectPanelProps {
    filterId: string;
    label: string;
    options: readonly ListFilterOption[];
    value: readonly string[];
    onChange: (next: string[]) => void;
    exclude?: { value: boolean; onChange: (next: boolean) => void };
    loadOptions?: (query: string) => Promise<readonly ListFilterOption[]>;
    searchable?: boolean;
    /** The filter always holds a value: no Clear. */
    required?: boolean;
}

/**
 * The search box behind an option list: filters `options` as the person
 * types or, with `loadOptions`, asks the server once typing pauses.
 */
function useOptionSearch(filterId: string, loadOptions?: (query: string) => Promise<readonly ListFilterOption[]>) {
    const [query, setQuery] = useState('');
    const [fetched, setFetched] = useState<readonly ListFilterOption[] | null>(null);
    const [loading, setLoading] = useState(false);
    const trimmed = query.trim();

    useEffect(() => {
        if (!loadOptions || !trimmed) {
            setFetched(null);
            setLoading(false);
            return;
        }
        let live = true;
        setLoading(true);
        const timer = setTimeout(() => {
            loadOptions(trimmed)
                .then((found) => {
                    if (!live) return;
                    rememberOptions(filterId, found);
                    setFetched(found);
                })
                .catch(() => {
                    if (live) setFetched([]);
                })
                .finally(() => {
                    if (live) setLoading(false);
                });
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            live = false;
            clearTimeout(timer);
        };
    }, [filterId, loadOptions, trimmed]);

    return { query, setQuery, trimmed, fetched, loading };
}

/** What a search matches: the server's answer, or the options whose label holds the text. */
function matchedOptions(
    trimmed: string,
    options: readonly ListFilterOption[],
    fetched: readonly ListFilterOption[] | null,
    remote: boolean,
): readonly ListFilterOption[] {
    if (remote) return fetched ?? [];
    const needle = trimmed.toLowerCase();
    return options.filter((option) => option.label.toLowerCase().includes(needle));
}

function OptionSearchBox({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
    const { t } = useI18n();
    const text = formatMessage(t.common.dataTable.searchOptions, { label });
    return (
        <div className="p-2 pb-0">
            <div className="relative">
                <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <Input
                    type="search"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={text}
                    aria-label={text}
                    className="w-full ps-7 text-xs"
                    autoFocus
                />
            </div>
        </div>
    );
}

/**
 * Ticks several values of one filter — every tick narrows the list straight
 * away. With `exclude` it can also turn round to "is none of"; with
 * `loadOptions` the search box asks the server, for a list too long to send
 * whole.
 */
export function MultiSelectPanel({
    filterId,
    label,
    options,
    value,
    onChange,
    exclude,
    loadOptions,
    searchable,
    required = false,
}: MultiSelectPanelProps) {
    const { t } = useI18n();
    const copy = t.common.dataTable;
    const { query, setQuery, trimmed, fetched, loading } = useOptionSearch(filterId, loadOptions);
    const showSearch = Boolean(loadOptions) || (searchable ?? options.length > SEARCH_THRESHOLD);
    const selected = useMemo(() => new Set(value), [value]);

    const shown = useMemo(() => {
        if (trimmed) return matchedOptions(trimmed, options, fetched, Boolean(loadOptions));
        // What is ticked comes first, including picks fetched by an earlier
        // search that the static list does not carry.
        const fromSearch = value
            .filter((v) => !options.some((option) => option.value === v))
            .map((v) => ({ value: v, label: optionLabel(filterId, options, v) }));
        const ticked = options.filter((option) => selected.has(option.value));
        const rest = options.filter((option) => !selected.has(option.value));
        return [...fromSearch, ...ticked, ...rest];
    }, [trimmed, loadOptions, fetched, options, value, selected, filterId]);

    const toggle = (optionValue: string) => {
        onChange(selected.has(optionValue) ? value.filter((v) => v !== optionValue) : [...value, optionValue]);
    };

    return (
        <div className="w-64 max-w-full">
            {exclude ? (
                <div className="p-2 pb-0">
                    <div role="group" aria-label={label} className="grid grid-cols-2 rounded-md border border-gray-200 p-0.5">
                        {[false, true].map((excluding) => (
                            <button
                                key={String(excluding)}
                                type="button"
                                aria-pressed={exclude.value === excluding}
                                onClick={() => exclude.onChange(excluding)}
                                className={`rounded px-2 py-1 text-xs font-medium transition-colors max-md:min-h-touch ${
                                    exclude.value === excluding ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                                {excluding ? copy.filterNoneOf : copy.filterAnyOf}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
            {showSearch ? <OptionSearchBox label={label} value={query} onChange={setQuery} /> : null}
            <div className="max-h-60 overflow-y-auto p-1" role="group" aria-label={label}>
                {loading ? (
                    <p className="px-2 py-1.5 text-xs text-gray-400">{copy.searchingOptions}</p>
                ) : shown.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-gray-400">{copy.noOptions}</p>
                ) : (
                    shown.map((option) => (
                        <label
                            key={option.value}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 max-md:min-h-touch"
                        >
                            <input
                                type="checkbox"
                                checked={selected.has(option.value)}
                                onChange={() => toggle(option.value)}
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/40"
                            />
                            <span className="min-w-0 flex-1 truncate">{option.label}</span>
                            {option.count != null ? (
                                <span className="shrink-0 tabular-nums text-gray-400">{option.count}</span>
                            ) : null}
                        </label>
                    ))
                )}
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-xs">
                {loadOptions ? (
                    <span />
                ) : (
                    <button
                        type="button"
                        onClick={() => onChange(options.map((option) => option.value))}
                        className="font-medium text-blue-600 hover:underline max-md:min-h-touch"
                    >
                        {copy.selectAll}
                    </button>
                )}
                {required ? null : (
                    <button
                        type="button"
                        onClick={() => onChange([])}
                        disabled={value.length === 0}
                        className="text-gray-500 hover:underline disabled:opacity-40 max-md:min-h-touch"
                    >
                        {copy.clear}
                    </button>
                )}
            </div>
        </div>
    );
}

export interface SingleSelectPanelProps {
    filterId: string;
    label: string;
    options: readonly ListFilterOption[];
    value: string | null;
    onChange: (next: string | null) => void;
    loadOptions?: (query: string) => Promise<readonly ListFilterOption[]>;
    /** The filter always holds a value: no Clear. */
    required?: boolean;
    /** Called once a choice is made — the popover around the panel closes on it. */
    onDone?: () => void;
}

/**
 * Picks one value from a list long enough to want a search box (an account
 * out of a chart of accounts). A pick applies at once; Clear empties it,
 * unless the filter is required.
 */
export function SingleSelectPanel({
    filterId,
    label,
    options,
    value,
    onChange,
    loadOptions,
    required = false,
    onDone,
}: SingleSelectPanelProps) {
    const { t } = useI18n();
    const copy = t.common.dataTable;
    const { query, setQuery, trimmed, fetched, loading } = useOptionSearch(filterId, loadOptions);

    const shown = useMemo(() => {
        if (trimmed) return matchedOptions(trimmed, options, fetched, Boolean(loadOptions));
        // A pick fetched by an earlier search is not among the static options.
        if (value && !options.some((option) => option.value === value)) {
            return [{ value, label: optionLabel(filterId, options, value) }, ...options];
        }
        return options;
    }, [trimmed, options, fetched, loadOptions, value, filterId]);

    const pick = (next: string | null) => {
        onChange(next);
        onDone?.();
    };

    return (
        <div className="w-64 max-w-full">
            <OptionSearchBox label={label} value={query} onChange={setQuery} />
            <div className="max-h-60 overflow-y-auto p-1" role="listbox" aria-label={label}>
                {loading ? (
                    <p className="px-2 py-1.5 text-xs text-gray-400">{copy.searchingOptions}</p>
                ) : shown.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-gray-400">{copy.noOptions}</p>
                ) : (
                    shown.map((option) => {
                        const chosen = option.value === value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={chosen}
                                onClick={() => pick(option.value)}
                                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-xs max-md:min-h-touch ${
                                    chosen ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                                }`}
                            >
                                <Check aria-hidden className={`h-3.5 w-3.5 shrink-0 ${chosen ? '' : 'invisible'}`} />
                                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                                {option.count != null ? (
                                    <span className="shrink-0 tabular-nums text-gray-400">{option.count}</span>
                                ) : null}
                            </button>
                        );
                    })
                )}
            </div>
            {required ? null : (
                <div className="flex items-center justify-end border-t border-gray-100 px-3 py-2 text-xs">
                    <button
                        type="button"
                        onClick={() => pick(null)}
                        disabled={!value}
                        className="text-gray-500 hover:underline disabled:opacity-40 max-md:min-h-touch"
                    >
                        {copy.clear}
                    </button>
                </div>
            )}
        </div>
    );
}

/** The shortcuts a one-day chip can offer. */
export type DatePreset = 'today' | 'yesterday' | 'endOfLastMonth' | 'endOfLastQuarter' | 'endOfLastYear';

export const DEFAULT_DATE_PRESETS: readonly DatePreset[] = ['today', 'yesterday', 'endOfLastMonth', 'endOfLastYear'];

/** The day a preset names, on the workspace's calendar (`YYYY-MM-DD`). */
export function dateFromPreset(preset: DatePreset, now: Date = new Date()): string {
    const today = tenantDateOnly(now);
    const [year, month] = today.split('-').map(Number);
    switch (preset) {
        case 'today':
            return today;
        case 'yesterday':
            return addCalendarDays(today, -1);
        case 'endOfLastMonth':
            return addCalendarDays(`${today.slice(0, 8)}01`, -1);
        case 'endOfLastQuarter': {
            const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
            return addCalendarDays(`${year}-${String(quarterStart).padStart(2, '0')}-01`, -1);
        }
        case 'endOfLastYear':
            return `${year - 1}-12-31`;
    }
}

/** "6 Nov", or "31 Dec 2025" for a day outside this year — as a chip names its day. */
export function formatDateChip(ymd: string, now: Date = new Date()): string {
    const [year, month, day] = ymd.slice(0, 10).split('-').map(Number);
    if (!year || !month || !day) return ymd;
    const sameYear = tenantDateOnly(now).slice(0, 4) === String(year);
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        ...(sameYear ? {} : { year: 'numeric' }),
        timeZone: 'UTC',
    });
}

export interface DatePanelProps {
    label: string;
    value: string | null;
    onChange: (next: string | null) => void;
    presets?: readonly DatePreset[];
    /** The report must have a day: no Clear. */
    required?: boolean;
    /** Called once a choice is made — the popover around the panel closes on it. */
    onDone?: () => void;
    /** Injected in tests so "Today" is a known day. */
    now?: Date;
}

/**
 * One day — a report's as-of date: shortcuts, then any day picked, then
 * Clear (unless the filter is required) and Apply.
 */
export function DatePanel({ label, value, onChange, presets = DEFAULT_DATE_PRESETS, required = false, onDone, now }: DatePanelProps) {
    const { t } = useI18n();
    const copy = t.common.createdRange;
    const [date, setDate] = useState(value ?? '');
    const [error, setError] = useState(false);
    const inputId = useId();

    useEffect(() => {
        setDate(value ?? '');
        setError(false);
    }, [value]);

    const presetLabel: Record<DatePreset, string> = {
        today: copy.today,
        yesterday: copy.yesterday,
        endOfLastMonth: copy.endOfLastMonth,
        endOfLastQuarter: copy.endOfLastQuarter,
        endOfLastYear: copy.endOfLastYear,
    };

    const finish = (next: string | null) => {
        onChange(next);
        onDone?.();
    };

    const apply = () => {
        if (!date) {
            setError(true);
            return;
        }
        finish(date);
    };

    return (
        <div className="w-64 max-w-full space-y-3 p-3">
            <div className="grid grid-cols-2 gap-1.5">
                {presets.map((preset) => {
                    const day = dateFromPreset(preset, now);
                    return (
                        <Button
                            key={preset}
                            type="button"
                            variant={day === value ? 'primary' : 'secondary'}
                            size="sm"
                            aria-pressed={day === value}
                            onClick={() => finish(day)}
                        >
                            {presetLabel[preset]}
                        </Button>
                    );
                })}
            </div>
            <Field label={label} htmlFor={inputId} error={error ? copy.pickDate : undefined}>
                <Input
                    id={inputId}
                    type="date"
                    value={date}
                    error={error}
                    onChange={(event) => {
                        setDate(event.target.value);
                        setError(false);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            apply();
                        }
                    }}
                />
            </Field>
            <div className="flex items-center justify-end gap-2">
                {value && !required ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => finish(null)}>
                        {copy.clear}
                    </Button>
                ) : null}
                <Button type="button" size="sm" onClick={apply}>
                    {copy.apply}
                </Button>
            </div>
        </div>
    );
}

export interface NumberConditionPanelProps {
    label: string;
    value: NumberCondition | null;
    onChange: (next: NumberCondition | null) => void;
    /** Marks the inputs as money, with the taka sign in front. */
    money?: boolean;
    /** Called once a choice is made — the popover around the panel closes on it. */
    onDone?: () => void;
}

/** Reads typed text as a number: thousands separators and a currency sign are allowed. */
function readAmount(text: string): number | null {
    const cleaned = text.replace(/[,\s৳]/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    return Number(cleaned);
}

/**
 * An amount condition: between two amounts, greater than, less than or equal
 * to one. Applied on Apply (or Enter), not per keystroke — "1", "10", "100"
 * would each reload the list.
 */
export function NumberConditionPanel({ label, value, onChange, money = false, onDone }: NumberConditionPanelProps) {
    const { t } = useI18n();
    const copy = t.common.dataTable;
    const [op, setOp] = useState<NumberConditionOp>(value?.op ?? 'between');
    const [from, setFrom] = useState(value ? String(value.value) : '');
    const [to, setTo] = useState(value?.to !== undefined ? String(value.to) : '');
    const [error, setError] = useState(false);
    const opId = useId();

    useEffect(() => {
        setOp(value?.op ?? 'between');
        setFrom(value ? String(value.value) : '');
        setTo(value?.to !== undefined ? String(value.to) : '');
        setError(false);
    }, [value]);

    const apply = () => {
        const a = readAmount(from);
        const b = op === 'between' ? readAmount(to) : null;
        if (a === null || (op === 'between' && b === null)) {
            setError(true);
            return;
        }
        onChange(op === 'between' ? { op, value: Math.min(a, b!), to: Math.max(a, b!) } : { op, value: a });
        onDone?.();
    };

    const amountInput = (text: string, setText: (next: string) => void, name: string) => (
        <div className="relative min-w-0 flex-1">
            {money ? (
                <span aria-hidden className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                    ৳
                </span>
            ) : null}
            <Input
                type="text"
                inputMode="decimal"
                value={text}
                aria-label={`${label} (${name})`}
                placeholder={name}
                error={error && readAmount(text) === null}
                onChange={(event) => {
                    setText(event.target.value);
                    setError(false);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        apply();
                    }
                }}
                className={`w-full text-xs ${money ? 'ps-5' : ''}`}
            />
        </div>
    );

    return (
        <div className="w-64 max-w-full space-y-2 p-3">
            <Select
                id={opId}
                aria-label={label}
                value={op}
                onChange={(event) => {
                    setOp(event.target.value as NumberConditionOp);
                    setError(false);
                }}
                className="w-full text-xs"
            >
                {NUMBER_CONDITION_OPS.map((key) => (
                    <option key={key} value={key}>
                        {copy.numberOps[key]}
                    </option>
                ))}
            </Select>
            <div className="flex items-center gap-1.5">
                {amountInput(from, setFrom, op === 'between' ? copy.min : copy.amount)}
                {op === 'between' ? (
                    <>
                        <span className="text-xs text-gray-400">{copy.rangeTo}</span>
                        {amountInput(to, setTo, copy.max)}
                    </>
                ) : null}
            </div>
            {error ? (
                <p role="alert" className="text-xs text-danger">
                    {copy.enterAmount}
                </p>
            ) : null}
            <div className="flex items-center justify-between pt-1">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!value}
                    onClick={() => {
                        onChange(null);
                        onDone?.();
                    }}
                >
                    {copy.clear}
                </Button>
                <Button type="button" size="sm" onClick={apply}>
                    {copy.apply}
                </Button>
            </div>
        </div>
    );
}
