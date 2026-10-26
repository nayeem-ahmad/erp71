'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { formatMessage, useI18n } from '@/lib/i18n';
import { NUMBER_CONDITION_OPS, type NumberCondition, type NumberConditionOp } from '@/lib/number-condition';

export interface ListFilterOption {
    value: string;
    label: string;
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
}: MultiSelectPanelProps) {
    const { t } = useI18n();
    const copy = t.common.dataTable;
    const [query, setQuery] = useState('');
    const [fetched, setFetched] = useState<readonly ListFilterOption[] | null>(null);
    const [loading, setLoading] = useState(false);
    const trimmed = query.trim();
    const showSearch = Boolean(loadOptions) || (searchable ?? options.length > SEARCH_THRESHOLD);
    const selected = useMemo(() => new Set(value), [value]);

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

    const shown = useMemo(() => {
        if (trimmed) {
            if (loadOptions) return fetched ?? [];
            const needle = trimmed.toLowerCase();
            return options.filter((option) => option.label.toLowerCase().includes(needle));
        }
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
            {showSearch ? (
                <div className="p-2 pb-0">
                    <div className="relative">
                        <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                        <Input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={formatMessage(copy.searchOptions, { label })}
                            aria-label={formatMessage(copy.searchOptions, { label })}
                            className="w-full ps-7 text-xs"
                            autoFocus
                        />
                    </div>
                </div>
            ) : null}
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
                            <span className="truncate">{option.label}</span>
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
                <button
                    type="button"
                    onClick={() => onChange([])}
                    disabled={value.length === 0}
                    className="text-gray-500 hover:underline disabled:opacity-40 max-md:min-h-touch"
                >
                    {copy.clear}
                </button>
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
