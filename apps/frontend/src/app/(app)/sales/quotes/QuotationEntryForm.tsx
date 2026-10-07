'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import DocumentEntryLayout from '@/components/document-entry/DocumentEntryLayout';
import CustomerSelection, {
    newCustomerPayload,
    type NewCustomerDraft,
} from '../components/CustomerSelection';
import ProductSearch from '@/components/document-entry/ProductSearch';
import LineItemsTable from '@/components/document-entry/LineItemsTable';
import TotalsFooter from '../components/TotalsFooter';
import DocumentMetaBar, { MetaField, metaFieldInputClass } from '@/components/document-entry/DocumentMetaBar';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import { buildVoiceEntryMessages, type VoiceEntryResult } from '@/lib/voice-entry';
import { useNewSaleCart } from '@/lib/hooks/useNewSaleCart';
import { toast } from '@/lib/toast';
import ProformaTermsFields, {
    emptyProformaTerms,
    proformaTermsPayload,
    type ProformaTerms,
} from './ProformaTermsFields';
import { getWorkspaceItem } from '@/lib/session-store';
import { useTaxPricing } from '@/lib/hooks/useTaxPricing';
import { documentPricing, documentVatTotals, enteredBeforeVat, productTaxRates } from '@/lib/sale-vat';
import { useI18n } from '@/lib/i18n';

/**
 * The quotation entry screen, for both creating and editing. With `quoteId` it
 * loads that document into the same form and saves with a PATCH, so editing
 * looks and behaves exactly like entering.
 */
export default function QuotationEntryForm({ quoteId }: { quoteId?: string }) {
    const router = useRouter();
    const isEdit = !!quoteId;
    const [loaded, setLoaded] = useState<any>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    // `?kind=PROFORMA` rather than a separate route: the two documents share
    // every field except the terms block, and a second page would be the same
    // screen with one panel shown.
    const kindParam = useSearchParams().get('kind');
    const docKind = loaded
        ? (loaded.doc_kind === 'PROFORMA' ? 'PROFORMA' : 'QUOTE')
        : kindParam === 'PROFORMA' ? 'PROFORMA' : 'QUOTE';
    const isProforma = docKind === 'PROFORMA';
    const [terms, setTerms] = useState<ProformaTerms>(emptyProformaTerms);
    const {
        items,
        customer,
        description,
        setCustomer,
        setDescription,
        addItem,
        updateItem,
        removeItem,
        loadCart,
        clearCart,
    } = useNewSaleCart();

    const { t } = useI18n();
    const [customerDraft, setCustomerDraft] = useState<NewCustomerDraft | null>(null);
    const [customerDraftNameInvalid, setCustomerDraftNameInvalid] = useState(false);
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [validUntil, setValidUntil] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        api.getCurrentUser().then(setCurrentUser).catch(() => {});
    }, []);

    // A quotation stores its lines and total, with no discount or other
    // adjustment rows (hidden for that reason — see TotalsFooter). A shop that
    // prices before VAT adds it on top here too; the VAT is stored with the
    // document and is part of its total. Prices that include VAT add nothing.
    const taxPricing = useTaxPricing();
    // An existing quotation keeps the way it was priced, whatever the shop does now.
    const pricesIncludeVat = loaded ? !enteredBeforeVat(loaded) : taxPricing.pricesIncludeVat;
    const pricing = useMemo(
        () => documentPricing(pricesIncludeVat, taxPricing.defaultVatRate, isProforma ? terms.currency : 'BDT'),
        [pricesIncludeVat, taxPricing.defaultVatRate, isProforma, terms.currency],
    );

    useEffect(() => {
        if (!quoteId) return;
        api.getQuotation(quoteId)
            .then((quote: any) => {
                setLoaded(quote);
                loadCart({
                    customer: quote.customer ?? null,
                    description: quote.notes || '',
                    items: (quote.items || []).map((item: any) => ({
                        productId: item.product_id,
                        name: item.product?.name || 'Item',
                        price: Number(item.unit_price),
                        group: item.product?.group?.name,
                        subgroup: item.product?.subgroup?.name,
                        quantity: item.quantity,
                        discount: 0,
                        ...productTaxRates(item.product),
                    })),
                });
                setValidUntil(quote.valid_until ? new Date(quote.valid_until).toISOString().slice(0, 10) : '');
                setTerms({
                    currency: quote.currency || 'BDT',
                    exchangeRate: quote.exchange_rate == null ? '' : String(quote.exchange_rate),
                    incoterm: quote.incoterm || '',
                    portOfLoading: quote.port_of_loading || '',
                    portOfDischarge: quote.port_of_discharge || '',
                    paymentTerms: quote.payment_terms || '',
                    advancePercent: quote.advance_percent == null ? '' : String(quote.advance_percent),
                    deliveryLeadTimeDays:
                        quote.delivery_lead_time_days == null ? '' : String(quote.delivery_lead_time_days),
                    countryOfOrigin: quote.country_of_origin || '',
                });
            })
            .catch(() => setLoadFailed(true));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quoteId]);
    const docTotals = useMemo(
        () => documentVatTotals(
            items.map((item) => ({ quantity: item.quantity, unitPrice: item.price, vatRate: item.vatRate, sdRate: item.sdRate })),
            pricing,
        ),
        [items, pricing],
    );
    const totals = {
        subtotal: docTotals.subtotal,
        discount: 0,
        discountPercent: 0,
        vat: docTotals.vatAmount,
        vatIncluded: false,
        vatRate: docTotals.vatRate,
        transportCost: 0,
        laborCost: 0,
        rounding: 0,
        total: docTotals.total,
    };

    const handleAddItem = (
        product: any,
        options?: { quantity?: number; price?: number; availableQty?: number },
    ) => {
        addItem({
            productId: product.id,
            name: product.name,
            price: options?.price ?? Number(product.price),
            group: product.group?.name,
            subgroup: product.subgroup?.name,
            quantity: options?.quantity ?? 1,
            discount: 0,
            ...productTaxRates(product),
            availableQty: options?.availableQty,
        });
    };

    const handleVoiceQuote = (result: VoiceEntryResult) => {
        let added = 0;
        for (const item of result.items) {
            if (item.matched && item.product) {
                handleAddItem(item.product, { quantity: item.quantity });
                added++;
            }
        }
        if (result.note && !description) setDescription(result.note);

        for (const message of buildVoiceEntryMessages(result, added)) {
            if (message.startsWith('Could not find')) toast.info(message);
            else toast.success(message);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (items.length === 0) {
            toast.error(`Add at least one item to the ${isProforma ? 'proforma invoice' : 'quotation'}`);
            return;
        }

        if (isProforma && terms.currency.toUpperCase() !== 'BDT' && !Number(terms.exchangeRate)) {
            // The backend rejects this too; catching it here saves a round trip
            // and points at the field rather than at a generic error toast.
            toast.error(`Enter the BDT rate for ${terms.currency.toUpperCase()}`);
            return;
        }

        if (customerDraft && !customerDraft.name.trim()) {
            setCustomerDraftNameInvalid(true);
            toast.error(t.shared.customerNameRequiredInline);
            return;
        }
        setCustomerDraftNameInvalid(false);

        setSubmitting(true);
        try {
            const payload = {
                customerId: customerDraft ? undefined : customer?.id,
                newCustomer: newCustomerPayload(customerDraft),
                items: items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPrice: item.price,
                })),
                totalAmount: totals.total,
                vatAmount: totals.vat,
                validUntil: validUntil || undefined,
                notes: description || undefined,
                ...(isProforma ? proformaTermsPayload(terms, 'PROFORMA') : {}),
            };

            if (quoteId) {
                await api.updateQuotation(quoteId, payload);
                toast.success(isProforma ? 'Proforma invoice updated' : 'Quotation updated');
                router.push(routes.sales.quoteDetail(quoteId));
                return;
            }

            await api.createQuotation({
                ...payload,
                storeId: getWorkspaceItem('store_id') || '',
                pricesIncludeVat: pricing.pricesIncludeVat,
            });

            clearCart();
            toast.success(isProforma ? 'Proforma invoice created' : 'Quotation created');
            router.push(routes.sales.quotes);
        } catch (error: any) {
            console.error('Quotation creation error:', error);
            toast.error(error.message || `Failed to ${isEdit ? 'update' : 'create'} quotation`);
        } finally {
            setSubmitting(false);
        }
    };

    if (isEdit && loadFailed) {
        return <div className="p-4 text-sm text-red-600">Could not load this quotation.</div>;
    }
    if (isEdit && !loaded) {
        return <div className="p-4 text-sm text-gray-500">Loading…</div>;
    }
    const backHref = quoteId ? routes.sales.quoteDetail(quoteId) : routes.sales.quotes;

    return (
        <DocumentEntryLayout
            title={`${isEdit ? 'Edit' : 'New'} ${isProforma ? 'Proforma Invoice' : 'Quotation'}${isEdit ? ` ${loaded.quote_number}` : ''}`}
            backHref={backHref}
            onSubmit={handleSubmit}
            metaBar={
                <DocumentMetaBar
                    docLabel={isProforma ? 'Proforma #' : 'Quotation #'}
                    currentUser={currentUser}
                    showRefNumber={false}
                    showDate={false}
                >
                    <MetaField label="Valid Until">
                        <input
                            type="date"
                            value={validUntil}
                            onChange={(e) => setValidUntil(e.target.value)}
                            className={metaFieldInputClass}
                        />
                    </MetaField>
                </DocumentMetaBar>
            }
            partyPicker={(
                <CustomerSelection
                    customer={customer}
                    setCustomer={setCustomer}
                    draft={customerDraft}
                    setDraft={setCustomerDraft}
                    draftNameInvalid={customerDraftNameInvalid}
                />
            )}
            picker={
                <VoiceEntryInput entryType="sales_quote" onResult={handleVoiceQuote} inline>
                    <ProductSearch onProductSelect={handleAddItem} />
                </VoiceEntryInput>
            }
            table={
                <LineItemsTable
                    items={items}
                    onUpdateItem={updateItem}
                    onRemoveItem={removeItem}
                    showDiscount={false}
                />
            }
            note={
                <div className="space-y-2">
                    {isProforma && (
                        <ProformaTermsFields terms={terms} onChange={setTerms} disabled={submitting} />
                    )}
                    <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Notes (optional)…"
                        className="w-full border rounded px-2 py-1.5 text-sm flex-shrink-0"
                    />
                </div>
            }
            panel={
                <TotalsFooter
                    totals={totals}
                    onTotalsChange={() => {}}
                    tenantVatRate={pricing.defaultVatRate}
                    showAdjustments={false}
                />
            }
            actions={
                <>
                    <Link
                        href={backHref}
                        className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm"
                    >
                        Cancel
                    </Link>
                    <button
                        type="submit"
                        disabled={submitting || items.length === 0}
                        className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium"
                    >
                        {submitting
                            ? (isEdit ? 'Saving…' : 'Creating…')
                            : `${isEdit ? 'Save' : 'Create'} ${isProforma ? 'Proforma Invoice' : 'Quotation'}`}
                    </button>
                </>
            }
        />
    );
}
