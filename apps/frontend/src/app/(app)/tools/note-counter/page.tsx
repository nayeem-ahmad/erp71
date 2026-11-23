'use client';

import { useEffect, useState } from 'react';
import { Minus, Plus, Save, Trash2 } from 'lucide-react';
import { Alert, Button, Field, Input, PageHeader, PageShell } from '@/components/ui';
import { CopyButton } from '@/components/tools/calculators/shared';
import { api } from '@/lib/api';
import { BDT_NOTES, countNotes } from '@/lib/calculators/note-counter';
import { num, round2 } from '@/lib/calculators/money';
import { formatBDT, formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';

const DRAFT_KEY = 'erp71.tools.noteCount';

interface Draft {
    counts: Record<number, string>;
    coins: string;
    expected: string;
}

const EMPTY: Draft = { counts: {}, coins: '', expected: '' };

/**
 * Tools → Note counter. The count in progress is kept on this device, so a
 * reload in the middle of counting the drawer does not lose it.
 */
export default function NoteCounterPage() {
    const { t, fmt, locale } = useI18n();
    const m = t.tools.noteCounter;
    const [draft, setDraft] = useState<Draft>(EMPTY);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        try {
            const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? 'null');
            if (saved && typeof saved === 'object') setDraft({ ...EMPTY, ...saved });
        } catch {
            /* nothing saved, or storage unavailable */
        }
    }, []);

    const update = (next: Draft) => {
        setDraft(next);
        try {
            window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
        } catch {
            /* storage unavailable */
        }
    };
    const setCount = (denomination: number, value: string) => update({ ...draft, counts: { ...draft.counts, [denomination]: value } });
    const bump = (denomination: number, by: number) =>
        setCount(denomination, String(Math.max(0, Math.floor(num(draft.counts[denomination])) + by)));

    const counts = Object.fromEntries(BDT_NOTES.map((d) => [d, num(draft.counts[d])]));
    const result = countNotes(counts, num(draft.coins));
    const money = (value: number) => formatBDT(value, { locale });
    const hasExpected = draft.expected.trim() !== '';
    const difference = round2(result.total - num(draft.expected));

    const summary = [
        ...result.rows.filter((row) => row.count > 0).map((row) => `${row.denomination} × ${row.count} = ${money(row.amount)}`),
        ...(num(draft.coins) > 0 ? [`${m.coins}: ${money(num(draft.coins))}`] : []),
        `${m.total}: ${money(result.total)}`,
        ...(hasExpected
            ? [`${m.expected}: ${money(num(draft.expected))}`, difference === 0 ? m.matches : fmt(difference > 0 ? m.over : m.short, { amount: money(Math.abs(difference)) })]
            : []),
    ];

    const save = async () => {
        setSaving(true);
        try {
            await api.createNote({ title: fmt(m.noteTitle, { date: formatDateTime(new Date(), locale) }), content: summary.join('  \n') });
            toast.success(m.saved);
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.tools, m.title, 'tools')}
            />
            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-md border border-gray-200 bg-white">
                    <table className="w-full text-sm">
                        <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                            <tr>
                                <th className="px-3 py-2 text-start font-medium">{m.denomination}</th>
                                <th className="px-3 py-2 text-center font-medium">{m.count}</th>
                                <th className="px-3 py-2 text-end font-medium">{m.amount}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {result.rows.map((row) => (
                                <tr key={row.denomination}>
                                    <td className="px-3 py-1.5 font-medium tabular-nums text-gray-900">৳{row.denomination}</td>
                                    <td className="px-1 py-1.5">
                                        <div className="flex items-center justify-center gap-1">
                                            <button type="button" onClick={() => bump(row.denomination, -1)} className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 md:min-h-8 md:min-w-8" aria-label={`− ৳${row.denomination}`}>
                                                <Minus className="h-4 w-4" aria-hidden />
                                            </button>
                                            <Input
                                                type="number"
                                                inputMode="numeric"
                                                min="0"
                                                step="1"
                                                value={draft.counts[row.denomination] ?? ''}
                                                onChange={(e) => setCount(row.denomination, e.target.value)}
                                                aria-label={`${m.count} ৳${row.denomination}`}
                                                className="w-16 text-center tabular-nums"
                                            />
                                            <button type="button" onClick={() => bump(row.denomination, 1)} className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 md:min-h-8 md:min-w-8" aria-label={`+ ৳${row.denomination}`}>
                                                <Plus className="h-4 w-4" aria-hidden />
                                            </button>
                                        </div>
                                    </td>
                                    <td className="px-3 py-1.5 text-end tabular-nums text-gray-700">{row.count ? money(row.amount) : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="border-t border-gray-100 p-3">
                        <Field label={m.coins} htmlFor="note-coins">
                            <Input id="note-coins" type="number" inputMode="decimal" min="0" value={draft.coins} onChange={(e) => update({ ...draft, coins: e.target.value })} className="w-full" />
                        </Field>
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="rounded-md border border-gray-200 bg-white p-4">
                        <p className="text-xs text-gray-500">
                            {m.total} · {fmt(m.pieces, { count: result.pieces })}
                        </p>
                        <p className="text-3xl font-semibold tabular-nums text-gray-900">{money(result.total)}</p>
                    </div>
                    <div className="rounded-md border border-gray-200 bg-white p-3">
                        <Field label={m.expected} hint={m.expectedHint} htmlFor="note-expected">
                            <Input id="note-expected" type="number" inputMode="decimal" min="0" value={draft.expected} onChange={(e) => update({ ...draft, expected: e.target.value })} className="w-full" />
                        </Field>
                        {hasExpected && (
                            <Alert tone={difference === 0 ? 'success' : difference > 0 ? 'warning' : 'danger'} className="mt-3">
                                {difference === 0 ? m.matches : fmt(difference > 0 ? m.over : m.short, { amount: money(Math.abs(difference)) })}
                            </Alert>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button onClick={() => void save()} disabled={result.total === 0 || saving} loading={saving}>
                            <Save className="h-4 w-4" aria-hidden /> {m.saveToNotes}
                        </Button>
                        <CopyButton text={result.total > 0 ? summary.join('\n') : ''} label={m.copySummary} copied={m.copied} failed={m.copyFailed} />
                        <Button variant="secondary" onClick={() => update(EMPTY)}>
                            <Trash2 className="h-4 w-4" aria-hidden /> {m.clear}
                        </Button>
                    </div>
                </div>
            </div>
        </PageShell>
    );
}
