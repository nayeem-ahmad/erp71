'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Input, Select, Field } from '@/components/ui';
import { compactDensity } from '@/lib/ui/compact-density';

type Line = { productId: string; quantity: string; unitPriceFc: string };

const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'];
const LC_TYPES = ['SIGHT', 'DEFERRED', 'USANCE'];
const CURRENCIES = ['USD', 'EUR', 'CNY', 'GBP', 'JPY', 'INR', 'AED', 'SGD', 'BDT'];

const emptyLine = (): Line => ({ productId: '', quantity: '1', unitPriceFc: '' });

export default function NewImportShipmentPage() {
    const { t } = useI18n();
    const copy = t.imports;
    const router = useRouter();

    const [products, setProducts] = useState<any[]>([]);
    const [suppliers, setSuppliers] = useState<any[]>([]);
    const [submitting, setSubmitting] = useState(false);

    const [supplierId, setSupplierId] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [fxRate, setFxRate] = useState('');
    const [lcNumber, setLcNumber] = useState('');
    const [lcType, setLcType] = useState('');
    const [lcExpiryDate, setLcExpiryDate] = useState('');
    const [bankName, setBankName] = useState('');
    const [incoterm, setIncoterm] = useState('');
    const [portOfLoading, setPortOfLoading] = useState('');
    const [portOfDischarge, setPortOfDischarge] = useState('');
    const [eta, setEta] = useState('');
    const [notes, setNotes] = useState('');
    const [lines, setLines] = useState<Line[]>([emptyLine()]);

    useEffect(() => {
        api.getProducts().then(setProducts).catch(() => {});
        api.getSuppliers().then(setSuppliers).catch(() => {});
    }, []);

    const updateLine = (index: number, patch: Partial<Line>) =>
        setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

    const total = lines.reduce(
        (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPriceFc) || 0),
        0,
    );

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const filled = lines.filter((line) => line.productId && Number(line.quantity) > 0);
        if (filled.length === 0) {
            toast.error('Add at least one item to the shipment');
            return;
        }
        if (currency !== 'BDT' && !Number(fxRate)) {
            // The backend refuses this too; catching it here names the field.
            toast.error(`Enter the BDT rate for ${currency}`);
            return;
        }

        setSubmitting(true);
        try {
            const shipment = await api.createImportShipment({
                storeId: localStorage.getItem('store_id') || '',
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
            });

            toast.success('Import shipment created');
            router.push(routes.purchases.imports.shipmentDetail(shipment.id));
        } catch (error: any) {
            toast.error(error.message || 'Failed to create shipment');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <PageShell>
            <form onSubmit={handleSubmit} className="space-y-4">
                <PageHeader
                    title={copy.newShipment}
                    subtitle={copy.subtitle}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.purchase,
                        'purchases',
                        [{ label: copy.title, href: routes.purchases.imports.root }],
                        copy.newShipment,
                    )}
                    actions={
                        <div className="flex items-center gap-2">
                            <Link href={routes.purchases.imports.root} className={compactDensity.btnSecondary}>
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

                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <p className="mb-3 text-xs font-semibold uppercase text-gray-500">{copy.detail.lcDetails}</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label={copy.columns.supplier}>
                            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                                <option value="">—</option>
                                {suppliers.map((supplier) => (
                                    <option key={supplier.id} value={supplier.id}>
                                        {supplier.name}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={copy.columns.currency}>
                            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
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
                            <Field label={`BDT / ${currency}`}>
                                <Input
                                    type="number"
                                    step="0.000001"
                                    min="0"
                                    value={fxRate}
                                    onChange={(e) => setFxRate(e.target.value)}
                                />
                            </Field>
                        )}
                        <Field label={copy.columns.lcNumber}>
                            <Input value={lcNumber} onChange={(e) => setLcNumber(e.target.value)} />
                        </Field>
                        <Field label="LC type">
                            <Select value={lcType} onChange={(e) => setLcType(e.target.value)}>
                                <option value="">—</option>
                                {LC_TYPES.map((type) => (
                                    <option key={type} value={type}>
                                        {type}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="LC expiry">
                            <Input type="date" value={lcExpiryDate} onChange={(e) => setLcExpiryDate(e.target.value)} />
                        </Field>
                        <Field label="Bank">
                            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
                        </Field>
                    </div>
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <p className="mb-3 text-xs font-semibold uppercase text-gray-500">{copy.detail.shipmentDetails}</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="Incoterm">
                            <Select value={incoterm} onChange={(e) => setIncoterm(e.target.value)}>
                                <option value="">—</option>
                                {INCOTERMS.map((code) => (
                                    <option key={code} value={code}>
                                        {code}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Port of loading">
                            <Input value={portOfLoading} onChange={(e) => setPortOfLoading(e.target.value)} />
                        </Field>
                        <Field label="Port of discharge">
                            <Input value={portOfDischarge} onChange={(e) => setPortOfDischarge(e.target.value)} />
                        </Field>
                        <Field label={copy.columns.eta}>
                            <Input type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
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
                                        aria-label="Quantity"
                                    />
                                </div>
                                <div className="sm:col-span-3">
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.0001"
                                        value={line.unitPriceFc}
                                        onChange={(e) => updateLine(index, { unitPriceFc: e.target.value })}
                                        aria-label={`Unit price (${currency})`}
                                        placeholder={currency}
                                    />
                                </div>
                                <div className="flex items-center sm:col-span-1">
                                    <button
                                        type="button"
                                        onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                                        disabled={lines.length === 1}
                                        className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-30"
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
                            {total.toFixed(2)} {currency}
                        </span>
                    </div>
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <Field label={t.common.notes}>
                        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </Field>
                </section>
            </form>
        </PageShell>
    );
}
