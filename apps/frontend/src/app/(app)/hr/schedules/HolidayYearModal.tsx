'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Copy, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import { Alert, Button, Checkbox, Field, FormFooter, Select } from '@/components/ui';
import ModalShell, { ModalHeader } from '@/components/ModalShell';

/**
 * Whole-year holiday management.
 *
 * The per-date form is fine for adding Eid once the date is announced; it is
 * the wrong tool for setting up a new year, which is thirty-odd rows the tenant
 * mostly already had last year. Three ways in: the fixed-date national
 * holidays, a copy of another year, and a way back out again.
 */

interface Suggestion { date: string; name: string; exists: boolean; }

type Mode = 'suggested' | 'copy' | 'clear';

interface Props {
    year: number;
    /** How many holidays the year already has — drives the clear tab. */
    holidayCount: number;
    onClose: () => void;
    /** Called after anything changed, so the page can reload the list. */
    onApplied: () => void | Promise<void>;
}

const fill = (template: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
        template,
    );

export default function HolidayYearModal({ year, holidayCount, onClose, onApplied }: Props) {
    const { t } = useI18n();
    const copy = t.workSchedules.holidays.year;
    const toast = useToastStore((state) => state.show);

    const [mode, setMode] = useState<Mode>('suggested');
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [sourceYear, setSourceYear] = useState(year - 1);
    const [overwrite, setOverwrite] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let live = true;
        setError('');
        api.getHolidaySuggestions(year)
            .then((rows: Suggestion[]) => {
                if (!live) return;
                setSuggestions(rows ?? []);
                // Pre-tick everything the year is missing: the common case is
                // "yes, all of them", and a list of empty boxes reads as work.
                setSelected((rows ?? []).filter((row) => !row.exists).map((row) => row.date));
            })
            .catch((err: any) => { if (live) setError(err?.message || copy.suggestFailed); });
        return () => { live = false; };
    }, [year, copy.suggestFailed]);

    const toggle = (date: string) => {
        setSelected((prev) => (prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]));
    };

    /** Report what actually happened — "saved" hides a batch that changed nothing. */
    const reportBatch = useCallback((result: { created: number; updated: number; skipped: number; unmapped?: number }) => {
        if (!result.created && !result.updated) {
            toast('info', copy.nothingChanged);
        } else {
            toast('success', fill(copy.summary, {
                created: result.created, updated: result.updated, skipped: result.skipped,
            }));
        }
        if (result.unmapped) toast('info', fill(copy.unmapped, { count: result.unmapped }));
    }, [toast, copy.summary, copy.nothingChanged, copy.unmapped]);

    const run = async (action: () => Promise<void>) => {
        setError('');
        setBusy(true);
        try {
            await action();
            await onApplied();
            onClose();
        } catch (err: any) {
            setError(err?.message || copy.failed);
        } finally {
            setBusy(false);
        }
    };

    const addSuggested = () => run(async () => {
        const items = suggestions
            .filter((row) => selected.includes(row.date))
            .map((row) => ({ date: row.date, name: row.name }));
        reportBatch(await api.bulkCreateHolidays({ items }));
    });

    const copyYear = () => run(async () => {
        reportBatch(await api.copyHolidayYear({ from_year: sourceYear, to_year: year, overwrite }));
    });

    const clearYear = () => run(async () => {
        const result = await api.clearHolidayYear(year);
        toast('success', fill(copy.cleared, { count: result?.deleted ?? holidayCount }));
    });

    const missing = suggestions.filter((row) => !row.exists);
    const sourceYears = [year - 3, year - 2, year - 1, year + 1].filter((option) => option >= 2000);

    return (
        <ModalShell size="md" onBackdropClick={busy ? () => {} : onClose}>
            <ModalHeader title={fill(copy.title, { year })} onClose={onClose} />

            <div className="space-y-3 p-4">
                {error && <Alert tone="danger">{error}</Alert>}

                <div className="flex gap-1 border-b border-gray-200">
                    {([
                        ['suggested', copy.tabs.suggested, CalendarPlus],
                        ['copy', copy.tabs.copy, Copy],
                        ['clear', copy.tabs.clear, Trash2],
                    ] as const).map(([key, label, Icon]) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => { setMode(key); setError(''); }}
                            className={`flex min-h-touch items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                                mode === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'
                            }`}
                        >
                            <Icon className="h-4 w-4" />
                            {label}
                        </button>
                    ))}
                </div>

                {mode === 'suggested' && (
                    <div className="space-y-3">
                        <p className="text-xs text-gray-500">{copy.suggestHint}</p>

                        {missing.length === 0 && suggestions.length > 0 ? (
                            <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-500">
                                {fill(copy.suggestEmpty, { year })}
                            </p>
                        ) : (
                            <>
                                <div className="flex justify-end">
                                    <Button
                                        variant="ghost"
                                        onClick={() => setSelected(
                                            selected.length === missing.length ? [] : missing.map((row) => row.date),
                                        )}
                                    >
                                        {selected.length === missing.length ? copy.selectNone : copy.selectAll}
                                    </Button>
                                </div>
                                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                                    {suggestions.map((row) => (
                                        <li key={row.date} className="flex items-center gap-3 p-2">
                                            <Checkbox
                                                id={`suggest-${row.date}`}
                                                checked={row.exists || selected.includes(row.date)}
                                                disabled={row.exists || busy}
                                                onChange={() => toggle(row.date)}
                                            />
                                            <label htmlFor={`suggest-${row.date}`} className="min-w-0 flex-1 text-sm">
                                                <span className="font-medium text-gray-900">{row.name}</span>
                                                <span className="ml-2 text-xs text-gray-500">{formatDate(row.date)}</span>
                                            </label>
                                            {row.exists && (
                                                <span className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-500">
                                                    {copy.alreadySet}
                                                </span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                                <FormFooter>
                                    <Button onClick={addSuggested} loading={busy} disabled={selected.length === 0}>
                                        {fill(copy.addSelected, { count: selected.length })}
                                    </Button>
                                </FormFooter>
                            </>
                        )}
                    </div>
                )}

                {mode === 'copy' && (
                    <div className="space-y-3">
                        <p className="text-xs text-gray-500">{copy.copyHint}</p>

                        <Field label={copy.copyFrom} htmlFor="holiday-copy-from">
                            <Select
                                id="holiday-copy-from"
                                value={String(sourceYear)}
                                onChange={(e) => setSourceYear(Number(e.target.value))}
                            >
                                {sourceYears.map((option) => (
                                    <option key={option} value={option}>{option}</option>
                                ))}
                            </Select>
                        </Field>

                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <Checkbox checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                            {copy.overwrite}
                        </label>

                        <FormFooter>
                            <Button onClick={copyYear} loading={busy}>
                                {fill(copy.copyApply, { from: sourceYear, year })}
                            </Button>
                        </FormFooter>
                    </div>
                )}

                {mode === 'clear' && (
                    <div className="space-y-3">
                        {holidayCount === 0 ? (
                            <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-500">
                                {fill(copy.clearEmpty, { year })}
                            </p>
                        ) : (
                            <>
                                <Alert tone="warning">{fill(copy.clearHint, { count: holidayCount, year })}</Alert>
                                <FormFooter>
                                    <Button
                                        variant="danger"
                                        loading={busy}
                                        onClick={() => {
                                            if (!window.confirm(fill(copy.clearConfirm, { count: holidayCount, year }))) return;
                                            clearYear();
                                        }}
                                    >
                                        {fill(copy.clearApply, { year })}
                                    </Button>
                                </FormFooter>
                            </>
                        )}
                    </div>
                )}
            </div>
        </ModalShell>
    );
}
