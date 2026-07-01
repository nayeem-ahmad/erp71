"use client";

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, CircleCheck, Plus, Trash2 } from 'lucide-react';
import { AccountCategory, VoucherType } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

type VoucherAccount = {
    id: string;
    name: string;
    code?: string | null;
    category: AccountCategory;
    type: string;
    group?: { name: string };
};

type VoucherRow = {
    id: string;
    accountId: string;
    debitAmount: string;
    creditAmount: string;
    comment: string;
};

type VoucherSummary = {
    id: string;
    voucherNumber: string;
};

const voucherTypeOptions = [
    { value: VoucherType.CASH_PAYMENT, label: 'Cash Payment' },
    { value: VoucherType.CASH_RECEIVE, label: 'Cash Receive' },
    { value: VoucherType.BANK_PAYMENT, label: 'Bank Payment' },
    { value: VoucherType.BANK_RECEIVE, label: 'Bank Receive' },
    { value: VoucherType.FUND_TRANSFER, label: 'Fund Transfer' },
    { value: VoucherType.JOURNAL, label: 'Journal Voucher' },
];

const voucherTypeHelpers: Record<VoucherType, string> = {
    [VoucherType.CASH_PAYMENT]: 'Use the first row for the cash account being paid out. Counter rows can target expense, liability, or other ledger accounts.',
    [VoucherType.CASH_RECEIVE]: 'Use the first row for the cash account receiving funds. Counter rows can target revenue, receivables, or other ledgers.',
    [VoucherType.BANK_PAYMENT]: 'Use the first row for the bank or wallet account being paid out. Counter rows can target expenses or liabilities.',
    [VoucherType.BANK_RECEIVE]: 'Use the first row for the bank or wallet account receiving funds. Counter rows can target revenue or receivables.',
    [VoucherType.FUND_TRANSFER]: 'All rows are limited to cash and bank accounts so internal transfers remain isolated from other ledgers.',
    [VoucherType.JOURNAL]: 'Journal vouchers stay flexible and can mix any tenant-owned accounts as long as the entry balances.',
};

let rowCounter = 0;

function createEmptyRow(): VoucherRow {
    rowCounter += 1;
    return {
        id: `voucher-row-${rowCounter}`,
        accountId: '',
        debitAmount: '',
        creditAmount: '',
        comment: '',
    };
}

function VoucherLoadingFallback() {
    const { t } = useI18n();
    return <div className="p-6 text-sm text-gray-500">{t.vouchers.loading}</div>;
}

export default function AccountingVouchersPage() {
    return (
        <Suspense fallback={<VoucherLoadingFallback />}>
            <AccountingVouchersPageContent />
        </Suspense>
    );
}

function AccountingVouchersPageContent() {
    const { t, locale } = useI18n();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [voucherType, setVoucherType] = useState<VoucherType>(VoucherType.CASH_PAYMENT);
    const [voucherNumber, setVoucherNumber] = useState('');
    const [voucherDate, setVoucherDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [description, setDescription] = useState('');
    const [referenceNumber, setReferenceNumber] = useState('');
    const [accounts, setAccounts] = useState<VoucherAccount[]>([]);
    const [rows, setRows] = useState<VoucherRow[]>([createEmptyRow(), createEmptyRow()]);
    const [isLoadingPreview, setIsLoadingPreview] = useState(true);
    const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [previewError, setPreviewError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [submitError, setSubmitError] = useState('');
    const [createdVoucher, setCreatedVoucher] = useState<VoucherSummary | null>(null);

    const editVoucherId = searchParams.get('edit');
    const isEditMode = Boolean(editVoucherId);
    const templateId = searchParams.get('templateId');

    useEffect(() => {
        if (!editVoucherId) {
            return;
        }

        let active = true;

        const loadVoucherForEdit = async () => {
            setIsLoadingPreview(true);
            setLoadError('');

            try {
                const voucher = await api.getVoucher(editVoucherId);
                if (!active) {
                    return;
                }

                if (voucher.source?.module) {
                    setLoadError('System-posted vouchers cannot be edited.');
                    return;
                }

                setVoucherType(voucher.voucher_type as VoucherType);
                setVoucherNumber(voucher.voucher_number);
                setVoucherDate(voucher.date.slice(0, 10));
                setDescription(voucher.description ?? '');
                setReferenceNumber(voucher.reference_number ?? '');
                setRows(
                    voucher.details.map((detail: any, index: number) => ({
                        id: `voucher-row-edit-${index}`,
                        accountId: detail.account_id ?? detail.account?.id ?? '',
                        debitAmount: Number(detail.debit_amount) > 0 ? String(detail.debit_amount) : '',
                        creditAmount: Number(detail.credit_amount) > 0 ? String(detail.credit_amount) : '',
                        comment: detail.comment ?? '',
                    })),
                );
            } catch (error) {
                if (!active) {
                    return;
                }
                setLoadError(error instanceof Error ? error.message : 'Failed to load voucher for editing.');
            } finally {
                if (active) {
                    setIsLoadingPreview(false);
                }
            }
        };

        void loadVoucherForEdit();

        return () => {
            active = false;
        };
    }, [editVoucherId]);

    useEffect(() => {
        if (!templateId || editVoucherId) {
            return;
        }

        let active = true;

        const loadVoucherTemplate = async () => {
            setIsLoadingPreview(true);
            setLoadError('');

            try {
                const template = await api.getVoucherTemplate(templateId);
                if (!active) {
                    return;
                }

                setVoucherType(template.voucher_type as VoucherType);
                setDescription(template.description ?? template.name ?? '');
                setRows(
                    template.lines.map((line: any, index: number) => ({
                        id: `voucher-row-template-${index}`,
                        accountId: line.account_id ?? line.account?.id ?? '',
                        debitAmount: Number(line.debit_amount) > 0 ? String(line.debit_amount) : '',
                        creditAmount: Number(line.credit_amount) > 0 ? String(line.credit_amount) : '',
                        comment: line.comment ?? '',
                    })),
                );
            } catch (error) {
                if (!active) {
                    return;
                }
                setLoadError(error instanceof Error ? error.message : 'Failed to load voucher template.');
            } finally {
                if (active) {
                    setIsLoadingPreview(false);
                }
            }
        };

        void loadVoucherTemplate();

        return () => {
            active = false;
        };
    }, [templateId, editVoucherId]);

    useEffect(() => {
        let active = true;

        const loadAccounts = async () => {
            setIsLoadingAccounts(true);
            setLoadError('');

            try {
                const data = await api.getAccounts();
                if (!active) {
                    return;
                }

                setAccounts(data);
            } catch (error) {
                if (!active) {
                    return;
                }

                setLoadError(error instanceof Error ? error.message : 'Failed to load account options.');
            } finally {
                if (active) {
                    setIsLoadingAccounts(false);
                }
            }
        };

        loadAccounts();

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (isEditMode) {
            return;
        }

        let active = true;

        const loadPreview = async () => {
            setIsLoadingPreview(true);
            setPreviewError('');

            try {
                const data = await api.getVoucherNumberPreview(voucherType);
                if (!active) {
                    return;
                }

                setVoucherNumber(data.voucherNumber);
            } catch (error) {
                if (!active) {
                    return;
                }

                setPreviewError(error instanceof Error ? error.message : 'Failed to load voucher number preview.');
                setVoucherNumber('');
            } finally {
                if (active) {
                    setIsLoadingPreview(false);
                }
            }
        };

        loadPreview();

        return () => {
            active = false;
        };
    }, [voucherType, isEditMode]);

    useEffect(() => {
        setRows((currentRows) => currentRows.map((row, index) => {
            const nextOptions = getAccountOptionsForRow(accounts, voucherType, index);
            if (row.accountId && !nextOptions.some((account) => account.id === row.accountId)) {
                return {
                    ...row,
                    accountId: '',
                };
            }

            return row;
        }));
    }, [accounts, voucherType]);

    const debitTotal = rows.reduce((sum, row) => sum + parseAmount(row.debitAmount), 0);
    const creditTotal = rows.reduce((sum, row) => sum + parseAmount(row.creditAmount), 0);
    const isBalanced = Math.abs(debitTotal - creditTotal) < 0.0001 && debitTotal > 0;
    const rowErrors = rows.map((row, index) => getRowError(row, accounts, voucherType, index));
    const hasRowErrors = rowErrors.some(Boolean);
    const canSubmit = !isLoadingPreview && !isLoadingAccounts && !isSubmitting && !hasRowErrors && isBalanced;

    const handleVoucherTypeChange = (nextType: VoucherType) => {
        setVoucherType(nextType);
        setCreatedVoucher(null);
        setSubmitError('');
    };

    const updateRow = (rowId: string, field: keyof VoucherRow, value: string) => {
        setRows((currentRows) => currentRows.map((row) => {
            if (row.id !== rowId) {
                return row;
            }

            if (field === 'debitAmount') {
                return {
                    ...row,
                    debitAmount: value,
                    creditAmount: parseAmount(value) > 0 ? '' : row.creditAmount,
                };
            }

            if (field === 'creditAmount') {
                return {
                    ...row,
                    creditAmount: value,
                    debitAmount: parseAmount(value) > 0 ? '' : row.debitAmount,
                };
            }

            return {
                ...row,
                [field]: value,
            };
        }));
    };

    const addRow = () => {
        setRows((currentRows) => [...currentRows, createEmptyRow()]);
    };

    const removeRow = (rowId: string) => {
        setRows((currentRows) => {
            if (currentRows.length <= 2) {
                return currentRows;
            }

            return currentRows.filter((row) => row.id !== rowId);
        });
    };

    const resetForm = () => {
        setDescription('');
        setReferenceNumber('');
        setVoucherDate(new Date().toISOString().slice(0, 10));
        setRows([createEmptyRow(), createEmptyRow()]);
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canSubmit) {
            return;
        }

        setIsSubmitting(true);
        setSubmitError('');

        try {
            const payload = {
                voucherType,
                date: voucherDate,
                description: description || undefined,
                referenceNumber: referenceNumber || undefined,
                details: rows.map((row) => ({
                    accountId: row.accountId,
                    debitAmount: parseAmount(row.debitAmount),
                    creditAmount: parseAmount(row.creditAmount),
                    comment: row.comment || undefined,
                })),
            };

            if (isEditMode && editVoucherId) {
                const result = await api.updateVoucher(editVoucherId, payload);
                router.replace(`/accounting/vouchers?voucher=${encodeURIComponent(result.voucher_number)}`);
                return;
            }

            const result = await api.createVoucher(payload);

            setCreatedVoucher({ id: result.id, voucherNumber: result.voucher_number });
            resetForm();
            router.replace(`/accounting/vouchers?voucher=${encodeURIComponent(result.voucher_number)}`);

            try {
                const preview = await api.getVoucherNumberPreview(voucherType);
                setVoucherNumber(preview.voucherNumber);
            } catch {
                setVoucherNumber('');
            }
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : 'Failed to save voucher.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const inputClass = 'px-1.5 py-0.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-transparent';

    return (
        <form onSubmit={handleSubmit} className="flex flex-col h-full overflow-y-auto lg:overflow-hidden bg-gray-50 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-b bg-white flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Link href="/accounting/vouchers" className="text-gray-400 hover:text-gray-700">
                        <ChevronLeft className="w-5 h-5" />
                    </Link>
                    <h1 className="text-base font-bold text-gray-900 whitespace-nowrap">
                        {isEditMode ? t.vouchers.list.editVoucher : t.vouchers.workbenchTitle}
                    </h1>
                </div>
                <div className="h-5 w-px bg-gray-200 hidden sm:block" />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                    <label className="flex items-center gap-1">
                        <span className="font-semibold uppercase tracking-wide text-[10px] text-gray-400">Type</span>
                        <select
                            id="voucher-type-select"
                            aria-label={t.vouchers.voucherTypeAria}
                            value={voucherType}
                            onChange={(event) => handleVoucherTypeChange(event.target.value as VoucherType)}
                            className="px-1.5 py-0.5 border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                        >
                            {voucherTypeOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex items-center gap-1">
                        <span className="font-semibold uppercase tracking-wide text-[10px] text-gray-400">Date</span>
                        <input
                            aria-label={t.vouchers.voucherDateAria}
                            type="date"
                            value={voucherDate}
                            onChange={(event) => setVoucherDate(event.target.value)}
                            className="px-1.5 py-0.5 border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                        />
                    </label>
                    <label className="flex items-center gap-1">
                        <span className="font-semibold uppercase tracking-wide text-[10px] text-gray-400">Ref #</span>
                        <input
                            aria-label={t.vouchers.referenceAria}
                            value={referenceNumber}
                            onChange={(event) => setReferenceNumber(event.target.value)}
                            placeholder="Optional"
                            className="w-24 px-1.5 py-0.5 border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                        />
                    </label>
                    <span className="flex items-center gap-1">
                        <span className="font-semibold uppercase tracking-wide text-[10px] text-gray-400">Voucher #</span>
                        <span className="text-gray-700 font-medium">
                            {isLoadingPreview ? '…' : voucherNumber || '—'}
                        </span>
                    </span>
                    {previewError ? <span className="text-red-600 font-medium">{previewError}</span> : null}
                </div>
            </div>

            {createdVoucher ? (
                <div className="flex items-center gap-2 px-4 py-2 border-b border-emerald-200 bg-emerald-50 text-emerald-900 flex-shrink-0">
                    <CircleCheck className="h-4 w-4 text-emerald-700 flex-shrink-0" />
                    <p className="text-sm font-medium">
                        Voucher {createdVoucher.voucherNumber} saved successfully
                    </p>
                </div>
            ) : null}

            <div className="flex flex-col lg:flex-1 lg:flex-row lg:overflow-hidden">
                <div className="flex flex-col lg:flex-1 lg:overflow-hidden p-3 gap-2 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-shrink-0">
                        <p className="text-xs text-gray-500 truncate" title={voucherTypeHelpers[voucherType]}>
                            {voucherTypeHelpers[voucherType]}
                        </p>
                        <button
                            type="button"
                            onClick={addRow}
                            className="inline-flex items-center gap-1 px-2.5 py-1 border rounded text-xs font-medium text-gray-700 hover:bg-gray-50 flex-shrink-0"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Add Row
                        </button>
                    </div>

                    {isLoadingAccounts ? (
                        <div className="rounded border bg-white px-3 py-2 text-xs text-gray-500 flex-shrink-0">Loading accounts…</div>
                    ) : null}
                    {loadError ? (
                        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600 flex-shrink-0">{loadError}</div>
                    ) : null}

                    <div className="min-h-[240px] lg:flex-1 lg:min-h-0 lg:overflow-hidden">
                        <div className="h-full overflow-y-auto rounded border bg-white">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 z-10 bg-gray-50 border-b">
                                    <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                                        <th className="px-2 py-1.5 text-left font-semibold w-8">#</th>
                                        <th className="px-2 py-1.5 text-left font-semibold min-w-[180px]">Account</th>
                                        <th className="px-2 py-1.5 text-right font-semibold w-24">Debit</th>
                                        <th className="px-2 py-1.5 text-right font-semibold w-24">Credit</th>
                                        <th className="px-2 py-1.5 text-left font-semibold hidden md:table-cell">Comment</th>
                                        <th className="px-2 py-1.5 w-8" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row, index) => {
                                        const options = getAccountOptionsForRow(accounts, voucherType, index);
                                        const error = rowErrors[index];
                                        return (
                                            <tr key={row.id} className={`border-b last:border-b-0 ${error ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                                                <td className="px-2 py-1 text-gray-500 align-top">{index + 1}</td>
                                                <td className="px-2 py-1 align-top">
                                                    <select
                                                        aria-label={`Account row ${index + 1}`}
                                                        value={row.accountId}
                                                        onChange={(event) => updateRow(row.id, 'accountId', event.target.value)}
                                                        className={`w-full ${inputClass}`}
                                                        title={getRowHint(voucherType, index)}
                                                    >
                                                        <option value="">{getRowLabel(voucherType, index)}…</option>
                                                        {options.map((account) => (
                                                            <option key={account.id} value={account.id}>
                                                                {account.name} {account.code ? `(${account.code})` : ''}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    {error ? <p className="mt-0.5 text-[11px] text-red-600">{error}</p> : null}
                                                </td>
                                                <td className="px-2 py-1 text-right align-top">
                                                    <input
                                                        aria-label={`Debit row ${index + 1}`}
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={row.debitAmount}
                                                        onChange={(event) => updateRow(row.id, 'debitAmount', event.target.value)}
                                                        className={`w-20 text-right ${inputClass}`}
                                                        placeholder="0.00"
                                                    />
                                                </td>
                                                <td className="px-2 py-1 text-right align-top">
                                                    <input
                                                        aria-label={`Credit row ${index + 1}`}
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={row.creditAmount}
                                                        onChange={(event) => updateRow(row.id, 'creditAmount', event.target.value)}
                                                        className={`w-20 text-right ${inputClass}`}
                                                        placeholder="0.00"
                                                    />
                                                </td>
                                                <td className="px-2 py-1 hidden md:table-cell align-top">
                                                    <input
                                                        aria-label={`Comment row ${index + 1}`}
                                                        value={row.comment}
                                                        onChange={(event) => updateRow(row.id, 'comment', event.target.value)}
                                                        className={`w-full ${inputClass}`}
                                                        placeholder={t.vouchers.optionalRowNote}
                                                    />
                                                </td>
                                                <td className="px-2 py-1 text-center align-top">
                                                    <button
                                                        type="button"
                                                        aria-label={`Remove row ${index + 1}`}
                                                        onClick={() => removeRow(row.id)}
                                                        disabled={rows.length <= 2}
                                                        className="text-red-500 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <input
                        type="text"
                        aria-label={t.vouchers.descriptionAria}
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder={`${t.vouchers.narrationPlaceholder}…`}
                        className="w-full border rounded px-2 py-1.5 text-sm flex-shrink-0"
                    />
                </div>

                <div className="w-full lg:w-80 flex-shrink-0 border-t lg:border-t-0 lg:border-l bg-white flex flex-col lg:overflow-hidden">
                    <div className="lg:flex-1 lg:overflow-y-auto p-3 space-y-1.5">
                        <BalanceStat label={t.accountingShared.debitTotal} value={debitTotal} tone="debit" locale={locale} />
                        <BalanceStat label={t.accountingShared.creditTotal} value={creditTotal} tone="credit" locale={locale} />
                        <div className={`rounded border px-3 py-2 ${isBalanced ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
                            <div className="flex justify-between items-center">
                                <span className="text-gray-500">Difference</span>
                                <span className="font-semibold">{formatBDT(Math.abs(debitTotal - creditTotal), { locale })}</span>
                            </div>
                            <p className="mt-1 text-xs">
                                {isBalanced ? 'Balanced — ready to save.' : 'Voucher must balance before it can be saved.'}
                            </p>
                        </div>
                        {submitError ? (
                            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600">{submitError}</div>
                        ) : null}
                    </div>

                    <div className="flex items-center gap-2 p-3 pb-20 lg:pb-16 border-t flex-shrink-0">
                        <Link
                            href="/accounting/vouchers"
                            className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm"
                        >
                            Cancel
                        </Link>
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium"
                        >
                            {isSubmitting ? 'Saving…' : isEditMode ? t.vouchers.list.saveChanges : 'Save Voucher'}
                        </button>
                    </div>
                </div>
            </div>
        </form>
    );
}

function parseAmount(value: string) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getAllowedCategories(voucherType: VoucherType, rowIndex: number): AccountCategory[] | null {
    if (voucherType === VoucherType.FUND_TRANSFER) {
        return [AccountCategory.CASH, AccountCategory.BANK];
    }

    if ((voucherType === VoucherType.CASH_PAYMENT || voucherType === VoucherType.CASH_RECEIVE) && rowIndex === 0) {
        return [AccountCategory.CASH];
    }

    if ((voucherType === VoucherType.BANK_PAYMENT || voucherType === VoucherType.BANK_RECEIVE) && rowIndex === 0) {
        return [AccountCategory.BANK];
    }

    return null;
}

function getAccountOptionsForRow(accounts: VoucherAccount[], voucherType: VoucherType, rowIndex: number) {
    const allowedCategories = getAllowedCategories(voucherType, rowIndex);
    return allowedCategories ? accounts.filter((account) => allowedCategories.includes(account.category)) : accounts;
}

function getRowLabel(voucherType: VoucherType, rowIndex: number) {
    if (rowIndex === 0) {
        if (voucherType === VoucherType.CASH_PAYMENT || voucherType === VoucherType.CASH_RECEIVE) {
            return 'Cash account row';
        }
        if (voucherType === VoucherType.BANK_PAYMENT || voucherType === VoucherType.BANK_RECEIVE) {
            return 'Bank account row';
        }
    }

    if (voucherType === VoucherType.FUND_TRANSFER) {
        return 'Transfer leg';
    }

    return `Voucher row ${rowIndex + 1}`;
}

function getRowHint(voucherType: VoucherType, rowIndex: number) {
    const allowedCategories = getAllowedCategories(voucherType, rowIndex);
    if (!allowedCategories) {
        return 'Any tenant-owned account can be used in this row.';
    }

    return `Allowed categories: ${allowedCategories.join(', ')}.`;
}

function getRowError(row: VoucherRow, accounts: VoucherAccount[], voucherType: VoucherType, rowIndex: number) {
    if (!row.accountId) {
        return 'Select an account for this row.';
    }

    const options = getAccountOptionsForRow(accounts, voucherType, rowIndex);
    if (options.length > 0 && !options.some((account) => account.id === row.accountId)) {
        return 'The selected account does not match the current voucher-type rules.';
    }

    const debit = parseAmount(row.debitAmount);
    const credit = parseAmount(row.creditAmount);
    const hasDebit = debit > 0;
    const hasCredit = credit > 0;

    if ((hasDebit && hasCredit) || (!hasDebit && !hasCredit)) {
        return 'Enter a debit or a credit amount, but not both.';
    }

    return '';
}

function BalanceStat({ label, value, tone, locale }: { label: string; value: number; tone: 'debit' | 'credit'; locale: string }) {
    const valueClass = tone === 'debit' ? 'text-amber-700' : 'text-sky-700';

    return (
        <div className="flex justify-between items-center">
            <span className="text-gray-500">{label}</span>
            <span className={`font-semibold ${valueClass}`}>{formatBDT(value, { locale })}</span>
        </div>
    );
}