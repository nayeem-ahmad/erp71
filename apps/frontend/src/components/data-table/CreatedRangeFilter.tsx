'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import {
    createdRangeFromPreset,
    formatCreatedRangeLabel,
    isCreatedRangeEmpty,
    joinRangeBound,
    splitRangeBound,
    type CreatedRange,
    type CreatedRangePreset,
} from '@/lib/created-range';

type CreatedRangeFilterProps = {
    value: CreatedRange | null;
    /** A preset choice also names the preset, for a list that keeps "last 7 days" rolling. */
    onChange: (next: CreatedRange | null, preset?: CreatedRangePreset) => void;
    /** Injected in tests so "Today" is a known Dhaka day. */
    now?: Date;
    /**
     * Which date field this filters, for the chip and the popover. Defaults to
     * "Created"; a list filtering two different dates must name both.
     */
    label?: string;
    /**
     * Offers an optional time under each date, for a column that carries one
     * (a sale's `sale_date`) — a night shift runs past midnight. Bounds then
     * read `YYYY-MM-DDTHH:mm`; a bound left without a time is still the whole day.
     */
    withTime?: boolean;
    /** The shortcuts offered above the dates. */
    presets?: readonly CreatedRangePreset[];
};

const DEFAULT_PRESETS: readonly CreatedRangePreset[] = ['today', 'yesterday', 'last7', 'thisMonth'];

/** Must match the popover's `w-64`. */
const PANEL_WIDTH = 256;
const VIEWPORT_MARGIN = 8;

/** SSR has no layout to measure, and useLayoutEffect warns there. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function CreatedRangeFilter({
    value,
    onChange,
    now,
    label,
    withTime = false,
    presets = DEFAULT_PRESETS,
}: CreatedRangeFilterProps) {
    const { t } = useI18n();
    const copy = t.common.createdRange;
    const [open, setOpen] = useState(false);
    const [fromDate, setFromDate] = useState(() => splitRangeBound(value?.from).date);
    const [fromTime, setFromTime] = useState(() => splitRangeBound(value?.from).time);
    const [toDate, setToDate] = useState(() => splitRangeBound(value?.to).date);
    const [toTime, setToTime] = useState(() => splitRangeBound(value?.to).time);
    const [rangeError, setRangeError] = useState<string | null>(null);
    const [alignEnd, setAlignEnd] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const fromId = useId();
    const toId = useId();

    useEffect(() => {
        const start = splitRangeBound(value?.from);
        const end = splitRangeBound(value?.to);
        setFromDate(start.date);
        setFromTime(start.time);
        setToDate(end.date);
        setToTime(end.time);
        setRangeError(null);
    }, [value]);

    /* The trigger is the last chip in a wrapping filter bar, so it usually sits
       at the right edge — a start-anchored panel would run off screen. Measure on
       open and flip it to hang off the other edge when it does not fit. */
    useIsomorphicLayoutEffect(() => {
        if (!open) return;
        const root = rootRef.current;
        if (!root) return;
        const rect = root.getBoundingClientRect();
        const rtl = getComputedStyle(root).direction === 'rtl';
        setAlignEnd(
            rtl
                ? rect.right - PANEL_WIDTH < VIEWPORT_MARGIN
                : rect.left + PANEL_WIDTH > window.innerWidth - VIEWPORT_MARGIN,
        );
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onPointer = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onPointer);
        return () => document.removeEventListener('mousedown', onPointer);
    }, [open]);

    const presetLabel: Record<CreatedRangePreset, string> = {
        today: copy.today,
        yesterday: copy.yesterday,
        last7: copy.last7Days,
        last30: copy.last30Days,
        thisMonth: copy.thisMonth,
    };

    const fieldLabel = label ?? t.common.createdAt;
    const chip = `${fieldLabel} · ${formatCreatedRangeLabel(value, copy.anyTime)}`;

    const applyPreset = (preset: CreatedRangePreset) => {
        onChange(createdRangeFromPreset(preset, now), preset);
        setOpen(false);
    };

    const applyCustom = () => {
        const nextFrom = joinRangeBound(fromDate, withTime ? fromTime : '');
        const nextTo = joinRangeBound(toDate, withTime ? toTime : '');
        if (!nextFrom && !nextTo) {
            onChange(null);
            setOpen(false);
            return;
        }
        // Compared as text: `YYYY-MM-DDTHH:mm` sorts the way time runs. A bound
        // without a time stands for its whole day, so it opens at 00:00 and
        // closes at 23:59.
        if (nextFrom && nextTo) {
            const start = `${fromDate}T${(withTime && fromTime) || '00:00'}`;
            const end = `${toDate}T${(withTime && toTime) || '23:59'}`;
            if (start > end) {
                setRangeError(copy.fromAfterTo);
                return;
            }
        }
        onChange({ from: nextFrom, to: nextTo });
        setOpen(false);
    };

    const edit = (setter: (next: string) => void) => (event: { target: { value: string } }) => {
        setter(event.target.value);
        setRangeError(null);
    };

    return (
        <div ref={rootRef} className="relative">
            <Button
                type="button"
                variant="secondary"
                aria-expanded={open}
                aria-haspopup="dialog"
                onClick={() => setOpen((v) => !v)}
                icon={<Calendar className="w-4 h-4" />}
            >
                {chip}
            </Button>
            {open ? (
                <div
                    role="dialog"
                    aria-label={fieldLabel}
                    className={`absolute z-50 mt-1 w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white p-3 shadow-lg space-y-3 ${
                        alignEnd ? 'end-0' : 'start-0'
                    }`}
                >
                    <div className="grid grid-cols-2 gap-1.5">
                        {presets.map((preset) => (
                            <Button
                                key={preset}
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => applyPreset(preset)}
                            >
                                {presetLabel[preset]}
                            </Button>
                        ))}
                    </div>
                    <div className="space-y-2">
                        <Field label={t.common.from} htmlFor={fromId}>
                            <Input id={fromId} type="date" value={fromDate} onChange={edit(setFromDate)} />
                            {withTime ? (
                                <Input
                                    type="time"
                                    aria-label={`${t.common.from} (${copy.time})`}
                                    value={fromTime}
                                    disabled={!fromDate}
                                    onChange={edit(setFromTime)}
                                    className="mt-1.5"
                                />
                            ) : null}
                        </Field>
                        <Field label={t.common.to} htmlFor={toId} error={rangeError ?? undefined}>
                            <Input id={toId} type="date" value={toDate} error={Boolean(rangeError)} onChange={edit(setToDate)} />
                            {withTime ? (
                                <Input
                                    type="time"
                                    aria-label={`${t.common.to} (${copy.time})`}
                                    value={toTime}
                                    disabled={!toDate}
                                    onChange={edit(setToTime)}
                                    className="mt-1.5"
                                />
                            ) : null}
                        </Field>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                        {!isCreatedRangeEmpty(value) ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    onChange(null);
                                    setOpen(false);
                                }}
                            >
                                {copy.clear}
                            </Button>
                        ) : null}
                        <Button type="button" size="sm" onClick={applyCustom}>
                            {copy.apply}
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
