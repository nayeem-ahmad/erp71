'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Camera, CheckCircle2, ReceiptText, ShoppingCart, Sparkles } from 'lucide-react';
import {
    BILL_SCAN_MAX_EDGE_PX,
    estimateBillScanCredits,
    type AiCreditEstimate,
    type BillScanResult,
    type BillScanTarget,
} from '@erp71/shared-types';
import { Alert, Button, ConfirmDialog, Field, FormGrid, Input, PageHeader, PageShell, Select, Textarea } from '@/components/ui';
import { savePurchaseDraft, toPurchaseDraft } from '@/components/tools/bill-scan/purchase-draft';
import { todayLocal } from '@/components/tools/dates';
import { shrinkImage, type ShrunkImage } from '@/components/tools/files';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { getWorkspaceItem } from '@/lib/session-store';
import { toast } from '@/lib/toast';

interface AiUsage {
    credits_limit: number;
    credits_remaining: number;
}

/** Credits with at most one decimal — "3.4", not "3.4000001". */
const credits = (value: number) => (Math.round(value * 10) / 10).toString();

/**
 * Tools → Scan a bill. A photo goes to the AI only after the screen has
 * shown what it will cost and the person has said yes; what comes back is a
 * draft for a person to check, never something saved on its own.
 */
export default function BillScanPage() {
    const { t, fmt, locale } = useI18n();
    const m = t.tools.billScan;
    const router = useRouter();
    const fileRef = useRef<HTMLInputElement>(null);

    const [target, setTarget] = useState<BillScanTarget>('purchase');
    const [photo, setPhoto] = useState<ShrunkImage | null>(null);
    const [preparing, setPreparing] = useState(false);
    const [usage, setUsage] = useState<AiUsage | null>(null);
    const [usageFailed, setUsageFailed] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [result, setResult] = useState<BillScanResult | null>(null);

    const loadUsage = () =>
        api
            .getAiUsage()
            .then((value: AiUsage) => {
                setUsage(value);
                setUsageFailed(false);
            })
            .catch(() => setUsageFailed(true));

    useEffect(() => {
        void loadUsage();
    }, []);

    const estimate: AiCreditEstimate | null = useMemo(
        () => (photo ? estimateBillScanCredits(photo.width, photo.height) : null),
        [photo],
    );
    const remaining = usage?.credits_remaining ?? null;
    const notEnough = estimate !== null && remaining !== null && remaining < estimate.expected;
    const tight = estimate !== null && remaining !== null && !notEnough && remaining < estimate.max;

    const pickPhoto = async (file: File | undefined) => {
        if (!file) return;
        setPreparing(true);
        setResult(null);
        try {
            setPhoto(await shrinkImage(file, BILL_SCAN_MAX_EDGE_PX, 0.85));
        } catch {
            toast.error(m.photoFailed);
        } finally {
            setPreparing(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const scan = async () => {
        if (!photo) return;
        setConfirming(false);
        setScanning(true);
        try {
            const read = await api.scanBill({
                target,
                imageBase64: photo.dataUrl,
                mimeType: photo.mimeType,
                width: photo.width,
                height: photo.height,
            });
            setResult(read);
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : m.scanFailed);
        } finally {
            setScanning(false);
            void loadUsage();
        }
    };

    const reset = () => {
        setPhoto(null);
        setResult(null);
    };

    const confirmPrompt = estimate
        ? remaining !== null
            ? fmt(m.confirmPrompt, { expected: credits(estimate.expected), max: credits(estimate.max), remaining: credits(remaining) })
            : fmt(m.confirmPromptUnknown, { expected: credits(estimate.expected), max: credits(estimate.max) })
        : '';

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.tools, m.title, 'tools')}
            />

            {!result && (
                <div className="space-y-3 rounded-md border border-gray-200 bg-white p-3 md:p-4">
                    <fieldset>
                        <legend className="text-xs font-medium text-gray-600">{m.target}</legend>
                        <div className="mt-1 grid gap-2 sm:grid-cols-2">
                            {(['purchase', 'expense'] as const).map((value) => {
                                const Icon = value === 'purchase' ? ShoppingCart : ReceiptText;
                                return (
                                    <label
                                        key={value}
                                        className={`flex min-h-touch cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                                            target === value ? 'border-blue-600 bg-blue-50' : 'border-gray-200'
                                        }`}
                                    >
                                        <input type="radio" name="scan-target" value={value} checked={target === value} onChange={() => setTarget(value)} className="mt-1 accent-blue-600" />
                                        <Icon className="mt-0.5 h-4 w-4 text-gray-500" aria-hidden />
                                        <span>
                                            <span className="block font-medium text-gray-900">{value === 'purchase' ? m.targetPurchase : m.targetExpense}</span>
                                            <span className="block text-xs text-gray-500">{value === 'purchase' ? m.targetPurchaseHint : m.targetExpenseHint}</span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    </fieldset>

                    <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void pickPhoto(e.target.files?.[0])} />

                    {photo ? (
                        <div className="flex flex-col gap-3 sm:flex-row">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={photo.dataUrl} alt="" className="max-h-72 w-full rounded-md border border-gray-200 object-contain sm:w-56" />
                            <div className="flex-1 space-y-2">
                                {estimate && (
                                    <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                                        <p className="flex items-center gap-1.5 font-medium">
                                            <Sparkles className="h-4 w-4" aria-hidden /> {m.estimateTitle}
                                        </p>
                                        <p className="mt-1">{fmt(m.estimate, { expected: credits(estimate.expected), max: credits(estimate.max) })}</p>
                                        <p className="mt-0.5 text-xs">
                                            {usage
                                                ? fmt(m.remaining, { remaining: credits(usage.credits_remaining), limit: credits(usage.credits_limit) })
                                                : usageFailed
                                                  ? m.remainingUnknown
                                                  : '…'}
                                        </p>
                                    </div>
                                )}
                                {notEnough && (
                                    <Alert tone="danger">
                                        {m.notEnough}{' '}
                                        <Link href={routes.aiCredits} className="font-medium text-blue-600 hover:underline">
                                            {m.buyCredits}
                                        </Link>
                                    </Alert>
                                )}
                                {tight && <Alert tone="warning">{m.lowCredits}</Alert>}
                                <div className="flex flex-wrap gap-2">
                                    <Button onClick={() => setConfirming(true)} disabled={!estimate || notEnough || scanning} loading={scanning}>
                                        {scanning ? m.scanning : fmt(m.scan, { expected: estimate ? credits(estimate.expected) : '' })}
                                    </Button>
                                    <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={scanning}>
                                        {m.changePhoto}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <Button size="md" onClick={() => fileRef.current?.click()} loading={preparing} disabled={preparing}>
                            <Camera className="h-4 w-4" aria-hidden /> {preparing ? m.preparing : m.pickPhoto}
                        </Button>
                    )}
                </div>
            )}

            {result && (
                <ScanReview
                    result={result}
                    onReset={reset}
                    onOpenPurchase={() => {
                        savePurchaseDraft(toPurchaseDraft(result, { notes: m.draftNotes, unmatched: m.draftUnmatched }));
                        router.push(`${routes.purchases.newPurchase}?from=scan`);
                    }}
                    locale={locale}
                />
            )}

            <ConfirmDialog
                open={confirming}
                title={m.confirmTitle}
                prompt={confirmPrompt}
                confirmLabel={m.confirm}
                cancelLabel={m.cancel}
                onConfirm={() => void scan()}
                onCancel={() => setConfirming(false)}
            />
        </PageShell>
    );
}

function ScanReview({
    result,
    onReset,
    onOpenPurchase,
    locale,
}: {
    result: BillScanResult;
    onReset: () => void;
    onOpenPurchase: () => void;
    locale: string;
}) {
    const { t, fmt } = useI18n();
    const m = t.tools.billScan;
    const money = (value: number | null) => (value === null ? '—' : formatBDT(value, { locale }));
    const nothing = !result.vendorName && !result.total && result.lines.length === 0;
    const matchedLines = result.lines.filter((line) => line.product).length;
    const unmatched = result.lines.length - matchedLines;

    return (
        <div className="space-y-3">
            <Alert tone="info">
                <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                    {fmt(m.creditsUsed, { used: credits(result.credits_used), expected: credits(result.credits_estimate.expected) })}
                </span>
            </Alert>

            {nothing ? (
                <Alert tone="warning">{m.nothingRead}</Alert>
            ) : (
                <section className="space-y-3 rounded-md border border-gray-200 bg-white p-3 md:p-4">
                    <div>
                        <h2 className="text-sm font-semibold text-gray-900">{m.reviewTitle}</h2>
                        <p className="text-xs text-amber-700">{m.reviewHint}</p>
                    </div>

                    <dl className="grid gap-2 text-sm sm:grid-cols-3">
                        <div>
                            <dt className="text-xs text-gray-500">{m.vendor}</dt>
                            <dd className="text-gray-900">{result.vendorName ?? '—'}</dd>
                            {result.target === 'purchase' && (
                                <dd className="text-xs text-gray-500">
                                    {result.supplier
                                        ? fmt(m.supplierMatched, { name: result.supplier.name })
                                        : result.vendorName
                                          ? fmt(m.supplierNew, { name: result.vendorName })
                                          : m.supplierNone}
                                </dd>
                            )}
                        </div>
                        <div>
                            <dt className="text-xs text-gray-500">{m.billNumber}</dt>
                            <dd className="text-gray-900">{result.billNumber ?? '—'}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-gray-500">{m.billDate}</dt>
                            <dd className="text-gray-900">{result.billDate ?? '—'}</dd>
                        </div>
                    </dl>

                    {result.lines.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="border-y border-gray-100 bg-gray-50 text-xs text-gray-500">
                                    <tr>
                                        <th className="px-2 py-1.5 text-start font-medium">{m.lineItem}</th>
                                        {result.target === 'purchase' && <th className="hidden px-2 py-1.5 text-start font-medium sm:table-cell">{m.lineProduct}</th>}
                                        <th className="px-2 py-1.5 text-end font-medium">{m.lineQty}</th>
                                        <th className="hidden px-2 py-1.5 text-end font-medium sm:table-cell">{m.linePrice}</th>
                                        <th className="px-2 py-1.5 text-end font-medium">{m.lineTotal}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {result.lines.map((line, index) => (
                                        <tr key={index}>
                                            <td className="px-2 py-1.5 text-gray-900">
                                                {line.description}
                                                {result.target === 'purchase' && (
                                                    <span className={`block text-xs sm:hidden ${line.product ? 'text-gray-500' : 'text-amber-700'}`}>
                                                        {line.product?.name ?? m.lineUnmatched}
                                                    </span>
                                                )}
                                            </td>
                                            {result.target === 'purchase' && (
                                                <td className={`hidden px-2 py-1.5 sm:table-cell ${line.product ? 'text-gray-700' : 'text-amber-700'}`}>
                                                    {line.product?.name ?? m.lineUnmatched}
                                                </td>
                                            )}
                                            <td className="px-2 py-1.5 text-end tabular-nums">{line.quantity}</td>
                                            <td className="hidden px-2 py-1.5 text-end tabular-nums sm:table-cell">{money(line.unitPrice)}</td>
                                            <td className="px-2 py-1.5 text-end tabular-nums">{money(line.lineTotal)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <dl className="ms-auto grid max-w-xs grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
                        {([
                            [m.subtotal, result.subtotal],
                            [m.discount, result.discount],
                            [m.tax, result.tax],
                            [m.freight, result.freight],
                        ] as const)
                            .filter(([, value]) => value !== null)
                            .map(([label, value]) => (
                                <div key={label} className="contents">
                                    <dt className="text-gray-500">{label}</dt>
                                    <dd className="text-end tabular-nums text-gray-900">{money(value)}</dd>
                                </div>
                            ))}
                        <dt className="font-medium text-gray-900">{m.total}</dt>
                        <dd className="text-end font-semibold tabular-nums text-gray-900">{money(result.total)}</dd>
                    </dl>
                </section>
            )}

            {!nothing && result.target === 'purchase' && (
                <div className="space-y-2">
                    {unmatched > 0 && matchedLines > 0 && <Alert tone="warning">{fmt(m.unmatchedNote, { count: unmatched })}</Alert>}
                    {matchedLines === 0 && result.lines.length > 0 && <Alert tone="warning">{m.noMatchedLines}</Alert>}
                </div>
            )}

            {!nothing && result.target === 'expense' && <ExpenseFromScan result={result} onSaved={onReset} />}

            <div className="flex flex-wrap gap-2">
                {!nothing && result.target === 'purchase' && (
                    <Button onClick={onOpenPurchase} disabled={matchedLines === 0}>
                        <ShoppingCart className="h-4 w-4" aria-hidden /> {m.openPurchase}
                    </Button>
                )}
                <Button variant="secondary" onClick={onReset}>
                    {m.scanAnother}
                </Button>
            </div>
        </div>
    );
}

const PAYMENT_METHODS = ['CASH', 'BKASH', 'CARD', 'BANK'] as const;

interface ExpenseHeadOption {
    id: string;
    name: string;
    category?: { name: string } | null;
}

/** The expense, filled from the receipt, saved with the same route as Expenses. */
function ExpenseFromScan({ result, onSaved }: { result: BillScanResult; onSaved: () => void }) {
    const { t } = useI18n();
    const m = t.tools.billScan;
    const [heads, setHeads] = useState<ExpenseHeadOption[] | null>(null);
    const [headId, setHeadId] = useState(result.expenseHead?.id ?? '');
    const [amount, setAmount] = useState(result.total !== null ? String(result.total) : '');
    const [expenseDate, setExpenseDate] = useState(result.billDate ?? todayLocal());
    const [description, setDescription] = useState(
        [result.summary, result.vendorName, result.billNumber ? `#${result.billNumber}` : null].filter(Boolean).join(' · '),
    );
    const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>('CASH');
    const [errors, setErrors] = useState<{ head?: string; amount?: string }>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.getExpenseHeads()
            .then((rows: ExpenseHeadOption[]) => setHeads(Array.isArray(rows) ? rows : []))
            .catch(() => setHeads([]));
    }, []);

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        const next: typeof errors = {};
        if (!headId) next.head = m.headRequired;
        if (!(Number(amount) > 0)) next.amount = m.amountInvalid;
        setErrors(next);
        if (Object.keys(next).length) return;
        setSaving(true);
        try {
            await api.createExpenseEntry({
                headId,
                amount: Math.round(Number(amount) * 100) / 100,
                expenseDate,
                description: description.trim() || undefined,
                paymentMethod,
                storeId: getWorkspaceItem('store_id') || undefined,
            });
            toast.success(m.expenseSaved);
            onSaved();
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : m.expenseFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={save} className="space-y-3 rounded-md border border-gray-200 bg-white p-3 md:p-4" noValidate>
            {heads && heads.length === 0 ? (
                <Alert tone="warning">
                    {m.noHeads}{' '}
                    <Link href={routes.accounting.expenseHeads} className="font-medium text-blue-600 hover:underline">
                        {t.expenses.manageHeads}
                    </Link>
                </Alert>
            ) : (
                <FormGrid>
                    <Field label={m.expenseHead} required error={errors.head} hint={result.expenseHead && headId === result.expenseHead.id ? m.expenseHeadMatched : undefined} htmlFor="scan-head">
                        <Select id="scan-head" value={headId} onChange={(e) => setHeadId(e.target.value)} error={!!errors.head} className="w-full">
                            <option value="">{m.expenseHeadPick}</option>
                            {(heads ?? []).map((head) => (
                                <option key={head.id} value={head.id}>
                                    {head.category?.name ? `${head.category.name} › ${head.name}` : head.name}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <Field label={m.amount} required error={errors.amount} htmlFor="scan-amount">
                        <Input id="scan-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} error={!!errors.amount} className="w-full" />
                    </Field>
                    <Field label={m.expenseDate} htmlFor="scan-date">
                        <Input id="scan-date" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="w-full" />
                    </Field>
                    <Field label={m.paymentMethod} htmlFor="scan-method">
                        <Select id="scan-method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)} className="w-full">
                            {PAYMENT_METHODS.map((method) => (
                                <option key={method} value={method}>
                                    {t.expenses.methods[method]}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <FormGrid.Full>
                        <Field label={m.description} htmlFor="scan-description">
                            <Textarea id="scan-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} className="w-full" />
                        </Field>
                    </FormGrid.Full>
                </FormGrid>
            )}
            <div className="flex justify-end">
                <Button type="submit" loading={saving} disabled={saving || (heads !== null && heads.length === 0)}>
                    {saving ? m.savingExpense : m.saveExpense}
                </Button>
            </div>
        </form>
    );
}
