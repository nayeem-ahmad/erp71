'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { formatBDT, formatDate, toDatetimeLocal } from '@/lib/format';
import { availableQtyOf } from '@/components/document-entry/ProductSearch';
import { buildVoiceEntryMessages, type VoiceEntryResult } from '@/lib/voice-entry';
import { newCustomerPayload, type NewCustomerDraft } from '../components/CustomerSelection';
import SaleEntryLayout, {
    computeSaleTotals,
    EMPTY_ADJUSTMENTS,
    type SaleAdjustments,
} from '../components/SaleEntryLayout';
import PrintInvoicePrompt from '../components/PrintInvoicePrompt';
import { lineDiscountAmount, useNewSaleCart } from '@/lib/hooks/useNewSaleCart';
import { useWarehouses } from '@/lib/hooks/useWarehouses';
import {
    printSalesInvoice,
    type InvoiceData,
    type PaperSize,
} from '@/lib/sales-invoice-printer';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { toast } from '@/lib/toast';
import { paymentInstrumentSummary } from '@/lib/payment-instrument';
import PaperSizeMenu from '../components/PaperSizeMenu';
import ShiftContextChip from '../components/ShiftContextChip';
import { canKeepDue, creditDueAmount, keepDueReason } from '@/lib/customer-credit';
import { getWorkspaceItem } from '@/lib/session-store';
import { routes } from '@/lib/routes';
import {
    exchangeRateOf,
    seedFromQuotation,
    seedFromSale,
    seedFromSalesOrder,
    type SaleSourceDocument,
} from './source-document';
import { useI18n } from '@/lib/i18n';

function NewSalePageContent() {
    const { t, locale, fmt } = useI18n();
    const copy = t.sales.entry;
    const {
        items,
        customer,
        description,
        payments,
        refNumber,
        setCustomer,
        setDescription,
        setRefNumber,
        addItem,
        updateItem,
        removeItem,
        updatePayment,
        loadCart,
        clearCart,
    } = useNewSaleCart();

    const [customerDraft, setCustomerDraft] = useState<NewCustomerDraft | null>(null);
    const [customerDraftNameInvalid, setCustomerDraftNameInvalid] = useState(false);
    const [salesSettings, setSalesSettings] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [savingDraft, setSavingDraft] = useState(false);
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [paperSize, setPaperSize] = useState<PaperSize>('A4');
    const [saleDate, setSaleDate] = useState<string>(() => toDatetimeLocal(new Date()));
    const [adjustments, setAdjustments] = useState<SaleAdjustments>(EMPTY_ADJUSTMENTS);
    // Set once a sale is posted, which is also when the screen is wiped for the
    // next customer — so the invoice is snapshotted here rather than re-read off
    // an empty form when the operator answers.
    const [printPrompt, setPrintPrompt] = useState<
        { serialNumber: string; total: number; invoice: InvoiceData } | null
    >(null);

    // Which warehouse the goods leave. `defaultWarehouseId` is what the server
    // would have resolved anyway, so the strip states it from the first render
    // rather than showing a blank that quietly resolves on save.
    const { warehouses, defaultWarehouseId } = useWarehouses('sale');
    const [warehouseId, setWarehouseId] = useState('');
    const [perLineWarehouse, setPerLineWarehouse] = useState(false);
    useEffect(() => {
        setWarehouseId((current) => current || defaultWarehouseId);
    }, [defaultWarehouseId]);

    // Set when the screen was opened by "Convert to Sale" on a quotation or a
    // sales order. Held in state rather than read off the URL at submit time so
    // clearing it after a successful sale also clears the banner.
    const router = useRouter();
    const searchParams = useSearchParams();
    const quotationId = searchParams.get('quotationId');
    const salesOrderId = searchParams.get('salesOrderId');
    // `?duplicate=<id>` copies an existing sale onto a fresh entry screen.
    const duplicateSaleId = searchParams.get('duplicate');
    const [source, setSource] = useState<SaleSourceDocument | null>(null);
    const [loadingSource, setLoadingSource] = useState(false);

    useEffect(() => {
        loadPageData();
    }, []);

    // Seed the cart from the document being converted. Runs once per id: the
    // user is free to edit the lines afterwards, and re-seeding would undo that.
    useEffect(() => {
        if (!quotationId && !salesOrderId && !duplicateSaleId) {
            setSource(null);
            return;
        }

        let cancelled = false;
        setLoadingSource(true);

        (async () => {
            try {
                const doc = quotationId
                    ? await api.getQuotation(quotationId)
                    : salesOrderId
                        ? await api.getOrder(salesOrderId)
                        : await api.getSale(duplicateSaleId as string);

                if (cancelled) return;

                if (!doc) {
                    toast.error(duplicateSaleId
                        ? t.sales.detail.duplicateLoadFailed
                        : copy.documentNotFound);
                    return;
                }

                if (quotationId && !exchangeRateOf(doc)) {
                    // Same guard the server applies when a proforma becomes an
                    // order: no rate means no defensible BDT figure to invoice.
                    toast.error(
                        fmt(copy.noExchangeRate, { number: doc.quote_number, currency: doc.currency }),
                    );
                    return;
                }

                // Held separately from `seeded` because only a copied sale
                // carries a rounding figure, and a union of the three seeds
                // loses the type of a field two of them do not have.
                const duplicated = duplicateSaleId ? seedFromSale(doc) : null;
                const seeded = duplicated
                    ?? (quotationId ? seedFromQuotation(doc) : seedFromSalesOrder(doc));

                loadCart({
                    items: seeded.items,
                    customer: seeded.customer,
                    description: seeded.description,
                });
                // A copied sale carries the gap between its line subtotal and
                // its stored total, so the duplicate totals to the same figure.
                setAdjustments(duplicated
                    ? { ...EMPTY_ADJUSTMENTS, rounding: duplicated.rounding }
                    : EMPTY_ADJUSTMENTS);
                if (duplicated?.warehouseId) setWarehouseId(duplicated.warehouseId);
                // Reveal the column when the copied sale was genuinely split,
                // so the overrides carried over are visible rather than silent.
                if (seeded.items.some((line) => line.warehouseId)) setPerLineWarehouse(true);
                setSource(seeded.source);
            } catch (error: any) {
                console.error('Failed to load the document being converted', error);
                if (!cancelled) toast.error(error.message || copy.loadDocumentFailed);
            } finally {
                if (!cancelled) setLoadingSource(false);
            }
        })();

        return () => { cancelled = true; };
        // The copy is read when a load settles, not a reason to load again.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quotationId, salesOrderId, duplicateSaleId, loadCart, t.sales.detail.duplicateLoadFailed]);

    /**
     * Drop the source document once its sale has been saved. Clearing the query
     * string is what resets `source`, so the screen is ready for the next entry
     * instead of quietly attaching the same quotation to it.
     */
    const resetConversion = () => {
        if (source) router.replace(routes.sales.new);
    };

    const vatRate = salesSettings?.tenant?.default_vat_rate || 0;
    const totals = useMemo(
        () => computeSaleTotals(items, adjustments, vatRate),
        [items, adjustments, vatRate],
    );

    const loadPageData = async () => {
        try {
            const [settings, user] = await Promise.all([
                api.getSalesSettings(),
                api.getCurrentUser(),
            ]);
            setSalesSettings(settings);
            setCurrentUser(user);
            // Use default paper size from settings if available
            if (settings?.default_paper_size) {
                setPaperSize(settings.default_paper_size as PaperSize);
            }
        } catch (error) {
            console.error('Failed to load page data', error);
        } finally {
            setLoading(false);
        }
    };

    const printHeader = usePrintHeader('SALES_INVOICE');

    /**
     * What is on the screen right now, as an invoice. Printed straight from the
     * toolbar before a sale is saved, and snapshotted on save so the prompt can
     * still print it after the cart has been cleared.
     */
    const buildInvoiceData = (fallbackReference?: string): InvoiceData => ({
        referenceNumber: refNumber || fallbackReference || '—',
        date: formatDate(saleDate, locale),
        companyName: currentUser?.store?.name || salesSettings?.tenant?.business_name || printHeader.companyName,
        headerConfig: printHeader.headerConfig,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        items: items.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.price,
            // The printer takes the line's discount in taka, not the typed
            // percentage — it prints the figure and subtracts it.
            discount: lineDiscountAmount(item),
        })),
        payments: payments.map((p) => ({ method: p.method, amount: p.amount, reference: paymentInstrumentSummary(p) })),
        subtotal: totals.subtotal,
        discountAmount: totals.discount > 0 ? totals.discount : undefined,
        // Rounded because a flat discount derives its percentage from the
        // subtotal, and "Discount (7.142857142857143%)" is not a line anyone
        // wants on an invoice.
        discountPercent: totals.discountPercent > 0
            ? Math.round(totals.discountPercent * 100) / 100
            : undefined,
        // Contained in the total, not added to it — the printer labels it so.
        vat: totals.vat > 0 ? totals.vat : undefined,
        transportCost: totals.transportCost > 0 ? totals.transportCost : undefined,
        laborCost: totals.laborCost > 0 ? totals.laborCost : undefined,
        rounding: totals.rounding || undefined,
        total: totals.total,
        note: description || undefined,
    });

    const handlePrint = (size?: PaperSize) => {
        const selectedSize = size ?? paperSize;
        printSalesInvoice(buildInvoiceData(), selectedSize);
    };

    const handleAddItem = (
        product: any,
        options?: { quantity?: number; price?: number; availableQty?: number },
    ) => {
        addItem({
            productId: product.id,
            name: product.name,
            // API serializes Decimal price as a string; coerce to number so
            // cart math and `.toFixed()` downstream work correctly.
            price: options?.price ?? Number(product.price),
            group: product.group?.name,
            subgroup: product.subgroup?.name,
            quantity: options?.quantity ?? 1,
            discount: 0,
            // The product's own VAT rate, so the VAT shown inside the total
            // matches what the server snapshots. Absent → workspace default.
            vatRate: product.vat_rate != null ? Number(product.vat_rate) : null,
            // Voice-entry products come without stock rows — leave availableQty
            // undefined there rather than claiming zero stock.
            availableQty: options?.availableQty
                ?? (Array.isArray(product.stocks) ? availableQtyOf(product) : undefined),
        });
    };

    const handleVoiceSale = (result: VoiceEntryResult) => {
        let added = 0;
        for (const item of result.items) {
            if (item.matched && item.product) {
                handleAddItem(item.product, { quantity: item.quantity });
                added++;
            }
        }

        if (result.note && !description) {
            setDescription(result.note);
        }

        const messages = buildVoiceEntryMessages(result, added);
        for (const message of messages) {
            if (message.startsWith('Could not find')) {
                toast.info(message);
            } else {
                toast.success(message);
            }
        }
    };

    const validateCheckout = (): { valid: boolean; errors: string[] } => {
        const errors: string[] = [];

        if (items.length === 0) {
            errors.push(copy.addItemRequired);
        }

        if (customerDraft && !customerDraft.name.trim()) {
            errors.push(t.shared.customerNameRequiredInline);
        }

        const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
        const balance = totals.total - totalPaid;
        const creditDue = creditDueAmount(totals.total, totalPaid);
        const keepDueCheck = canKeepDue(customer, creditDue);

        if (balance < -0.01) {
            errors.push(fmt(copy.overpaid, { amount: `৳${Math.abs(balance).toFixed(2)}` }));
        } else if (creditDue > 0.01 && !keepDueCheck.allowed) {
            errors.push(
                keepDueReason(keepDueCheck, copy.credit, fmt)
                    ?? fmt(copy.underpaid, { amount: `৳${creditDue.toFixed(2)}` }),
            );
        } else if (creditDue <= 0.01 && payments.length === 0) {
            errors.push(copy.paymentRequired);
        }

        return { valid: errors.length === 0, errors };
    };

    const buildSaleData = (isDraft: boolean) => ({
        // The active branch/store is persisted in localStorage and sent
        // as x-store-id on every request; the sale body needs the same id.
        // (Owners have no currentUser.store_id, so don't rely on it.)
        storeId: getWorkspaceItem('store_id') || '',
        referenceNumber: refNumber || undefined,
        // What this invoice was raised from, so the sale keeps a link back to
        // the quotation or order it settles.
        quotationId: source?.kind === 'quotation' ? source.id : undefined,
        salesOrderId: source?.kind === 'salesOrder' ? source.id : undefined,
        customerId: customerDraft ? undefined : customer?.id,
        newCustomer: newCustomerPayload(customerDraft),
        warehouseId: warehouseId || undefined,
        items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            // The list price and the line's "Disc %" travel separately; the
            // server folds one into the other the same way `netUnitPrice`
            // does here, and stores the net price it arrives at.
            priceAtSale: item.price,
            discountPercent: item.discount > 0 ? item.discount : undefined,
            // Only sent while the per-line column is showing: a line keeps its
            // override in state when the column is hidden, and posting one the
            // user cannot see would be a trap.
            warehouseId: perLineWarehouse ? item.warehouseId : undefined,
        })),
        totalAmount: totals.total,
        amountPaid: payments.reduce((sum, p) => sum + p.amount, 0),
        discountAmount: totals.discount > 0 ? totals.discount : undefined,
        // Billed on top of the discounted goods, and counted by the server's
        // total check — which rejected any sale carrying them until they were
        // sent. VAT is not among them: it is already inside the line prices.
        transportAmount: totals.transportCost > 0 ? totals.transportCost : undefined,
        laborAmount: totals.laborCost > 0 ? totals.laborCost : undefined,
        roundingAmount: totals.rounding ? totals.rounding : undefined,
        note: description || undefined,
        saleDate: saleDate ? new Date(saleDate).toISOString() : undefined,
        payments: payments.map((p) => ({
            paymentMethod: p.method,
            amount: p.amount,
            accountId: p.accountId,
            // The cheque / transfer details typed against this tender, if any.
            bankName: p.bankName,
            bankBranch: p.bankBranch,
            bankAccountNumber: p.bankAccountNumber,
            referenceNo: p.referenceNo,
            instrumentDate: p.instrumentDate,
        })),
        ...(isDraft ? { isDraft: true } : {}),
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const validation = validateCheckout();
        setCustomerDraftNameInvalid(!!customerDraft && !customerDraft.name.trim());
        if (!validation.valid) {
            toast.error(validation.errors.join('\n'));
            return;
        }

        setSubmitting(true);
        try {
            const response = await api.createNewSale(buildSaleData(false));

            // Taken before the cart is cleared: the prompt below prints the sale
            // that was just posted, not the blank screen it leaves behind. The
            // sale number stands in as the invoice reference when the operator
            // typed none, matching what the sale record prints later.
            const invoice = buildInvoiceData(response.serial_number);

            // Clear cart and show success
            clearCart();
            setCustomerDraft(null);
            setCustomerDraftNameInvalid(false);
            setAdjustments(EMPTY_ADJUSTMENTS);
            resetConversion();
            toast.success(fmt(copy.created, { number: response.serial_number }));
            setPrintPrompt({
                serialNumber: response.serial_number,
                total: totals.total,
                invoice,
            });
        } catch (error: any) {
            const errorMsg = error.message || copy.createFailed;
            console.error('Sale creation error:', error);
            toast.error(errorMsg);
        } finally {
            setSubmitting(false);
        }
    };

    // A draft is parked as-is: no stock, payment or credit validation runs, and
    // the backend posts nothing. Only "has at least one item" is required.
    const handleSaveDraft = async () => {
        if (items.length === 0) {
            toast.error(copy.draftNeedsItem);
            return;
        }

        // The customer is created with the draft, so the name is needed even
        // though nothing else about a parked draft is validated.
        if (customerDraft && !customerDraft.name.trim()) {
            setCustomerDraftNameInvalid(true);
            toast.error(t.shared.customerNameRequiredInline);
            return;
        }
        setCustomerDraftNameInvalid(false);

        setSavingDraft(true);
        try {
            const response = await api.createNewSale(buildSaleData(true));
            clearCart();
            setCustomerDraft(null);
            setCustomerDraftNameInvalid(false);
            setAdjustments(EMPTY_ADJUSTMENTS);
            resetConversion();
            toast.success(fmt(copy.draftSaved, { reference: response.reference_number || response.serial_number }));
        } catch (error: any) {
            console.error('Draft save error:', error);
            toast.error(error.message || copy.draftSaveFailed);
        } finally {
            setSavingDraft(false);
        }
    };

    const sourceLabel = source?.kind === 'quotation' ? copy.sourceQuotation : copy.sourceSalesOrder;
    // Split around the number, like the duplicate banner, so it stays a link.
    const [convertingBefore, convertingAfter = ''] = fmt(copy.convertingBanner, { source: sourceLabel })
        .split('{number}');
    const isDuplicate = source?.kind === 'sale';

    const conversionBanner = source ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
            {isDuplicate ? (
                // Split around the placeholder rather than substituting into it,
                // so the source number stays a link and the sentence still reads
                // in its own word order in every locale.
                <span>
                    {t.sales.detail.duplicateBanner.split('{number}')[0]}
                    <Link href={source.href} className="font-semibold underline">
                        {source.number}
                    </Link>
                    {t.sales.detail.duplicateBanner.split('{number}')[1] ?? ''}
                </span>
            ) : (
                <span>
                    {convertingBefore}
                    <Link href={source.href} className="font-semibold underline">
                        {source.number}
                    </Link>
                    {convertingAfter}
                </span>
            )}
            {source.exchangeRate !== 1 && (
                <span className="text-xs text-blue-700">
                    {fmt(copy.convertedCurrency, { currency: source.currency, rate: source.exchangeRate })}
                </span>
            )}
            {source.amountPaid > 0 && (
                <span className="text-xs text-blue-700">
                    {fmt(copy.depositsCollected, { amount: formatBDT(source.amountPaid) })}
                </span>
            )}
        </div>
    ) : null;

    // Which till this sale will be stamped with, above the form rather than
    // discovered at reconciliation. Sits alongside the conversion notice when
    // both apply, since an invoice raised from an order still belongs to a
    // shift (or to none).
    const entryBanner = (
        <div className="space-y-2">
            <ShiftContextChip />
            {conversionBanner}
        </div>
    );

    if (loading || loadingSource) {
        return <div className="text-center py-8">{t.common.loading}</div>;
    }

    return (
        <>
        <SaleEntryLayout
            title={isDuplicate
                ? `${t.common.duplicate}: ${source!.number}`
                : source ? fmt(copy.titleFrom, { number: source.number }) : t.sales.newSale}
            backHref={source ? source.href : routes.sales.list}
            banner={entryBanner}
            refNumber={refNumber}
            setRefNumber={setRefNumber}
            currentUser={currentUser}
            saleDate={saleDate}
            setSaleDate={setSaleDate}
            customer={customer}
            customerDraft={customerDraft}
            setCustomerDraft={setCustomerDraft}
            customerDraftNameInvalid={customerDraftNameInvalid}
            setCustomer={setCustomer}
            items={items}
            onUpdateItem={updateItem}
            onRemoveItem={removeItem}
            onAddProduct={handleAddItem}
            onVoiceResult={handleVoiceSale}
            description={description}
            setDescription={setDescription}
            totals={totals}
            onTotalsChange={(patch) => setAdjustments((prev) => ({ ...prev, ...patch }))}
            tenantVatRate={vatRate}
            payments={payments}
            onPaymentChange={updatePayment}
            warehouses={warehouses}
            warehouseId={warehouseId}
            setWarehouseId={setWarehouseId}
            perLineWarehouse={perLineWarehouse}
            setPerLineWarehouse={setPerLineWarehouse}
            showRateHistory
            onSubmit={handleSubmit}
            actions={
                <>
                    <Link
                        href={source ? source.href : routes.sales.list}
                        className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm"
                    >
                        {t.common.cancel}
                    </Link>
                    <button
                        type="button"
                        onClick={handleSaveDraft}
                        disabled={savingDraft || submitting || items.length === 0}
                        className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 disabled:text-gray-400 text-sm"
                        title={copy.saveDraftHint}
                    >
                        {savingDraft ? copy.saving : copy.saveDraft}
                    </button>
                    {/* Print button with paper-size dropdown */}
                    <PaperSizeMenu
                        paperSize={paperSize}
                        onPaperSizeChange={setPaperSize}
                        onPrint={(size) => handlePrint(size)}
                        label={copy.paperSize}
                    />
                    <button
                        type="submit"
                        disabled={submitting || savingDraft || items.length === 0}
                        className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium"
                    >
                        {submitting ? copy.creating : copy.createSale}
                    </button>
                </>
            }
        />
        {printPrompt && (
            <PrintInvoicePrompt
                serialNumber={printPrompt.serialNumber}
                total={formatBDT(printPrompt.total, { locale })}
                paperSize={paperSize}
                onPaperSizeChange={setPaperSize}
                onPrint={() => {
                    printSalesInvoice(printPrompt.invoice, paperSize);
                    setPrintPrompt(null);
                }}
                onDismiss={() => setPrintPrompt(null)}
            />
        )}
        </>
    );
}

/**
 * `useSearchParams` bails out of prerendering without a Suspense boundary
 * above it, so the screen itself is a child component.
 */
export default function NewSalePage() {
    return (
        <Suspense>
            <NewSalePageContent />
        </Suspense>
    );
}
