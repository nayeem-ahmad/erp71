'use client';

import { useRef, useState } from 'react';
import { Save, Trash2, X } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { runTape, tapeToMarkdown, type TapeLine, type TapeOp } from '@/lib/calculators/tape';
import { fromBanglaDigits } from '@/lib/bangla-words';
import { formatBDT, formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';

/** "-50", "*2", "/4", "x3" → an operator and a number. A bare number adds. */
export function parseTapeEntry(raw: string): { op: TapeOp; value: number } | null {
    const text = fromBanglaDigits(raw).replace(/,/g, '').trim();
    const match = /^([+\-*/x×÷])?\s*(\d+(?:\.\d+)?|\.\d+)$/i.exec(text);
    if (!match) return null;
    const sign = match[1];
    const op: TapeOp = sign === '-' ? '-' : sign === '*' || sign === 'x' || sign === 'X' || sign === '×' ? '×' : sign === '/' || sign === '÷' ? '÷' : '+';
    return { op, value: Number(match[2]) };
}

let nextId = 0;

/**
 * The adding-machine tape: type, Enter, type, Enter, with every line kept so
 * a mistake three lines up can be seen and removed. Kept in the page only;
 * Save to Notes keeps it for good.
 */
export function TapeCalculator() {
    const { t, locale, fmt } = useI18n();
    const m = t.tools.calculators.tape;
    const inputRef = useRef<HTMLInputElement>(null);
    const [lines, setLines] = useState<TapeLine[]>([]);
    const [entry, setEntry] = useState('');
    const [label, setLabel] = useState('');
    const [saving, setSaving] = useState(false);

    const { totals, total } = runTape(lines);
    const money = (value: number) => formatBDT(value, { locale });

    const add = () => {
        const parsed = parseTapeEntry(entry);
        if (!parsed) return;
        setLines((current) => [...current, { id: String(++nextId), ...parsed, label: label.trim() }]);
        setEntry('');
        setLabel('');
        inputRef.current?.focus();
    };

    const save = async () => {
        setSaving(true);
        try {
            const date = formatDateTime(new Date(), locale);
            await api.createNote({
                title: fmt(m.noteTitle, { date }),
                content: tapeToMarkdown(lines, { item: m.item, amount: m.amount, total: t.tools.calculators.common.total }, money),
            });
            toast.success(m.saved);
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-3">
            <p className="text-xs text-gray-500">{m.hint}</p>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    add();
                }}
                className="flex flex-col gap-2 sm:flex-row"
            >
                <Input
                    ref={inputRef}
                    value={entry}
                    onChange={(e) => setEntry(e.target.value)}
                    placeholder={m.amount}
                    aria-label={m.amount}
                    inputMode="decimal"
                    autoComplete="off"
                    className="min-h-touch text-base sm:w-48"
                />
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={m.label} aria-label={m.label} maxLength={80} className="min-h-touch flex-1" />
                <Button type="submit" size="md" disabled={!parseTapeEntry(entry)}>
                    {m.add}
                </Button>
            </form>

            <div className="rounded-md border border-gray-200 bg-white font-mono">
                {lines.length === 0 ? (
                    <p className="px-3 py-6 text-center font-sans text-sm text-gray-500">{m.empty}</p>
                ) : (
                    <ol className="divide-y divide-dashed divide-gray-200">
                        {lines.map((line, index) => (
                            <li key={line.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                                <span className="w-4 text-gray-400">{line.op}</span>
                                <span className="flex-1 truncate font-sans text-gray-500">{line.label}</span>
                                <span className="tabular-nums text-gray-900">{money(line.value)}</span>
                                <span className="hidden w-32 text-end tabular-nums text-gray-400 sm:inline">{money(totals[index])}</span>
                                <button
                                    type="button"
                                    onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}
                                    className="inline-flex min-h-touch min-w-touch items-center justify-center text-gray-400 hover:text-red-600 md:min-h-0 md:min-w-0"
                                    aria-label={m.remove}
                                    title={m.remove}
                                >
                                    <X className="h-4 w-4" aria-hidden />
                                </button>
                            </li>
                        ))}
                    </ol>
                )}
                <div className="flex items-center justify-between border-t-2 border-gray-900 px-3 py-2">
                    <span className="font-sans text-sm font-medium text-gray-900">{t.tools.calculators.common.total}</span>
                    <span className="text-lg font-semibold tabular-nums text-gray-900">{money(total)}</span>
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                <Button onClick={() => void save()} disabled={lines.length === 0 || saving} loading={saving}>
                    <Save className="h-4 w-4" aria-hidden /> {m.saveToNotes}
                </Button>
                <Button variant="secondary" onClick={() => setLines([])} disabled={lines.length === 0}>
                    <Trash2 className="h-4 w-4" aria-hidden /> {m.clear}
                </Button>
            </div>
        </div>
    );
}
