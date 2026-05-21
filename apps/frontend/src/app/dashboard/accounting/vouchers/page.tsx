"use client";

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CircleCheck, FileText, Plus, Scale, Trash2 } from 'lucide-react';
import { AccountCategory, VoucherType } from '@retail-saas/shared-types';
import { api } from '../../../../lib/api';
import { formatBDT } from '../../../../lib/format';

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

export default function AccountingVouchersPage() {
    return (
        <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading vouchers...</div>}>
            <AccountingVouchersPageContent />
        </Suspense>
    );
}

function AccountingVouchersPageContent() {
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

    const createdVoucherId = searchParams.get('created');
    const createdVoucherNumber = searchParams.get('voucher');

    useEffect(() => {
        if (createdVoucherId && createdVoucherNumber) {
            setCreatedVoucher({ id: createdVoucherId, voucherNumber: createdVoucherNumber });
        }
    }, [createdVoucherId, createdVoucherNumber]);

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
    }, [voucherType]);

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
            const result = await api.createVoucher({
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
            });

            setCreatedVoucher({ id: result.id, voucherNumber: result.voucher_number });
            resetForm();
            router.replace(`/dashboard/accounting/vouchers?created=${encodeURIComponent(result.id)}&voucher=${encodeURIComponent(result.voucher_number)}`);

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

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-6xl mx-auto space-y-6">
                <Link href="/dashboard/accounting" className="inline-flex items-center text-sm font-bold text-gray-500 hover:text-gray-900 transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Accounting
                </Link>

                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start gap-4">
                        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-emerald-700">
                            <FileText className="h-6 w-6" />
                        </div>
                        <div className="space-y-2">
                            <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">Story 30.5</p>
                            <h1 className="text-2xl font-black tracking-tight">Voucher Entry Workbench</h1>
                            <p className="text-sm text-gray-500 max-w-2xl">
                                Build balanced multi-line vouchers with live debit and credit totals, account-aware row controls, and server-issued numbering.
                            </p>
                        </div>
                    </div>
                </section>

                {createdVoucher ? (
                    <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
                        <div className="flex items-start gap-3">
                            <CircleCheck className="mt-0.5 h-5 w-5 text-emerald-700" />
                            <div>
                                <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-700">Journal confirmation</p>
                                <h2 className="mt-1 text-lg font-black tracking-tight text-emerald-950">Voucher {createdVoucher.voucherNumber} saved successfully</h2>
                                <p className="mt-2 text-sm text-emerald-900">
                                    The voucher was posted and the sequence was committed. You can enter the next voucher immediately.
                                </p>
                            </div>
                        </div>
                    </section>
                ) : null}

                <form className="grid gap-6 xl:grid-cols-[1.7fr,0.9fr]" onSubmit={handleSubmit}>
                    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-6">
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <label className="block text-xs font-bold uppercase tracking-[0.24em] text-gray-400">
                                <span>Voucher type</span>
                                <select
                                    id="voucher-type-select"
                                    aria-label="Voucher type"
                                    value={voucherType}
                                    onChange={(event) => handleVoucherTypeChange(event.target.value as VoucherType)}
                                    className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition focus:border-gray-400"
                                >
                                    {voucherTypeOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="block text-xs font-bold uppercase tracking-[0.24em] text-gray-400">
                                <span>Voucher date</span>
                                <input
                                    aria-label="Voucher date"
                                    type="date"
                                    value={voucherDate}
                                    onChange={(event) => setVoucherDate(event.target.value)}
                                    className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition focus:border-gray-400"
                                />
                            </label>

                            <label className="block text-xs font-bold uppercase tracking-[0.24em] text-gray-400">
                                <span>Reference number</span>
                                <input
                                    aria-label="Reference number"
                                    value={referenceNumber}
                                    onChange={(event) => setReferenceNumber(event.target.value)}
                                    placeholder="CP-REF-01"
                                    className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition focus:border-gray-400"
                                />
                            </label>

                            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                                <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">Next generated number</p>
                                <p className="mt-2 text-2xl font-black tracking-tight text-gray-900">
                                    {isLoadingPreview ? 'Loading...' : voucherNumber || 'Unavailable'}
                                </p>
                                {previewError ? <p className="mt-2 text-sm font-bold text-red-600">{previewError}</p> : null}
                            </div>
                        </div>

                        <label className="block text-xs font-bold uppercase tracking-[0.24em] text-gray-400">
                            <span>Description</span>
                            <textarea
                                aria-label="Description"
                                value={description}
                                onChange={(event) => setDescription(event.target.value)}
                                rows={3}
                                placeholder="Narrate the accounting event for audit clarity"
                                className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition focus:border-gray-400"
                            />
                        </label>

                        <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm text-sky-900">
                            <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-700">Voucher-type guidance</p>
                            <p className="mt-2">{voucherTypeHelpers[voucherType]}</p>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <h2 className="text-lg font-black tracking-tight">Voucher rows</h2>
                                    <p className="text-sm text-gray-500">Each row must choose one account and one side only.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={addRow}
                                    className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-200"
                                >
                                    <Plus className="mr-2 h-4 w-4" />
                                    Add Row
                                </button>
                            </div>

                            {isLoadingAccounts ? <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-500">Loading accounts...</div> : null}
                            {loadError ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{loadError}</div> : null}

                            <div className="space-y-3">
                                {rows.map((row, index) => {
                                    const options = getAccountOptionsForRow(accounts, voucherType, index);
                                    const error = rowErrors[index];
                                    return (
                                        <div key={row.id} className="rounded-3xl border border-gray-200 bg-gray-50 p-4">
                                            <div className="grid gap-3 xl:grid-cols-[1.4fr,0.7fr,0.7fr,1fr,auto] xl:items-start">
                                                <label className="block text-[11px] font-black uppercase tracking-[0.24em] text-gray-400">
                                                    <span>{getRowLabel(voucherType, index)}</span>
                                                    <select
                                                        aria-label={`Account row ${index + 1}`}
                                                        value={row.accountId}
                                                        onChange={(event) => updateRow(row.id, 'accountId', event.target.value)}
                                                        className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900"
                                                    >
                                                        <option value="">Select account</option>
                                                        {options.map((account) => (
                                                            <option key={account.id} value={account.id}>
                                                                {account.name} {account.code ? `(${account.code})` : ''}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <span className="mt-2 block text-[11px] normal-case tracking-normal text-gray-500">
                                                        {getRowHint(voucherType, index)}
                                                    </span>
                                                </label>

                                                <label className="block text-[11px] font-black uppercase tracking-[0.24em] text-gray-400">
                                                    <span>Debit</span>
                                                    <input
                                                        aria-label={`Debit row ${index + 1}`}
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={row.debitAmount}
                                                        onChange={(event) => updateRow(row.id, 'debitAmount', event.target.value)}
                                                        className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900"
                                                        placeholder="0.00"
                                                    />
                                                </label>

                                                <label className="block text-[11px] font-black uppercase tracking-[0.24em] text-gray-400">
                                                    <span>Credit</span>
                                                    <input
                                                        aria-label={`Credit row ${index + 1}`}
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={row.creditAmount}
                                                        onChange={(event) => updateRow(row.id, 'creditAmount', event.target.value)}
                                                        className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900"
                                                        placeholder="0.00"
                                                    />
                                                </label>

                                                <label className="block text-[11px] font-black uppercase tracking-[0.24em] text-gray-400">
                                                    <span>Comment</span>
                                                    <input
                                                        aria-label={`Comment row ${index + 1}`}
                                                        value={row.comment}
                                                        onChange={(event) => updateRow(row.id, 'comment', event.target.value)}
                                                        className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900"
                                                        placeholder="Optional row note"
                                                    />
                                                </label>

                                                <button
                                                    type="button"
                                                    aria-label={`Remove row ${index + 1}`}
                                                    onClick={() => removeRow(row.id)}
                                                    disabled={rows.length <= 2}
                                                    className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-3 py-3 text-gray-500 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                            {error ? <p className="mt-3 text-sm font-bold text-red-600">{error}</p> : null}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </section>

                    <section className="space-y-4">
                        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                            <div className="flex items-center gap-3">
                                <Scale className="h-5 w-5 text-gray-900" />
                                <h2 className="text-lg font-black tracking-tight">Balance status</h2>
                            </div>
                            <div className="mt-5 grid gap-3">
                                <BalanceStat label="Debit total" value={debitTotal} tone="debit" />
                                <BalanceStat label="Credit total" value={creditTotal} tone="credit" />
                                <div className={`rounded-2xl border px-4 py-4 ${isBalanced ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
                                    <p className="text-xs font-black uppercase tracking-[0.24em]">Balance</p>
                                    <p className="mt-2 text-2xl font-black tracking-tight">
                                        {formatBDT(Math.abs(debitTotal - creditTotal))}
                                    </p>
                                    <p className="mt-2 text-sm font-medium">
                                        {isBalanced ? 'Voucher is balanced and ready for submission.' : 'Voucher must balance before it can be saved.'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
                            <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">Submission guardrails</p>
                            <ul className="space-y-2 text-sm text-gray-600 list-disc pl-5">
                                <li>At least two rows are required.</li>
                                <li>Every row must select one tenant-owned account.</li>
                                <li>Each row must contain either debit or credit, not both.</li>
                                <li>Cash, bank, and fund-transfer types apply category restrictions automatically.</li>
                            </ul>
                            {submitError ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{submitError}</div> : null}
                            <button
                                type="submit"
                                disabled={!canSubmit}
                                className="w-full rounded-2xl bg-gray-900 px-4 py-3 text-sm font-black text-white transition disabled:cursor-not-allowed disabled:bg-gray-300"
                            >
                                {isSubmitting ? 'Saving Voucher...' : 'Save Voucher'}
                            </button>
                        </div>
                    </section>
                </form>
            </div>
        </div>
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

function BalanceStat({ label, value, tone }: { label: string; value: number; tone: 'debit' | 'credit' }) {
    const classes = tone === 'debit'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-sky-200 bg-sky-50 text-sky-900';

    return (
        <div className={`rounded-2xl border px-4 py-4 ${classes}`}>
            <p className="text-xs font-black uppercase tracking-[0.24em]">{label}</p>
            <p className="mt-2 text-2xl font-black tracking-tight">{formatBDT(value)}</p>
        </div>
    );
}