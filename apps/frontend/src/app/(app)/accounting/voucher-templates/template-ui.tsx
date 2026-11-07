'use client';

import { Plus, Trash2 } from 'lucide-react';
import AccountSelect, { type AccountOption } from '@/components/accounting/AccountSelect';
import { Button, Input } from '@/components/ui';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

/*
 * What the voucher-template pages — recurring vouchers, recurring journals and
 * voucher templates — share: the stored lines a template carries, and the
 * line editor its create form opens with.
 */

/** A template's line as the API returns it. */
export interface StoredTemplateLine {
    account?: { id?: string; name: string; code?: string | null } | null;
    debit_amount: number | string;
    credit_amount: number | string;
}

/** A line being typed into the create form. */
export interface TemplateLineDraft {
    accountId: string;
    debitAmount: string;
    creditAmount: string;
    comment: string;
}

export const emptyLine = (): TemplateLineDraft => ({ accountId: '', debitAmount: '', creditAmount: '', comment: '' });
export const emptyLines = (): TemplateLineDraft[] => [emptyLine(), emptyLine()];

/** What one run posts: the template's debits added up. */
export function templateAmount(lines: readonly StoredTemplateLine[] | null | undefined): number {
    return (lines ?? []).reduce((sum, line) => sum + Number(line.debit_amount || 0), 0);
}

/** The accounts a template touches, for the search box and the lines cell. */
export function templateAccountNames(lines: readonly StoredTemplateLine[] | null | undefined): string[] {
    return (lines ?? []).map((line) => line.account?.name).filter((name): name is string => Boolean(name));
}

/** The lines as the API takes them; rows with no account are left out. */
export function linePayload(lines: readonly TemplateLineDraft[]) {
    return lines
        .filter((line) => line.accountId)
        .map((line) => ({
            accountId: line.accountId,
            debitAmount: parseFloat(line.debitAmount) || 0,
            creditAmount: parseFloat(line.creditAmount) || 0,
            comment: line.comment || undefined,
        }));
}

export function lineTotals(lines: readonly TemplateLineDraft[]) {
    const debit = lines.reduce((sum, line) => sum + (parseFloat(line.debitAmount) || 0), 0);
    const credit = lines.reduce((sum, line) => sum + (parseFloat(line.creditAmount) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 };
}

/** The lines cell: each account with its side, in the order the template posts them. */
export function TemplateLinesCell({ lines }: { lines: readonly StoredTemplateLine[] }) {
    const { t, locale } = useI18n();
    if (!lines.length) return <span className="text-gray-400">—</span>;
    const text = lines
        .map((line) => {
            const debit = Number(line.debit_amount || 0);
            const side = debit > 0 ? t.accountingShared.debit : t.accountingShared.credit;
            const amount = debit > 0 ? debit : Number(line.credit_amount || 0);
            return `${line.account?.name ?? '—'} (${side} ${formatBDT(amount, { locale })})`;
        })
        .join(', ');
    return (
        <span className="block max-w-[26rem] truncate text-gray-600" title={text}>
            {text}
        </span>
    );
}

/**
 * The create form's line grid: an account and one side per row, at least
 * two rows. Typing a debit clears the credit on that row and the other way
 * round, so a row is never both.
 */
export function TemplateLinesEditor({
    accounts,
    lines,
    onChange,
    showBalance = true,
}: {
    accounts: AccountOption[];
    lines: TemplateLineDraft[];
    onChange: (next: TemplateLineDraft[]) => void;
    showBalance?: boolean;
}) {
    const { t, fmt, locale } = useI18n();
    const copy = t.accountingVouchersUi.common;
    const totals = lineTotals(lines);
    const setLine = (index: number, patch: Partial<TemplateLineDraft>) =>
        onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

    return (
        <div className="space-y-2">
            <div className="overflow-x-auto rounded-md border border-gray-200">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-gray-50 text-xs font-medium text-gray-500">
                            <th className="px-3 py-2 text-start">{t.accountingShared.account}</th>
                            <th className="w-32 px-3 py-2 text-end">{t.accountingShared.debit}</th>
                            <th className="w-32 px-3 py-2 text-end">{t.accountingShared.credit}</th>
                            <th className="w-10" />
                        </tr>
                    </thead>
                    <tbody>
                        {lines.map((line, i) => (
                            <tr key={i} className="border-t border-gray-100">
                                <td className="px-3 py-1.5">
                                    <AccountSelect
                                        accounts={accounts}
                                        value={line.accountId}
                                        onChange={(accountId) => setLine(i, { accountId })}
                                        ariaLabel={fmt(copy.accountLine, { line: i + 1 })}
                                        placeholder={t.accountingShared.selectAccountPlaceholder}
                                    />
                                </td>
                                <td className="px-3 py-1.5">
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        inputMode="decimal"
                                        aria-label={`${t.accountingShared.debit} ${i + 1}`}
                                        value={line.debitAmount}
                                        onChange={(e) => setLine(i, {
                                            debitAmount: e.target.value,
                                            ...(e.target.value ? { creditAmount: '' } : {}),
                                        })}
                                        className="w-full text-end"
                                        placeholder="0.00"
                                    />
                                </td>
                                <td className="px-3 py-1.5">
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        inputMode="decimal"
                                        aria-label={`${t.accountingShared.credit} ${i + 1}`}
                                        value={line.creditAmount}
                                        onChange={(e) => setLine(i, {
                                            creditAmount: e.target.value,
                                            ...(e.target.value ? { debitAmount: '' } : {}),
                                        })}
                                        className="w-full text-end"
                                        placeholder="0.00"
                                    />
                                </td>
                                <td className="px-1 py-1.5 text-center">
                                    {lines.length > 2 ? (
                                        <button
                                            type="button"
                                            onClick={() => onChange(lines.filter((_, idx) => idx !== i))}
                                            aria-label={`${t.common.remove} ${i + 1}`}
                                            title={t.common.remove}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 max-md:min-h-touch max-md:min-w-touch"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    ) : null}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => onChange([...lines, emptyLine()])}
                >
                    {t.recurringJournals.addLine}
                </Button>
                {showBalance ? (
                    <span className={`text-xs font-medium ${totals.balanced && totals.debit > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {totals.balanced && totals.debit > 0
                            ? `${t.accountingShared.balanced} — ${formatBDT(totals.debit, { locale })}`
                            : `${t.accountingShared.difference}: ${formatBDT(Math.abs(totals.debit - totals.credit), { locale })}`}
                    </span>
                ) : null}
            </div>
        </div>
    );
}
