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
} from '../../components/CustomerSelection';
import ProductSearch from '@/components/document-entry/ProductSearch';
import LineItemsTable from '@/components/document-entry/LineItemsTable';
import TotalsFooter from '../../components/TotalsFooter';
import DocumentMetaBar, { MetaField, metaFieldInputClass } from '@/components/document-entry/DocumentMetaBar';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import { buildVoiceEntryMessages, type VoiceEntryResult } from '@/lib/voice-entry';
import { useNewSaleCart } from '@/lib/hooks/useNewSaleCart';
import { toast } from '@/lib/toast';
import ProformaTermsFields, {
    emptyProformaTerms,
    proformaTermsPayload,
    type ProformaTerms,
} from '../ProformaTermsFields';
import { getWorkspaceItem } from '@/lib/session-store';
import { useTaxPricing } from '@/lib/hooks/useTaxPricing';
import { documentPricing, documentVatTotals, productTaxRates } from '@/lib/sale-vat';
import { useI18n } from '@/lib/i18n';

export default function NewQuotationPage() {
    const router = useRouter();
    // `?kind=PROFORMA` rather than a separate route: the two documents share
    // every field except the terms block, and a second page would be the same
    // screen with one panel shown.
    const docKind = useSearchParams().get('kind') === 'PROFORMA' ? 'PROFORMA' : 'QUOTE';
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
    const pricing = useMemo(
        () => documentPricing(taxPricing.pricesIncludeVat, taxPricing.defaultVatRate, isProforma ? terms.currency : 'BDT'),
        [taxPricing.pricesIncludeVat, taxPricing.defaultVatRate, isProforma, terms.currency],
    );
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
            await api.createQuotation({
                storeId: getWorkspaceItem('store_id') || '',
                customerId: customerDraft ? undefined : customer?.id,
                newCustomer: newCustomerPayload(customerDraft),
                items: items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPrice: item.price,
                })),
                totalAmount: totals.total,
                pricesIncludeVat: pricing.pricesIncludeVat,
                vatAmount: totals.vat,
                validUntil: validUntil || undefined,
                notes: description || undefined,
                ...(isProforma ? proformaTermsPayload(terms, 'PROFORMA') : {}),
            });

            clearCart();
            toast.success(isProforma ? 'Proforma invoice created' : 'Quotation created');
            router.push(routes.sales.quotes);
        } catch (error: any) {
            console.error('Quotation creation error:', error);
            toast.error(error.message || 'Failed to create quotation');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <DocumentEntryLayout
            title={isProforma ? 'New Proforma Invoice' : 'New Quotation'}
            backHref={routes.sales.quotes}
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
                        href={routes.sales.quotes}
                        className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm"
                    >
                        Cancel
                    </Link>
                    <button
                        type="submit"
                        disabled={submitting || items.length === 0}
                        className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium"
                    >
                        {submitting ? 'Creating…' : isProforma ? 'Create Proforma Invoice' : 'Create Quotation'}
                    </button>
                </>
            }
        />
    );
}
