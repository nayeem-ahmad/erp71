'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import {
    createdRangeFromPreset,
    formatCreatedRangeLabel,
    isCreatedRangeEmpty,
    type CreatedRange,
    type CreatedRangePreset,
} from '@/lib/created-range';

type CreatedRangeFilterProps = {
    value: CreatedRange | null;
    onChange: (next: CreatedRange | null) => void;
    /** Injected in tests so "Today" is a known Dhaka day. */
    now?: Date;
    /**
     * Which date field this filters, for the chip and the popover. Defaults to
     * "Created"; a list filtering two different dates must name both.
     */
    label?: string;
};

const PRESETS: CreatedRangePreset[] = ['today', 'yesterday', 'last7', 'thisMonth'];

export default function CreatedRangeFilter({ value, onChange, now, label }: CreatedRangeFilterProps) {
    const { t } = useI18n();
    const copy = t.common.createdRange;
    const [open, setOpen] = useState(false);
    const [from, setFrom] = useState(value?.from ?? '');
    const [to, setTo] = useState(value?.to ?? '');
    const rootRef = useRef<HTMLDivElement>(null);
    const fromId = useId();
    const toId = useId();

    useEffect(() => {
        setFrom(value?.from ?? '');
        setTo(value?.to ?? '');
    }, [value]);

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
        thisMonth: copy.thisMonth,
    };

    const fieldLabel = label ?? t.common.createdAt;
    const chip = `${fieldLabel} · ${formatCreatedRangeLabel(value, copy.anyTime)}`;

    const applyPreset = (preset: CreatedRangePreset) => {
        onChange(createdRangeFromPreset(preset, now));
        setOpen(false);
    };

    const applyCustom = () => {
        if (!from && !to) {
            onChange(null);
        } else {
            onChange({ from: from || undefined, to: to || undefined });
        }
        setOpen(false);
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
                    className="absolute z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg space-y-3"
                >
                    <div className="grid grid-cols-2 gap-1.5">
                        {PRESETS.map((preset) => (
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
                        <div>
                            <label htmlFor={fromId} className="block text-xs font-medium text-gray-600 mb-1">
                                {t.common.from}
                            </label>
                            <Input
                                id={fromId}
                                type="date"
                                value={from}
                                onChange={(e) => setFrom(e.target.value)}
                            />
                        </div>
                        <div>
                            <label htmlFor={toId} className="block text-xs font-medium text-gray-600 mb-1">
                                {t.common.to}
                            </label>
                            <Input
                                id={toId}
                                type="date"
                                value={to}
                                onChange={(e) => setTo(e.target.value)}
                            />
                        </div>
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
