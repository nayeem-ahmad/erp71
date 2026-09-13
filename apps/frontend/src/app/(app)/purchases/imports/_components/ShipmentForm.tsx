'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { routes } from '@/lib/routes';
import { useI18n, formatMessage } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Input, Select, Field, Alert } from '@/components/ui';
import { compactDensity } from '@/lib/ui/compact-density';
import { getWorkspaceItem } from '@/lib/session-store';

type Line = { productId: string; quantity: string; unitPriceFc: string };

const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'];
const LC_TYPES = ['SIGHT', 'DEFERRED', 'USANCE'];
const CURRENCIES = ['USD', 'EUR', 'CNY', 'GBP', 'JPY', 'INR', 'AED', 'SGD', 'BDT'];

const emptyLine = (): Line => ({ productId: '', quantity: '1', unitPriceFc: '' });

const asDateInput = (value?: string | null) => (value ? String(value).slice(0, 10) : '');

/**
 * One form for creating and editing a shipment.
 *
 * Shared rather than copied because editing was missing entirely: a typo'd LC
 * number or a wrong quantity on a DRAFT shipment was uncorrectable from the UI,
 * even though `PATCH /imports/:id` has always existed. Two copies of a
 * twenty-field form is how they drift.
 */
export default function ShipmentForm({ shipment }: { shipment?: any }) {
    const { t } = useI18n();
    const copy = t.imports;
    const router = useRouter();
    const isEdit = Boolean(shipment);

    const [products, setProducts] = useState<any[]>([]);
    const [suppliers, setSuppliers] = useState<any[]>([]);
    const [stores, setStores] = useState<any[]>([]);
    const [submitting, setSubmitting] = useState(false);

    const [storeId, setStoreId] = useState(shipment?.store_id ?? getWorkspaceItem('store_id') ?? '');
    const [supplierId, setSupplierId] = useState(shipment?.supplier_id ?? '');
    const [currency, setCurrency] = useState(shipment?.currency ?? 'USD');
    const [fxRate, setFxRate] = useState(shipment?.fx_rate_at_open ? String(Number(shipment.fx_rate_at_open)) : '');
    const [lcNumber, setLcNumber] = useState(shipment?.lc_number ?? '');
    const [lcType, setLcType] = useState(shipment?.lc_type ?? '');
    const [lcExpiryDate, setLcExpiryDate] = useState(asDateInput(shipment?.lc_expiry_date));
    const [bankName, setBankName] = useState(shipment?.bank_name ?? '');
    const [incoterm, setIncoterm] = useState(shipment?.incoterm ?? '');
    const [portOfLoading, setPortOfLoading] = useState(shipment?.port_of_loading ?? '');
    const [portOfDischarge, setPortOfDischarge] = useState(shipment?.port_of_discharge ?? '');
    const [eta, setEta] = useState(asDateInput(shipment?.eta));
    const [notes, setNotes] = useState(shipment?.notes ?? '');
    const [lines, setLines] = useState<Line[]>(
        shipment?.items?.length
            ? shipment.items.map((item: any) => ({
                  productId: item.product_id,
                  quantity: String(item.quantity),
                  unitPriceFc: String(Number(item.unit_price_fc)),
              }))
            : [emptyLine()],
    );

    useEffect(() => {
        api.getProducts().then(setProducts).catch(() => {});
        api.getSuppliers().then(setSuppliers).catch(() => {});
        api.getStores().then(setStores).catch(() => {});
    }, []);

    const updateLine = (index: number, patch: Partial<Line>) =>
        setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

    const total = useMemo(
        () =>
            lines.reduce(
                (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPriceFc) || 0),
                0,
            ),
        [lines],
    );

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const filled = lines.filter((line) => line.productId && Number(line.quantity) > 0);
        if (filled.length === 0) {
            toast.error(copy.form.itemsRequired);
            return;
        }
        // Was sent as `''` with no picker and no guard, so an empty workspace
        // store produced a 404 with nothing on the form to fix.
        if (!storeId) {
            toast.error(copy.form.noStore);
            return;
        }
        if (currency !== 'BDT' && !Number(fxRate)) {
            // The backend refuses this too; catching it here names the field.
            toast.error(formatMessage(copy.cost.rateRequired, { currency }));
            return;
        }

        const payload = {
            storeId,
            supplierId: supplierId || undefined,
            currency,
            fxRateAtOpen: currency === 'BDT' ? undefined : Number(fxRate),
            lcNumber: lcNumber || undefined,
            lcType: lcType || undefined,
            lcExpiryDate: lcExpiryDate || undefined,
            bankName: bankName || undefined,
            incoterm: incoterm || undefined,
            portOfLoading: portOfLoading || undefined,
            portOfDischarge: portOfDischarge || undefined,
            eta: eta || undefined,
            notes: notes || undefined,
            items: filled.map((line) => ({
                productId: line.productId,
                quantity: Number(line.quantity),
                unitPriceFc: Number(line.unitPriceFc) || 0,
            })),
        };

        setSubmitting(true);
        try {
            const saved = isEdit
                ? await api.updateImportShipment(shipment.id, payload)
                : await api.createImportShipment(payload);
            toast.success(isEdit ? copy.form.updated : copy.form.created);
            router.push(routes.purchases.imports.shipmentDetail(saved?.id ?? shipment.id));
        } catch (error: any) {
            toast.error(error.message || (isEdit ? copy.form.updateFailed : copy.form.createFailed));
        } finally {
            setSubmitting(false);
        }
    };

    const title = isEdit ? copy.form.editTitle : copy.newShipment;

    return (
        <PageShell>
            <form onSubmit={handleSubmit} className="space-y-4">
                <PageHeader
                    title={title}
                    subtitle={isEdit ? shipment.reference_number : copy.subtitle}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.imports,
                        'purchases',
                        [{ label: copy.title, href: routes.purchases.imports.root }],
                        title,
                    )}
                    actions={
                        <div className="flex items-center gap-2">
                            <Link
                                href={
                                    isEdit
                                        ? routes.purchases.imports.shipmentDetail(shipment.id)
                                        : routes.purchases.imports.root
                                }
                                className={compactDensity.btnSecondary}
                            >
                                {t.common.cancel}
                            </Link>
                            <button
                                type="submit"
                                disabled={submitting}
                                className={`${compactDensity.btnPrimary} bg-primary hover:bg-primary-hover text-white disabled:opacity-50`}
                            >
                                {t.common.save}
                            </button>
                        </div>
                    }
                />

                {isEdit && shipment.purchase_id && (
                    <Alert tone="warning">{copy.form.lockedAfterReceipt}</Alert>
                )}

                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <p className="mb-3 text-xs font-semibold uppercase text-gray-500">{copy.detail.lcDetails}</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label={copy.form.store} hint={copy.form.storeHint} htmlFor="shipment-store">
                            <Select id="shipment-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                                <option value="">—</option>
                                {stores.map((store) => (
                                    <option key={store.id} value={store.id}>
                                        {store.name}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={copy.columns.supplier} htmlFor="shipment-supplier">
                            <Select
                                id="shipment-supplier"
                                value={supplierId}
                                onChange={(e) => setSupplierId(e.target.value)}
                            >
                                <option value="">—</option>
                                {suppliers.map((supplier) => (
                                    <option key={supplier.id} value={supplier.id}>
                                        {supplier.name}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={copy.columns.currency} htmlFor="shipment-currency">
                            <Select
                                id="shipment-currency"
                                value={currency}
                                onChange={(e) => setCurrency(e.target.value)}
                            >
                                {CURRENCIES.map((code) => (
                                    <option key={code} value={code}>
                                        {code}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        {/* Only asked for on a foreign-currency shipment, and
                            required there: it is what the landed cost and every
                            voucher are computed at. */}
                        {currency !== 'BDT' && (
                            <Field label={formatMessage(copy.cost.fxRate, { currency })} htmlFor="shipment-fx">
                                <Input
                                    id="shipment-fx"
                                    type="number"
                                    step="0.000001"
                                    min="0"
                                    value={fxRate}
                                    onChange={(e) => setFxRate(e.target.value)}
                                />
                            </Field>
                        )}
                        <Field label={copy.columns.lcNumber} htmlFor="shipment-lc">
                            <Input id="shipment-lc" value={lcNumber} onChange={(e) => setLcNumber(e.target.value)} />
                        </Field>
                        <Field label={copy.detail.lcType} htmlFor="shipment-lc-type">
                            <Select id="shipment-lc-type" value={lcType} onChange={(e) => setLcType(e.target.value)}>
                                <option value="">—</option>
                                {LC_TYPES.map((type) => (
                                    <option key={type} value={type}>
                                        {type}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={copy.form.lcExpiry} htmlFor="shipment-lc-expiry">
                            <Input
                                id="shipment-lc-expiry"
                                type="date"
                                value={lcExpiryDate}
                                onChange={(e) => setLcExpiryDate(e.target.value)}
                            />
                        </Field>
                        <Field label={copy.detail.bank} htmlFor="shipment-bank">
                            <Input id="shipment-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
                        </Field>
                    </div>
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <p className="mb-3 text-xs font-semibold uppercase text-gray-500">{copy.detail.shipmentDetails}</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label={copy.detail.incoterm} htmlFor="shipment-incoterm">
                            <Select
                                id="shipment-incoterm"
                                value={incoterm}
                                onChange={(e) => setIncoterm(e.target.value)}
                            >
                                <option value="">—</option>
                                {INCOTERMS.map((code) => (
                                    <option key={code} value={code}>
                                        {code}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={copy.form.portOfLoading} htmlFor="shipment-pol">
                            <Input
                                id="shipment-pol"
                                value={portOfLoading}
                                onChange={(e) => setPortOfLoading(e.target.value)}
                            />
                        </Field>
                        <Field label={copy.form.portOfDischarge} htmlFor="shipment-pod">
                            <Input
                                id="shipment-pod"
                                value={portOfDischarge}
                                onChange={(e) => setPortOfDischarge(e.target.value)}
                            />
                        </Field>
                        <Field label={copy.columns.eta} htmlFor="shipment-eta">
                            <Input id="shipment-eta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
                        </Field>
                    </div>
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <div className="mb-3 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase text-gray-500">{copy.detail.items}</p>
                        <button
                            type="button"
                            onClick={() => setLines((current) => [...current, emptyLine()])}
                            className={compactDensity.btnSecondary}
                        >
                            <Plus className="h-4 w-4" />
                            {t.common.add}
                        </button>
                    </div>

                    <div className="space-y-2">
                        {lines.map((line, index) => (
                            <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                                <div className="sm:col-span-6">
                                    <Select
                                        value={line.productId}
                                        onChange={(e) => updateLine(index, { productId: e.target.value })}
                                        aria-label={copy.detail.items}
                                    >
                                        <option value="">—</option>
                                        {products.map((product) => (
                                            <option key={product.id} value={product.id}>
                                                {product.name}
                                            </option>
                                        ))}
                                    </Select>
                                </div>
                                <div className="sm:col-span-2">
                                    <Input
                                        type="number"
                                        min="1"
                                        value={line.quantity}
                                        onChange={(e) => updateLine(index, { quantity: e.target.value })}
                                        aria-label={t.common.quantity}
                                    />
                                </div>
                                <div className="sm:col-span-3">
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.0001"
                                        value={line.unitPriceFc}
                                        onChange={(e) => updateLine(index, { unitPriceFc: e.target.value })}
                                        aria-label={formatMessage(copy.form.unitPrice, { currency })}
                                        placeholder={currency}
                                    />
                                </div>
                                <div className="flex items-center sm:col-span-1">
                                    <button
                                        type="button"
                                        onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                                        disabled={lines.length === 1}
                                        className="min-h-touch rounded-lg p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-30"
                                        aria-label={t.common.delete}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-3 flex justify-end border-t border-gray-100 pt-3 text-sm">
                        <span className="text-gray-500">{copy.columns.invoiceValue}</span>
                        <span className="ms-3 font-semibold text-gray-900">
                            {formatCurrency(total, { currency })}
                        </span>
                    </div>
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <Field label={t.common.notes} htmlFor="shipment-notes">
                        <Input id="shipment-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </Field>
                </section>
            </form>
        </PageShell>
    );
}
