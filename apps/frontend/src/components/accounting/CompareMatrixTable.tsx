'use client';

import { Fragment } from 'react';
import { CompactSection } from '@/components/accounting/compact';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';

export type CompareColumn = {
    key: string;
    label: string;
    type?: string;
};

export type CompareAmounts = Record<string, number>;

export type CompareMatrixAccount = {
    id?: string;
    name: string;
    code?: string | null;
};

export type CompareMatrixRow = {
    account: CompareMatrixAccount;
    amounts: CompareAmounts;
};

export type CompareMatrixGroup = {
    name: string;
    rows: CompareMatrixRow[];
    subtotals?: CompareAmounts;
};

export type CompareMatrixSection = {
    name: string;
    groups: CompareMatrixGroup[];
    subtotals?: CompareAmounts;
};

export type CompareTrialBalanceRow = {
    account: CompareMatrixAccount & { type?: string; group?: { name: string } };
    debit_amounts: CompareAmounts;
    credit_amounts: CompareAmounts;
};

export type CompareFooterRow = {
    label: string;
    amounts: CompareAmounts;
    emphasis?: 'default' | 'profit' | 'total';
};

type CompareMatrixTableProps = {
    columns: CompareColumn[];
    variant?: 'sections' | 'trialBalance';
    sections?: CompareMatrixSection[];
    trialBalanceRows?: CompareTrialBalanceRow[];
    totals?: { debit?: CompareAmounts; credit?: CompareAmounts };
    footerRows?: CompareFooterRow[];
};

const thClass = `text-right px-3 py-2 ${compactDensity.formLabel} whitespace-nowrap sticky top-0 bg-gray-50 z-10`;
const thLeftClass = `text-left px-3 py-2 ${compactDensity.formLabel} whitespace-nowrap sticky top-0 left-0 bg-gray-50 z-20`;

function AmountCell({ value, locale }: { value: number; locale: string }) {
    if (!value) {
        return <span className="text-gray-300">—</span>;
    }
    return <span>{formatBDT(value, { locale })}</span>;
}

function footerClass(emphasis?: CompareFooterRow['emphasis']) {
    if (emphasis === 'profit') {
        return 'bg-blue-50 text-blue-800 font-semibold';
    }
    if (emphasis === 'total') {
        return 'bg-gray-900 text-white font-semibold';
    }
    return 'bg-gray-50 font-semibold text-gray-800';
}

export function CompareMatrixTable({
    columns,
    variant = 'sections',
    sections = [],
    trialBalanceRows = [],
    totals,
    footerRows = [],
}: CompareMatrixTableProps) {
    const { locale } = useI18n();

    if (variant === 'trialBalance') {
        return (
            <CompactSection className="p-0 overflow-x-auto">
                <table className="w-full text-sm min-w-max">
                    <thead>
                        <tr className="border-b border-gray-100">
                            <th className={thLeftClass}>Account</th>
                            {columns.map((column) => (
                                <th key={`${column.key}-debit`} className={thClass}>
                                    {column.label} (Dr)
                                </th>
                            ))}
                            {columns.map((column) => (
                                <th key={`${column.key}-credit`} className={thClass}>
                                    {column.label} (Cr)
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {trialBalanceRows.map((row) => (
                            <tr key={row.account.id ?? row.account.name} className="border-b border-gray-50 hover:bg-gray-50/50">
                                <td className="px-3 py-2 sticky left-0 bg-white">
                                    <span className="font-medium text-gray-800">{row.account.name}</span>
                                    {row.account.code ? (
                                        <span className="ml-2 text-xs text-gray-400">{row.account.code}</span>
                                    ) : null}
                                    {row.account.group?.name ? (
                                        <div className="text-xs text-gray-400">{row.account.group.name}</div>
                                    ) : null}
                                </td>
                                {columns.map((column) => (
                                    <td key={`${row.account.id}-dr-${column.key}`} className="px-3 py-2 text-right text-gray-700">
                                        <AmountCell value={row.debit_amounts[column.key] ?? 0} locale={locale} />
                                    </td>
                                ))}
                                {columns.map((column) => (
                                    <td key={`${row.account.id}-cr-${column.key}`} className="px-3 py-2 text-right text-gray-700">
                                        <AmountCell value={row.credit_amounts[column.key] ?? 0} locale={locale} />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                    {totals?.debit || totals?.credit ? (
                        <tfoot>
                            <tr className="bg-gray-50 font-semibold border-t border-gray-200">
                                <td className="px-3 py-2 text-xs sticky left-0 bg-gray-50">Grand Totals (Dr)</td>
                                {columns.map((column) => (
                                    <td key={`total-dr-${column.key}`} className="px-3 py-2 text-right text-gray-900">
                                        <AmountCell value={totals.debit?.[column.key] ?? 0} locale={locale} />
                                    </td>
                                ))}
                                <td className="px-3 py-2" colSpan={columns.length} />
                            </tr>
                            <tr className="bg-gray-50 font-semibold">
                                <td className="px-3 py-2 text-xs sticky left-0 bg-gray-50">Grand Totals (Cr)</td>
                                <td className="px-3 py-2" colSpan={columns.length} />
                                {columns.map((column) => (
                                    <td key={`total-cr-${column.key}`} className="px-3 py-2 text-right text-gray-900">
                                        <AmountCell value={totals.credit?.[column.key] ?? 0} locale={locale} />
                                    </td>
                                ))}
                            </tr>
                        </tfoot>
                    ) : null}
                </table>
            </CompactSection>
        );
    }

    return (
        <CompactSection className="p-0 overflow-x-auto space-y-0">
            <table className="w-full text-sm min-w-max">
                <thead>
                    <tr className="border-b border-gray-100">
                        <th className={thLeftClass}>Account</th>
                        {columns.map((column) => (
                            <th key={column.key} className={thClass}>
                                {column.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {sections.map((section) => (
                        <Fragment key={`section-${section.name}`}>
                            <tr className="bg-gray-100">
                                <td colSpan={columns.length + 1} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                                    {section.name}
                                </td>
                            </tr>
                            {section.groups.map((group) => (
                                <Fragment key={`group-${section.name}-${group.name}`}>
                                    <tr className="bg-gray-50">
                                        <td className="px-3 py-1.5 font-semibold text-gray-700 sticky left-0 bg-gray-50">{group.name}</td>
                                        {columns.map((column) => (
                                            <td key={`${group.name}-${column.key}`} className="px-3 py-1.5 text-right font-semibold text-gray-700">
                                                <AmountCell value={group.subtotals?.[column.key] ?? 0} locale={locale} />
                                            </td>
                                        ))}
                                    </tr>
                                    {group.rows.map((row) => (
                                        <tr key={row.account.id ?? `${group.name}-${row.account.name}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                                            <td className="px-5 py-1 text-gray-600 sticky left-0 bg-white">
                                                {row.account.name}
                                                {row.account.code ? (
                                                    <span className="ml-2 text-xs text-gray-400">{row.account.code}</span>
                                                ) : null}
                                            </td>
                                            {columns.map((column) => (
                                                <td key={`${row.account.id}-${column.key}`} className="px-3 py-1 text-right text-gray-700">
                                                    <AmountCell value={row.amounts[column.key] ?? 0} locale={locale} />
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </Fragment>
                            ))}
                            {section.subtotals ? (
                                <tr className="bg-gray-50 font-semibold border-t border-gray-200">
                                    <td className="px-3 py-2 text-gray-800 sticky left-0 bg-gray-50">Total {section.name}</td>
                                    {columns.map((column) => (
                                        <td key={`section-total-${section.name}-${column.key}`} className="px-3 py-2 text-right text-gray-900">
                                            <AmountCell value={section.subtotals?.[column.key] ?? 0} locale={locale} />
                                        </td>
                                    ))}
                                </tr>
                            ) : null}
                        </Fragment>
                    ))}
                    {footerRows.map((row) => (
                        <tr key={row.label} className={footerClass(row.emphasis)}>
                            <td className="px-3 py-2 sticky left-0 bg-inherit">{row.label}</td>
                            {columns.map((column) => (
                                <td key={`${row.label}-${column.key}`} className="px-3 py-2 text-right">
                                    <AmountCell value={row.amounts[column.key] ?? 0} locale={locale} />
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </CompactSection>
    );
}

export default CompareMatrixTable;